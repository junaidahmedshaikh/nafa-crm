import type { SupabaseClient } from "@supabase/supabase-js";
import type { EmailSettings } from "@/lib/email/processor";

export const DEFAULT_EMAIL_SETTINGS: EmailSettings = {
  sender_name: "NAFA Events & Activations", sender_email: "", reply_to: "", postal_address: "", signature_html: "",
  daily_limit: 50, batch_size: 5, window_start: "09:00:00", window_end: "18:00:00",
};

export async function loadEmailSettings(supabase: SupabaseClient): Promise<EmailSettings> {
  const { data } = await supabase.from("email_settings").select("*").maybeSingle();
  return (data as EmailSettings | null) ?? DEFAULT_EMAIL_SETTINGS;
}

export type Counts = { pending: number; sending: number; sent: number; failed: number; skipped: number; total: number };
export const emptyCounts = (): Counts => ({ pending: 0, sending: 0, sent: 0, failed: 0, skipped: 0, total: 0 });

/** Recipient status counts per campaign (one query; fine at the scale of a CRM mailing list). */
export async function recipientCounts(supabase: SupabaseClient, campaignIds?: string[]): Promise<Map<string, Counts>> {
  let q = supabase.from("email_recipients").select("campaign_id, status").limit(50000);
  if (campaignIds) q = q.in("campaign_id", campaignIds);
  const { data } = await q;
  const map = new Map<string, Counts>();
  for (const r of (data ?? []) as { campaign_id: string; status: keyof Counts }[]) {
    const c = map.get(r.campaign_id) ?? emptyCounts();
    c[r.status]++; c.total++;
    map.set(r.campaign_id, c);
  }
  return map;
}
