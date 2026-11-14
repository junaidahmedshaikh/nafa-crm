import * as webpush from "web-push";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Server-side push delivery. Needs NEXT_PUBLIC_VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT, plus the service-role key
 * (to read other people's subscriptions). Every failure is swallowed and logged: a notification must never break the action
 * that triggered it.
 */
export const pushConfigured = () => !!(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);

export type PushPayload = { title: string; body: string; url?: string; tag?: string };

let configured = false;
function configure() {
  if (configured) return;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "https://nafa-crm.vercel.app", process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!, process.env.VAPID_PRIVATE_KEY!);
  configured = true;
}

export const safeUrl = (u?: string) => (u && u.startsWith("/") && !u.startsWith("//") ? u : "/");

/** Sends a push to every registered device of the given users. Returns how many deliveries succeeded. */
export async function sendPushToUsers(userIds: string[], payload: PushPayload): Promise<{ sent: number; removed: number }> {
  const out = { sent: 0, removed: 0 };
  if (!pushConfigured() || !userIds.length) return out;
  try {
    configure();
    const admin = createAdminClient();
    const { data: subs } = await admin.from("push_subscriptions").select("id, endpoint, p256dh, auth").in("user_id", userIds);
    const body = JSON.stringify({ ...payload, url: safeUrl(payload.url) });
    await Promise.all((subs ?? []).map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, { TTL: 60 * 60 * 12, urgency: "normal" });
        out.sent++;
        await admin.from("push_subscriptions").update({ last_success_at: new Date().toISOString() }).eq("id", s.id);
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) { await admin.from("push_subscriptions").delete().eq("id", s.id); out.removed++; }
        else console.error("[push]", code ?? (e as Error).message);
      }
    }));
  } catch (e) {
    console.error("[push]", (e as Error).message);
  }
  return out;
}

/** Ids of all active administrators. */
export async function adminIds(): Promise<string[]> {
  try {
    const { data } = await createAdminClient().from("profiles").select("id").eq("is_active", true).eq("role", "admin");
    return (data ?? []).map((p: { id: string }) => p.id);
  } catch {
    return [];
  }
}

/**
 * Notifies people everywhere: a row in the in-app bell AND a push to their installed apps.
 * `audience` is a list of user ids, or "team" (all active members) / "admins".
 */
export async function notify(
  audience: string[] | "team" | "admins" | "finance",
  n: PushPayload & { type: string; data?: Record<string, unknown>; /** Same key => each person is told only once (scheduled jobs). */ dedupeKey?: string },
): Promise<void> {
  try {
    const admin = createAdminClient();
    let ids: string[];
    if (Array.isArray(audience)) ids = audience;
    else {
      let q = admin.from("profiles").select("id").eq("is_active", true);
      if (audience === "admins") q = q.eq("role", "admin");
      // "finance": administrators plus accounts / management (the people who may see money).
      if (audience === "finance") q = q.or("role.eq.admin,finance_role.in.(accounts,management)");
      ids = ((await q).data ?? []).map((p: { id: string }) => p.id);
    }
    ids = [...new Set(ids)];
    if (!ids.length) return;
    // Each person's own preferences: a muted type is neither shown in the bell nor pushed. (Table missing => nobody has muted anything.)
    const { data: prefs } = await admin.from("notification_preferences").select("user_id, muted_types").in("user_id", ids);
    const muted = new Set((prefs ?? []).filter((p: { muted_types: string[] }) => p.muted_types?.includes(n.type)).map((p: { user_id: string }) => p.user_id));
    ids = ids.filter((id) => !muted.has(id));
    if (!ids.length) return;
    const rows = ids.map((user_id) => ({ user_id, type: n.type, title: n.title, body: n.body, data: { ...(n.data ?? {}), url: safeUrl(n.url) } }));
    if (n.dedupeKey) {
      const { data: fresh, error } = await admin.from("notifications")
        .upsert(rows.map((r) => ({ ...r, dedupe_key: n.dedupeKey })), { onConflict: "user_id,dedupe_key", ignoreDuplicates: true }).select("user_id");
      if (error) { console.error("[notify]", error.message); return; }
      ids = (fresh ?? []).map((r: { user_id: string }) => r.user_id);   // push only to people who were not already told
      if (!ids.length) return;
    } else {
      await admin.from("notifications").insert(rows);
    }
    await sendPushToUsers(ids, { title: n.title, body: n.body, url: n.url, tag: n.tag });
  } catch (e) {
    console.error("[notify]", (e as Error).message);
  }
}
