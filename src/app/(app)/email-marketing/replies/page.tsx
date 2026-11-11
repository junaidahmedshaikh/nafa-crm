import Link from "next/link";
import { ReplyCard, ReplyToolbar, type ReplyView } from "@/components/email/reply-ui";
import { Card, EmptyState, PageHeader } from "@/components/ui/layout";
import { requireMember } from "@/lib/auth";
import { gmailConfigured } from "@/lib/email/gmail";
import { REPLY_CATEGORIES, REPLY_LABEL } from "@/lib/email/reply-categories";
import { cn } from "@/lib/utils";

export const metadata = { title: "Replies & engagement" };
export const dynamic = "force-dynamic";

export default async function RepliesPage({ searchParams }: PageProps<"/email-marketing/replies">) {
  const sp = await searchParams;
  const cat = (Array.isArray(sp.category) ? sp.category[0] : sp.category) ?? "";
  const open = (Array.isArray(sp.open) ? sp.open[0] : sp.open) === "1";
  const { supabase } = await requireMember();
  let q = supabase.from("email_replies").select("*, campaign:email_campaigns(name), recipient:email_recipients(full_name)").order("received_at", { ascending: false }).limit(100);
  if (cat === "unclassified") q = q.is("category", null);
  else if (cat) q = q.eq("category", cat);
  if (open) q = q.eq("handled", false);
  const { data } = await q;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows: ReplyView[] = (data ?? []).map((r: any) => ({
    id: r.id, fromEmail: r.from_email, fromName: (Array.isArray(r.recipient) ? r.recipient[0] : r.recipient)?.full_name || r.from_email, subject: r.subject, body: r.body_text, receivedAt: r.received_at,
    campaign: (Array.isArray(r.campaign) ? r.campaign[0] : r.campaign)?.name ?? null, campaignId: r.campaign_id, category: r.category, summary: r.summary, suggested: r.suggested_reply,
    handled: r.handled, leadId: r.lead_id, hasContact: !!r.contact_id, source: r.source,
  }));
  const chip = (href: string, label: string, active: boolean) => (
    <Link key={label} href={href} className={cn("rounded-full border px-3 py-1 text-xs", active ? "border-btn-primary bg-btn-primary text-btn-primary-foreground" : "border-border text-muted hover:text-foreground")}>{label}</Link>
  );
  return (
    <>
      <PageHeader title="Replies & engagement" description="Replies from people your campaigns emailed. AI sorts them and drafts responses — nothing is sent without you." />
      <ReplyToolbar gmail={gmailConfigured()} />
      <div className="mb-4 flex flex-wrap gap-2">
        {chip("/email-marketing/replies", "All", !cat && !open)}
        {chip("/email-marketing/replies?open=1", "Needs action", open)}
        {chip("/email-marketing/replies?category=unclassified", "Needs review", cat === "unclassified")}
        {REPLY_CATEGORIES.map((c) => chip(`/email-marketing/replies?category=${c}`, REPLY_LABEL[c], cat === c))}
      </div>
      <Card>
        {rows.length === 0 ? <EmptyState title="No replies yet" description="Replies appear here once monitoring is connected or you log one manually." /> : <div className="divide-y divide-border">{rows.map((r) => <ReplyCard key={r.id} r={r} />)}</div>}
      </Card>
    </>
  );
}
