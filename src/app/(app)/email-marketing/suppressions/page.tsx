import { SuppressionControls } from "@/components/email/email-admin";
import { Card, CardHeader, DataTable, EmptyState, PageHeader, Td, Th } from "@/components/ui/layout";
import { requireMember } from "@/lib/auth";
import { formatDateTime } from "@/lib/datetime";

export const metadata = { title: "Unsubscribed & suppressed" };
export const dynamic = "force-dynamic";

export default async function SuppressionsPage() {
  const { supabase, profile } = await requireMember();
  const { data } = await supabase.from("email_suppressions").select("id, email, reason, source, created_at").order("created_at", { ascending: false }).limit(500);
  const rows = data ?? [];
  return (
    <>
      <PageHeader title="Unsubscribed & suppressed" description="One central do-not-email list. Every campaign checks it before every send." />
      <Card className="mb-6"><CardHeader title="Add an address" /><SuppressionControls /></Card>
      <Card>
        {rows.length === 0 ? <EmptyState title="Nobody has unsubscribed yet" /> : (
          <DataTable>
            <thead><tr><Th>Email</Th><Th>Reason</Th><Th>Source</Th><Th>Added</Th><Th /></tr></thead>
            <tbody>{rows.map((r) => <tr key={r.id}><Td>{r.email}</Td><Td>{r.reason}</Td><Td>{r.source || "—"}</Td><Td>{formatDateTime(r.created_at)}</Td><Td><SuppressionControls id={r.id} isAdmin={profile.role === "admin"} /></Td></tr>)}</tbody>
          </DataTable>
        )}
      </Card>
    </>
  );
}
