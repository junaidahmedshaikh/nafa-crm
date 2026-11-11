import Link from "next/link";
import { Users } from "lucide-react";
import { Stat } from "@/components/email/bits";
import { GroupActions, GroupsToolbar, TypeBadge } from "@/components/email/group-ui";
import { Badge } from "@/components/ui/badge";
import { Card, DataTable, EmptyState, PageHeader, Td, Th } from "@/components/ui/layout";
import { requireMember } from "@/lib/auth";
import { formatDate } from "@/lib/datetime";
import { loadGroupSummaries } from "@/lib/email/group-stats";
import { cn } from "@/lib/utils";

export const metadata = { title: "Recipient groups" };
export const dynamic = "force-dynamic";

export default async function GroupsPage({ searchParams }: PageProps<"/email-marketing/groups">) {
  const sp = await searchParams;
  const showArchived = (Array.isArray(sp.archived) ? sp.archived[0] : sp.archived) === "1";
  const { supabase, profile } = await requireMember();
  const all = await loadGroupSummaries(supabase);
  const groups = all.filter((g) => (showArchived ? g.status === "archived" : g.status === "active"));
  const active = all.filter((g) => g.status === "active");
  return (
    <>
      <PageHeader title="Recipient groups" description="Organise your existing CRM contacts into lists for email campaigns. Groups never copy contact data — they always reflect the Contacts page." />
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Active groups" value={active.length} />
        <Stat label="Dynamic groups" value={active.filter((g) => g.group_type === "dynamic").length} />
        <Stat label="Contacts in groups" value={active.reduce((n, g) => n + g.contacts, 0)} note="Counts a contact once per group" />
        <Stat label="Emailable in groups" value={active.reduce((n, g) => n + g.eligible, 0)} note="Valid, not suppressed" />
      </div>
      <GroupsToolbar empty={all.length === 0} />
      <div className="mb-3 flex gap-2 text-sm">
        <Link href="/email-marketing/groups" className={cn("rounded-md px-3 py-1.5", !showArchived ? "bg-foreground/10 font-medium" : "text-muted hover:text-foreground")}>Active</Link>
        <Link href="/email-marketing/groups?archived=1" className={cn("rounded-md px-3 py-1.5", showArchived ? "bg-foreground/10 font-medium" : "text-muted hover:text-foreground")}>Archived</Link>
      </div>
      <Card>
        {groups.length === 0 ? <EmptyState icon={Users} title={showArchived ? "No archived groups" : "No groups yet"} description="Create a group, then assign contacts from the Contacts page." /> : (
          <DataTable>
            <thead><tr><Th>Group</Th><Th>Type</Th><Th>Category / industry</Th><Th>Location</Th><Th className="text-right">Contacts</Th><Th className="text-right">Emailable</Th><Th>Created</Th><Th>Last campaign</Th><Th>Status</Th><Th /></tr></thead>
            <tbody>
              {groups.map((g) => (
                <tr key={g.id}>
                  <Td><Link href={`/email-marketing/groups/${g.id}`} className="font-medium hover:underline">{g.name}</Link>{g.description && <p className="max-w-xs truncate text-xs text-muted">{g.description}</p>}</Td>
                  <Td><TypeBadge t={g.group_type} /></Td>
                  <Td className="text-sm">{[g.business_category, g.target_industry].filter(Boolean).join(" · ") || "—"}</Td>
                  <Td>{g.location || "—"}</Td>
                  <Td className="text-right tabular-nums">{g.contacts}</Td>
                  <Td className="text-right tabular-nums">{g.eligible}</Td>
                  <Td>{formatDate(g.created_at)}</Td>
                  <Td>{g.lastCampaignAt ? formatDate(g.lastCampaignAt) : "Never"}</Td>
                  <Td><Badge tone={g.status === "active" ? "success" : "neutral"}>{g.status}</Badge></Td>
                  <Td><GroupActions id={g.id} status={g.status} isAdmin={profile.role === "admin"} name={g.name} /></Td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}
      </Card>
    </>
  );
}
