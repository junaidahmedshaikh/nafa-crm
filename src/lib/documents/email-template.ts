/** Default "Send by Email" wording for documents. Pure (no I/O) so the server action, the dialog and the tests share it. */
export type EmailDocType = "quotation" | "invoice" | "proposal";

const BRAND = "NAFA Events & Activations";
export const SIGNATURE = ["Regards,", "Team NAFA", BRAND, "www.nafaevents.in", "contact@nafaevents.in", "+91 81695 12822"].join("\n");

const BODY: Record<EmailDocType, string[]> = {
  quotation: [
    "Please find attached our quotation for your requested requirements.",
    "The document includes the proposed scope of work and commercials for your review.",
    "Please feel free to contact us if you require any clarification or adjustments. We would be happy to discuss and customize the proposal based on your requirements.",
    "We look forward to the opportunity to work with you.",
  ],
  invoice: [
    "Please find attached the invoice for your reference.",
    "Kindly review the details and let us know if any further information is required.",
    "We appreciate your business and look forward to continuing our association.",
  ],
  proposal: [
    "Please find attached our proposal for your review.",
    "Please feel free to contact us if you require any clarification or adjustments.",
    "We look forward to the opportunity to work with you.",
  ],
};

const LABEL: Record<EmailDocType, string> = { quotation: "Quotation", invoice: "Invoice", proposal: "Proposal" };

export function documentEmailDraft(type: EmailDocType, doc: { number: string; clientName?: string | null; clientCompany?: string | null }) {
  const greeting = doc.clientName?.trim() || doc.clientCompany?.trim() || "Sir/Madam";
  return {
    subject: `${LABEL[type]} ${doc.number} – ${BRAND}`,
    message: [`Dear ${greeting},`, ...BODY[type], SIGNATURE].join("\n\n"),
  };
}

/** "a@x.com, b@y.com; c@z.com" -> ["a@x.com", "b@y.com", "c@z.com"] (trimmed, lower-cased, de-duplicated). */
export function parseAddressList(raw: string | null | undefined): string[] {
  const out = (raw ?? "").split(/[,;\s]+/).map((a) => a.trim().toLowerCase()).filter(Boolean);
  return [...new Set(out)];
}
