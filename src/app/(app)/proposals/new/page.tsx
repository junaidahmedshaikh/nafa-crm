import { ProposalForm } from "@/components/documents/proposal-form";
import { PageHeader } from "@/components/ui/layout";
import { requireMember } from "@/lib/auth";
import { newProposalValues } from "@/lib/documents/defaults";
import { listLeadOptions, todayIST } from "@/lib/documents/repo";

export const metadata = { title: "New proposal" };

export default async function NewProposalPage({ searchParams }: PageProps<"/proposals/new">) {
  const sp = await searchParams;
  const leadParam = Array.isArray(sp.lead) ? sp.lead[0] : sp.lead;
  const { supabase } = await requireMember();
  const [leads, { data: quotes }] = await Promise.all([
    listLeadOptions(supabase),
    supabase.from("quotation_list").select("id, number, client_company, grand_total").neq("status", "draft").order("created_at", { ascending: false }).limit(200),
  ]);
  return (
    <>
      <PageHeader
        title="New proposal"
        breadcrumbs={[{ label: "Proposals", href: "/proposals" }, { label: "New" }]}
        description="Starts with the 15 standard sections, all empty. Save the draft, then you can attach images to sections."
      />
      <ProposalForm defaults={newProposalValues(todayIST(), leads.find((l) => l.id === leadParam))} leads={leads} quotations={quotes ?? []} attachments={[]} />
    </>
  );
}
