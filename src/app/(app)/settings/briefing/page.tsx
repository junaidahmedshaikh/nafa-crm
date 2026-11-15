import Link from "next/link";
import { BriefingSettingsForm } from "@/components/briefing/briefing-settings";
import { Card, CardHeader, PageHeader } from "@/components/ui/layout";
import { requireMember } from "@/lib/auth";
import { loadBriefingSettings } from "@/lib/briefing/build";
import { emailConfigured } from "@/lib/documents/email";

export const metadata = { title: "Daily Business Briefing" };

export default async function BriefingSettingsPage() {
  const { supabase, profile } = await requireMember();
  const settings = await loadBriefingSettings(supabase);
  return (
    <>
      <PageHeader
        title="Daily Business Briefing"
        breadcrumbs={[{ label: "Settings", href: "/settings" }, { label: "Notifications & Automation" }, { label: "Daily Business Briefing" }]}
        description="A morning report of meetings, tasks, follow-ups, payments, projects and finance, sent by the server even when nobody has the CRM open."
        actions={<Link href="/briefing" className="text-sm font-medium text-accent hover:underline">Briefing history &rarr;</Link>}
      />
      <div className="max-w-3xl space-y-4">
        {!emailConfigured() && <p className="rounded-md bg-warning-soft px-3 py-2 text-sm text-warning">Email sending is not configured on this server (RESEND_API_KEY / EMAIL_FROM), so only the in-app notification can be delivered.</p>}
        <Card>
          <CardHeader title="Notifications & Automation" />
          {settings
            ? <BriefingSettingsForm settings={settings} canEdit={profile.role === "admin"} />
            : <p className="p-5 text-sm text-muted">{profile.role === "admin" ? <>The Daily Business Briefing is not set up yet. Run <code>supabase/migrations/20261121000001_daily_briefing.sql</code> in the Supabase SQL editor.</> : "The Daily Business Briefing is available to administrators and the accounts / management team."}</p>}
        </Card>
        <p className="text-xs text-muted">The scheduler runs at 08:30 and again at 10:00 India time. A different delivery time is honoured exactly only if the scheduled route is called more often (see README, Scheduler); otherwise the briefing goes out at the next run after the time you chose.</p>
      </div>
    </>
  );
}
