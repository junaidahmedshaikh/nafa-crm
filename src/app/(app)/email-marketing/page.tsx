import Link from "next/link";
import { Megaphone, Plus } from "lucide-react";
import { CampaignStatus, Progress, Stat } from "@/components/email/bits";
import { LinkButton } from "@/components/ui/button";
import { Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/layout";
import { requireMember } from "@/lib/auth";
import { formatDateTime } from "@/lib/datetime";
import { emailConfigured } from "@/lib/documents/email";
import { loadEmailSettings, recipientCounts } from "@/lib/email/data";

export const metadata = { title: "AI Email Marketing" };
export const dynamic = "force-dynamic";

export default async function EmailDashboard() {
  const { supabase } = await requireMember();
  const head = (t: string) => supabase.from(t).select("id", { count: "exact", head: true });
  const [settings, contacts, eligible, campaignsRes, sent, bounced, unsub, drafted] = await Promise.all([
    loadEmailSettings(supabase),
    head("contacts").is("archived_at", null),
    head("contacts").is("archived_at", null).not("email", "is", null).eq("email_status", "valid"),
    supabase.from("email_campaigns").select("id, name, status, scheduled_at, created_at").order("created_at", { ascending: false }).limit(50),
    head("email_recipients").eq("status", "sent"),
    head("contacts").eq("email_status", "bounced"),
    head("email_suppressions").eq("reason", "unsubscribed"),
    head("email_recipients").eq("status", "pending"),
  ]);
  const campaigns = campaignsRes.data ?? [];
  const counts = await recipientCounts(supabase, campaigns.map((c) => c.id));
  const active = campaigns.filter((c) => ["scheduled", "sending", "paused"].includes(c.status));
  const setup = [
    { ok: emailConfigured(), label: "Email provider key (RESEND_API_KEY, EMAIL_FROM) is set on the server" },
    { ok: !!settings.sender_email, label: "Sender email set in Email Settings" },
    { ok: !!settings.postal_address.trim(), label: "Postal address set (required in every email)" },
  ];

  return (
    <>
      <PageHeader title="AI Email Marketing" description="Permission-based outreach to wedding planners, decorators, agencies, venues and corporates." actions={<><LinkButton href="/contacts/import">Import contacts</LinkButton><LinkButton href="/email-marketing/campaigns/new" variant="primary"><Plus className="h-4 w-4" aria-hidden />Create campaign</LinkButton></>} />
      {setup.some((s) => !s.ok) && (
        <Card className="mb-6 border-warning/40">
          <div className="p-4 text-sm">
            <p className="mb-1 font-medium">Finish setup before sending</p>
            <ul className="space-y-0.5">{setup.map((s) => <li key={s.label} className={s.ok ? "text-success" : "text-warning"}>{s.ok ? "✓" : "•"} {s.label}</li>)}</ul>
            <Link href="/email-marketing/settings" className="mt-2 inline-block text-accent hover:underline">Open Email Settings</Link>
          </div>
        </Card>
      )}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <Stat label="Total contacts" value={contacts.count ?? 0} />
        <Stat label="Eligible recipients" value={eligible.count ?? 0} note="Has a valid email, not bounced/unsubscribed" />
        <Stat label="Campaigns created" value={campaigns.length} />
        <Stat label="Emails drafted / queued" value={drafted.count ?? 0} />
        <Stat label="Emails sent" value={sent.count ?? 0} note="Accepted by the email provider" />
        <Stat label="Bounced contacts" value={bounced.count ?? 0} />
        <Stat label="Unsubscribes" value={unsub.count ?? 0} />
        <Stat label="Delivered · opened · clicks · replies" value="—" note="Not tracked yet — added with reply & event tracking" />
      </div>
      <Card>
        <CardHeader title="Active campaigns" action={<Link href="/email-marketing/campaigns" className="text-xs text-accent hover:underline">All campaigns</Link>} />
        {active.length === 0 ? <EmptyState icon={Megaphone} title="No active campaigns" description="Create a campaign, send yourself a test, then approve it." /> : (
          <ul className="divide-y divide-border">
            {active.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                <div><Link href={`/email-marketing/campaigns/${c.id}`} className="font-medium hover:underline">{c.name}</Link><p className="text-xs text-muted">{c.scheduled_at ? `Starts ${formatDateTime(c.scheduled_at)}` : ""}</p></div>
                <div className="flex items-center gap-4"><CampaignStatus status={c.status} /><Progress counts={counts.get(c.id) ?? { pending: 0, sending: 0, sent: 0, failed: 0, skipped: 0, total: 0 }} /></div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
