import type { SupabaseClient } from "@supabase/supabase-js";
import { PAGE_SIZE } from "@/lib/constants";
import { DESKTOP_PLATFORMS, type Platform } from "./device";

export type InstallRow = {
  id: string; user_id: string; user_name: string; user_email: string; device_id: string; platform: Platform; browser: string;
  source: "pwa" | "home_screen"; status: "installed" | "launched"; installed_at: string; first_launch_at: string | null; last_active_at: string | null;
};

export const DEVICE_FILTERS = ["android", "ios", "desktop", "other"] as const;
export type DeviceFilter = (typeof DEVICE_FILTERS)[number];
export const STATUS_FILTERS = ["installed", "launched"] as const;

const IST_MS = 5.5 * 3600 * 1000;
export const istDay = (iso: string) => new Date(new Date(iso).getTime() + IST_MS).toISOString().slice(0, 10);

export const deviceGroup = (p: Platform): DeviceFilter => (p === "android" ? "android" : p === "ios" ? "ios" : DESKTOP_PLATFORMS.includes(p) ? "desktop" : "other");

export type InstallFilters = { from: string | null; to: string | null; user: string; device: string; status: string; page: number };

export async function getInstallAnalytics(supabase: SupabaseClient, f: InstallFilters, today: string) {
  const [{ data }, users] = await Promise.all([
    supabase.from("app_install_list").select("*").order("installed_at", { ascending: false }).limit(5000),
    supabase.from("profiles").select("id, full_name, role").eq("is_active", true).order("full_name"),
  ]);
  const all = (data ?? []) as InstallRow[];
  const people = (users.data ?? []) as { id: string; full_name: string; role: string }[];

  const counts = { android: 0, ios: 0, desktop: 0, other: 0 };
  for (const r of all) counts[deviceGroup(r.platform)]++;
  const totals = {
    registeredUsers: people.length,
    installs: all.length,
    ...counts,
    today: all.filter((r) => istDay(r.installed_at) === today).length,
    launched: all.filter((r) => r.status === "launched").length,
    usersWithApp: new Set(all.map((r) => r.user_id)).size,
  };

  const filtered = all.filter((r) => {
    const day = istDay(r.installed_at);
    return (!f.from || day >= f.from) && (!f.to || day <= f.to) && (!f.user || r.user_id === f.user)
      && (!f.device || deviceGroup(r.platform) === f.device) && (!f.status || r.status === f.status);
  });
  const start = (f.page - 1) * PAGE_SIZE;

  // One entry per user, from the filtered rows, for the user-wise history.
  const byUser = new Map<string, { user_id: string; name: string; email: string; devices: InstallRow[] }>();
  for (const r of filtered) {
    const e = byUser.get(r.user_id) ?? { user_id: r.user_id, name: r.user_name, email: r.user_email, devices: [] };
    e.devices.push(r);
    byUser.set(r.user_id, e);
  }

  return { totals, people, rows: filtered.slice(start, start + PAGE_SIZE), total: filtered.length, pageSize: PAGE_SIZE, byUser: [...byUser.values()] };
}

export type AlertSettings = { enabled: boolean; email_enabled: boolean; extra_recipients: string[]; alert_emails: string[] };
export async function getAlertSettings(supabase: SupabaseClient): Promise<AlertSettings | null> {
  const { data } = await supabase.from("install_alert_settings").select("enabled, email_enabled, extra_recipients, alert_emails").maybeSingle();
  return (data as AlertSettings | null) ?? null;
}
