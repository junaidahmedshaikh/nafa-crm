import { createHmac, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Verifies a Resend (Svix) webhook signature: HMAC-SHA256 of "id.timestamp.body" with the base64 secret, 5-minute tolerance. */
export function verifySvix(secret: string, h: { id: string | null; timestamp: string | null; signature: string | null }, body: string, nowMs = Date.now()): boolean {
  if (!h.id || !h.timestamp || !h.signature) return false;
  const ts = Number(h.timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowMs / 1000 - ts) > 300) return false;
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = createHmac("sha256", key).update(`${h.id}.${h.timestamp}.${body}`).digest();
  return h.signature.split(" ").some((part) => {
    const [version, sig] = part.split(",");
    if (version !== "v1" || !sig) return false;
    const given = Buffer.from(sig, "base64");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

const TYPES: Record<string, "delivered" | "bounced" | "complained" | "opened" | "clicked" | "delivery_delayed"> = {
  "email.delivered": "delivered", "email.bounced": "bounced", "email.complained": "complained",
  "email.opened": "opened", "email.clicked": "clicked", "email.delivery_delayed": "delivery_delayed",
};

type ResendEvent = { type: string; created_at?: string; data?: { email_id?: string; to?: string[]; bounce?: { type?: string; message?: string }; click?: { link?: string } } };

/** Records a provider event against the recipient it belongs to; permanent bounces and spam complaints suppress the address. */
export async function applyProviderEvent(supabase: SupabaseClient, eventId: string, evt: ResendEvent): Promise<{ handled: boolean }> {
  const type = TYPES[evt.type];
  const providerId = evt.data?.email_id;
  if (!type || !providerId) return { handled: false };
  const { data: rcpt } = await supabase.from("email_recipients").select("id, campaign_id, email, email_normalized").eq("provider_id", providerId).maybeSingle();
  if (!rcpt) return { handled: false };   // e.g. a test email or another system's mail
  const detail = type === "clicked" ? evt.data?.click?.link ?? null : type === "bounced" ? [evt.data?.bounce?.type, evt.data?.bounce?.message].filter(Boolean).join(": ") || null : null;
  const { error } = await supabase.from("email_events").upsert(
    { recipient_id: rcpt.id, campaign_id: rcpt.campaign_id, type, detail, provider_event_id: eventId, occurred_at: evt.created_at ?? new Date().toISOString() },
    { onConflict: "provider_event_id", ignoreDuplicates: true },
  );
  if (error) throw new Error(error.message);

  const permanentBounce = type === "bounced" && evt.data?.bounce?.type?.toLowerCase() !== "transient";
  if (permanentBounce || type === "complained") {
    const reason = type === "complained" ? "complaint" : "bounced";
    await supabase.from("email_suppressions").upsert({ email_normalized: rcpt.email_normalized, email: rcpt.email, reason, source: "provider event" }, { onConflict: "email_normalized", ignoreDuplicates: true });
    await supabase.from("contacts").update({ email_status: reason === "complaint" ? "unsubscribed" : "bounced" }).eq("email_normalized", rcpt.email_normalized);
    await supabase.from("email_recipients").update({ status: "skipped", skip_reason: reason === "complaint" ? "suppressed" : "bounced" }).eq("email_normalized", rcpt.email_normalized).in("status", ["pending", "sending"]);
  }
  return { handled: true };
}
