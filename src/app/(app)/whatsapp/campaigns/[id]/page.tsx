import Link from "next/link";
import { notFound } from "next/navigation";
import { CampaignRunner } from "@/components/whatsapp/campaign-runner";
import { Bubble, CampaignStatusBadge, MessageStatusBadge, ModeBadge } from "@/components/whatsapp/bits";
import { SetupNeeded, guarded } from "@/components/whatsapp/setup";
import { Card, CardHeader, DataTable, EmptyState, PageHeader, Pagination, Td, Th } from "@/components/ui/layout";
import { requireMember } from "@/lib/auth";
import { formatDateTime } from "@/lib/datetime";
import { maskPhone } from "@/lib/whatsapp/audience";
import { getCampaign, listCampaignMessages, totalOf } from "@/lib/whatsapp/repo";

export const metadata = { title: "WhatsApp campaign" };
// Sending runs batch by batch from this page's server actions; give each batch room to finish.
export const maxDuration = 60;

const FILTERS = ["queued", "sent", "delivered", "read", "failed", "skipped"] as const;

export default async function CampaignPage({ params, searchParams }: PageProps<"/whatsapp/campaigns/[id]">) {
  const { id } = await params;
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const status = (FILTERS as readonly string[]).includes(one(sp.status)) ? one(sp.status) : "";
  const page = Math.max(1, Math.floor(Number(one(sp.page))) || 1);
  const { supabase } = await requireMember();
  const loaded = await guarded(async () => {
    const data = await getCampaign(supabase, id);
    if (!data) return null;
    return { ...data, messages: await listCampaignMessages(supabase, id, { status, page }) };
  });
  if (!loaded.ok) return <><PageHeader title="Campaign" breadcrumbs={[{ label: "WhatsApp", href: "/whatsapp" }, { label: "Campaign" }]} /><SetupNeeded message={loaded.message} /></>;
  if (!loaded.data) notFound();
  const { campaign, template, counts, messages } = loaded.data;
  const total = totalOf(counts);
  const sample = messages.rows.find((m) => m.body)?.body;
  const href = (p: number, s = status) => {
    const q = new URLSearchParams();
    if (s) q.set("status", s);
    if (p > 1) q.set("page", String(p));
    const qs = q.toString();
    return `/whatsapp/campaigns/${id}${qs ? `?${qs}` : ""}`;
  };

  return (
    <>
      <PageHeader
        title={campaign.name}
        breadcrumbs={[{ label: "WhatsApp", href: "/whatsapp" }, { label: campaign.name }]}
        description={`Template ${template?.name ?? "(deleted)"} · created ${formatDateTime(campaign.created_at)}`}
        actions={<><ModeBadge mode={campaign.mode} /><CampaignStatusBadge status={campaign.status} /></>}
      />
      <div className="mb-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-4">
          <CampaignRunner id={campaign.id} status={campaign.status} mode={campaign.mode} pausedReason={campaign.paused_reason} counts={counts} />
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {["queued", "sent", "delivered", "read", "failed", "skipped"].map((s) => (
              <Link key={s} href={href(1, status === s ? "" : s)} className={`rounded-lg border p-3 hover:bg-surface-muted ${status === s ? "border-accent bg-accent-soft" : "border-border bg-surface"}`} aria-current={status === s}>
                <p className="text-xs capitalize text-muted">{s}</p>
                <p className="text-xl font-semibold tabular-nums">{counts[s] ?? 0}</p>
              </Link>
            ))}
          </div>
          {campaign.mode === "dry_run" && <p className="text-xs text-muted">Dry run: “sent” means the message went through the whole flow but nothing was delivered to anyone. Delivered and read statuses only appear for live campaigns.</p>}
        </div>
        <div className="rounded-lg border border-border bg-surface p-4">
          <h2 className="text-sm font-semibold">Message sample</h2>
          <p className="mb-3 text-xs text-muted">As the first recipient on this page will see it.</p>
          {sample ? <Bubble text={sample} /> : <p className="text-sm text-muted">No messages.</p>}
        </div>
      </div>
      <Card>
        <CardHeader title={status ? `Recipients · ${status}` : "Recipients"} action={status ? <Link href={href(1, "")} className="text-xs text-muted hover:underline">Show all</Link> : <span className="text-xs text-muted">{total} total</span>} />
        {messages.rows.length === 0 ? (
          <EmptyState title="No recipients here" />
        ) : (
          <>
            <DataTable>
              <thead><tr><Th>Person</Th><Th>Number</Th><Th>Status</Th><Th>Sent</Th><Th>Note</Th></tr></thead>
              <tbody>
                {messages.rows.map((m) => (
                  <tr key={m.id}>
                    <Td><Link href={`/contacts/${m.contact_id}`} className="font-medium hover:text-accent hover:underline">{m.contact?.full_name ?? "—"}</Link></Td>
                    <Td className="whitespace-nowrap tabular-nums text-muted">{maskPhone(m.to_phone)}</Td>
                    <Td><MessageStatusBadge status={m.status} /></Td>
                    <Td className="whitespace-nowrap text-muted">{m.sent_at ? formatDateTime(m.sent_at) : "—"}</Td>
                    <Td className="max-w-xs text-xs text-danger">{m.error ?? ""}</Td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
            <Pagination page={page} pageSize={messages.pageSize} total={messages.total} hrefFor={(p) => href(p)} />
          </>
        )}
      </Card>
    </>
  );
}
