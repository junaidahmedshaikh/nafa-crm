import { notFound, redirect } from "next/navigation";
import { ProposalForm } from "@/components/documents/proposal-form";
import { PageHeader } from "@/components/ui/layout";
import { requireMember } from "@/lib/auth";
import { getProposalFull, listLeadOptions } from "@/lib/documents/repo";
import type { ProposalFormValues } from "@/lib/documents/schemas";

export const metadata = { title: "Edit proposal" };

export default async function EditProposalPage({ params }: PageProps<"/proposals/[id]/edit">) {
  const { id } = await params;
  const { supabase } = await requireMember();
  const full = await getProposalFull(supabase, id);
  if (!full) notFound();
  if (full.row.status !== "draft") redirect(`/proposals/${id}`); // issued proposals are locked
  const [leads, { data: quotes }] = await Promise.all([
    listLeadOptions(supabase),
    supabase.from("quotation_list").select("id, number, client_company, grand_total").neq("status", "draft").order("created_at", { ascending: false }).limit(200),
  ]);
  const r = full.row;
  const defaults: ProposalFormValues = {
    lead_id: r.lead_id ?? "", company_id: r.company_id ?? "", contact_id: r.contact_id ?? "", quotation_id: r.quotation_id ?? "",
    client_name: r.client_name ?? "", client_company: r.client_company ?? "", client_address: r.client_address ?? "", client_email: r.client_email ?? "",
    client_phone: r.client_phone ?? "", client_gstin: r.client_gstin ?? "",
    title: r.title, proposal_date: r.proposal_date, commercial_mode: r.commercial_mode, commercial_note: r.commercial_note ?? "",
    sections: full.sections.map((s) => ({ id: s.id, type: s.type, title: s.title, body: s.body, included: s.included })),
  };
  return (
    <>
      <PageHeader title="Edit draft proposal" breadcrumbs={[{ label: "Proposals", href: "/proposals" }, { label: "Draft", href: `/proposals/${id}` }, { label: "Edit" }]} />
      <ProposalForm id={id} defaults={defaults} leads={leads} quotations={quotes ?? []} attachments={full.attachments} />
    </>
  );
}
