import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeEmail, resolveAudience } from "@/lib/email/audience";
import { composeEmail, type CampaignContent } from "@/lib/email/compose";
import type { EmailSettings } from "@/lib/email/processor";

/**
 * Rebuilds a DRAFT campaign's first-email recipients from its audience filters: eligibility, duplicate removal,
 * A/B version assignment (even random split) and a missing-field check against the version each contact will get.
 */
export async function rebuildRecipients(supabase: SupabaseClient, campaignId: string) {
  const [{ data: camp }, { data: st }, { data: variants }] = await Promise.all([
    supabase.from("email_campaigns").select("*").eq("id", campaignId).single(),
    supabase.from("email_settings").select("*").single(),
    supabase.from("email_campaign_variants").select("label, subject, body_html").eq("campaign_id", campaignId).order("label"),
  ]);
  const settings = st as EmailSettings;
  const a = await resolveAudience(supabase, camp.audience);
  const versions: { label: string | null; subject: string; body: string }[] = [{ label: variants?.length ? "A" : null, subject: camp.subject, body: camp.body_html }];
  for (const v of variants ?? []) versions.push({ label: v.label, subject: v.subject, body: v.body_html });
  const shuffled = [...a.eligible].sort(() => Math.random() - 0.5);

  const rows = shuffled.map((c, i) => {
    const ver = versions[i % versions.length];
    const content: CampaignContent = { subject: ver.subject, bodyHtml: ver.body, fallbacks: camp.fallbacks ?? {}, salespersonName: camp.salesperson_name, senderName: camp.sender_name || settings.sender_name };
    const msg = composeEmail(content, { postalAddress: settings.postal_address || "-", signatureHtml: settings.signature_html },
      { fullName: c.fullName, companyName: c.companyName, designation: c.designation, industry: c.industry, city: c.city, website: c.website }, "00000000-0000-0000-0000-000000000000");
    const missing = ver.subject.trim() && ver.body.trim() ? msg.missing : [];
    return {
      campaign_id: campaignId, contact_id: c.id, email: c.email!.trim(), email_normalized: normalizeEmail(c.email!), full_name: c.fullName,
      step: 0, variant: ver.label, status: missing.length ? "skipped" : "pending", skip_reason: missing.length ? "missing_field" : null, missing_fields: missing,
    };
  });
  await supabase.from("email_recipients").delete().eq("campaign_id", campaignId);
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabase.from("email_recipients").insert(rows.slice(i, i + 500));
    if (error) throw new Error(`Could not prepare recipients: ${error.message}`);
  }
  const excluded: Record<string, number> = {};
  for (const e of a.excluded) excluded[e.reason] = (excluded[e.reason] ?? 0) + 1;
  await supabase.from("email_campaigns").update({ audience: { ...camp.audience, _stats: { totalContacts: a.totalContacts, matched: a.matched.length, excluded, preparedAt: new Date().toISOString() } } }).eq("id", campaignId);
  return { total: rows.length, skippedMissing: rows.filter((r) => r.status === "skipped").length };
}
