import type { SupabaseClient } from "@supabase/supabase-js";
import { PAGE_SIZE } from "@/lib/constants";
import { pageRange, sanitizeSearch } from "@/lib/lead-filters";
import { followUpDraft, fillReminderTemplate, invoiceOpen, SCHEDULE_STATUSES, type RelatedType, type ReminderSettings } from "./core";
import type { ScheduledRow } from "./processor";

const isUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

export type ScheduledListRow = ScheduledRow & { assignee: { full_name: string } | null };

export async function listScheduledEmails(
  supabase: SupabaseClient,
  p: { status?: string; kind?: string; q?: string; page?: number; relatedType?: string; relatedId?: string; limit?: number },
) {
  let q = supabase.from("scheduled_emails").select("*, assignee:profiles!scheduled_emails_assigned_to_fkey(full_name)", { count: "exact" });
  if (p.status && (SCHEDULE_STATUSES as readonly string[]).includes(p.status)) q = q.eq("status", p.status);
  if (p.kind === "follow_up" || p.kind === "payment_reminder") q = q.eq("kind", p.kind);
  if (p.relatedType && p.relatedId && isUuid(p.relatedId)) q = q.eq("related_type", p.relatedType).eq("related_id", p.relatedId);
  const s = sanitizeSearch(p.q ?? "");
  if (s) q = q.or(`client_name.ilike.%${s}%,to_email.ilike.%${s}%,subject.ilike.%${s}%,related_label.ilike.%${s}%`);
  const [from, to] = p.limit ? [0, p.limit - 1] : pageRange(p.page ?? 1);
  const { data, count, error } = await q.order("created_at", { ascending: false }).range(from, to);
  // Before the migration is applied the table does not exist: show a setup notice instead of crashing the page.
  if (error) { console.error("[scheduled emails]", error.message); return { rows: [] as ScheduledListRow[], total: 0, pageSize: PAGE_SIZE, setupNeeded: true }; }
  return { rows: (data ?? []) as unknown as ScheduledListRow[], total: count ?? 0, pageSize: PAGE_SIZE, setupNeeded: false };
}

export const DEFAULT_REMINDER_SETTINGS: ReminderSettings = { enabled: false, offsets: [-7, -3, -1, 0, 3, 7, 15], send_hour: 10, subject: "", body: "" };

export async function getReminderSettings(supabase: SupabaseClient): Promise<ReminderSettings | null> {
  const { data } = await supabase.from("payment_reminder_settings").select("enabled, offsets, send_hour, subject, body").maybeSingle();
  return (data as ReminderSettings | null) ?? null;
}

export type Receivable = {
  id: string; number: string; client_name: string; client_company: string; project_name: string; due_date: string | null; grand_total: number;
  amount_received: number; balance_due: number; payment_status: string; auto_enabled: boolean; pending_reminders: number; last_reminder_at: string | null;
};

/** Issued invoices with money outstanding, oldest due date first, with their reminder state. */
export async function listReceivables(supabase: SupabaseClient, limit = 200): Promise<Receivable[]> {
  const { data } = await supabase.from("invoice_list")
    .select("id, number, client_name, client_company, project_name, due_date, grand_total, amount_received, balance_due, payment_status")
    .in("payment_status", ["issued", "partially_paid", "overdue"]).order("due_date", { ascending: true, nullsFirst: false }).limit(limit);
  const rows = ((data ?? []) as Record<string, unknown>[]).filter((r) => Number(r.balance_due) > 0.004);
  const ids = rows.map((r) => r.id as string);
  if (!ids.length) return [];
  const [prefs, rem] = await Promise.all([
    supabase.from("invoice_reminder_prefs").select("invoice_id, auto_enabled").in("invoice_id", ids),
    supabase.from("scheduled_emails").select("related_id, status, sent_at").eq("kind", "payment_reminder").eq("related_type", "invoice").in("related_id", ids).in("status", ["scheduled", "sent"]),
  ]);
  const off = new Set((prefs.data ?? []).filter((p) => !p.auto_enabled).map((p) => p.invoice_id as string));
  const pending = new Map<string, number>();
  const last = new Map<string, string>();
  for (const r of (rem.data ?? []) as { related_id: string; status: string; sent_at: string | null }[]) {
    if (r.status === "scheduled") pending.set(r.related_id, (pending.get(r.related_id) ?? 0) + 1);
    else if (r.sent_at && (!last.get(r.related_id) || r.sent_at > last.get(r.related_id)!)) last.set(r.related_id, r.sent_at);
  }
  return rows.map((r) => ({
    id: r.id as string, number: (r.number as string) ?? "", client_name: (r.client_name as string) ?? "", client_company: (r.client_company as string) ?? "",
    project_name: (r.project_name as string) ?? "", due_date: (r.due_date as string | null) ?? null, grand_total: Number(r.grand_total), amount_received: Number(r.amount_received),
    balance_due: Number(r.balance_due), payment_status: r.payment_status as string, auto_enabled: !off.has(r.id as string),
    pending_reminders: pending.get(r.id as string) ?? 0, last_reminder_at: last.get(r.id as string) ?? null,
  }));
}

/** Stops every reminder that has not gone out yet (invoice paid in full, or cancelled). Never throws: the payment itself must not fail. */
export async function cancelInvoiceReminders(supabase: SupabaseClient, invoiceId: string, reason: string): Promise<void> {
  try {
    await supabase.from("scheduled_emails").update({ status: "cancelled", cancel_reason: reason })
      .eq("kind", "payment_reminder").eq("related_type", "invoice").eq("related_id", invoiceId).in("status", ["draft", "scheduled", "failed"]);
  } catch (e) {
    console.error("[cancel reminders]", e);
  }
}

// ---------------------------------------------------------------------------
// What the composer starts from: the real record and its client (read with the caller's own access)
// ---------------------------------------------------------------------------
export type EmailContext = {
  relatedType: RelatedType | null; relatedId: string | null; label: string; clientName: string; to: string; canAttach: boolean;
  subject: string; body: string; blocked?: string;
};

async function companyContactEmail(supabase: SupabaseClient, companyId: string | null): Promise<{ email: string; name: string }> {
  if (!companyId) return { email: "", name: "" };
  const { data } = await supabase.from("contacts").select("email, full_name").eq("company_id", companyId).is("archived_at", null)
    .not("email_normalized", "is", null).order("created_at").limit(1);
  return { email: (data?.[0]?.email as string | undefined)?.trim() ?? "", name: (data?.[0]?.full_name as string | undefined) ?? "" };
}

export async function getEmailContext(supabase: SupabaseClient, type: RelatedType | null, id: string | null, kind: "follow_up" | "payment_reminder"): Promise<EmailContext | null> {
  if (!type || !id) return { relatedType: null, relatedId: null, label: "", clientName: "", to: "", canAttach: false, ...followUpDraft(null, {}) };
  if (!isUuid(id)) return null;
  const base = { relatedType: type, relatedId: id };

  if (type === "contact") {
    const { data: c } = await supabase.from("contacts").select("full_name, email, company:companies(name)").eq("id", id).maybeSingle();
    if (!c) return null;
    const company = (Array.isArray(c.company) ? c.company[0] : c.company) as { name: string } | null;
    return { ...base, label: c.full_name, clientName: company?.name || c.full_name, to: c.email?.trim() ?? "", canAttach: false, ...followUpDraft("contact", { name: c.full_name }) };
  }
  if (type === "lead") {
    const { data: l } = await supabase.from("leads").select("title, company_id, contact_id, contact:contacts(full_name, email), company:companies(name)").eq("id", id).maybeSingle();
    if (!l) return null;
    const contact = (Array.isArray(l.contact) ? l.contact[0] : l.contact) as { full_name: string; email: string | null } | null;
    const company = (Array.isArray(l.company) ? l.company[0] : l.company) as { name: string } | null;
    const fallback = contact?.email?.trim() ? null : await companyContactEmail(supabase, l.company_id);
    return {
      ...base, label: l.title, clientName: company?.name || contact?.full_name || "", to: contact?.email?.trim() || fallback?.email || "", canAttach: false,
      ...followUpDraft("lead", { name: contact?.full_name || fallback?.name, label: l.title }),
    };
  }
  if (type === "project") {
    const { data: p } = await supabase.from("projects").select("name, company_id, company:companies(name)").eq("id", id).maybeSingle();
    if (!p) return null;
    const company = (Array.isArray(p.company) ? p.company[0] : p.company) as { name: string } | null;
    const c = await companyContactEmail(supabase, p.company_id);
    return { ...base, label: p.name, clientName: company?.name || "", to: c.email, canAttach: false, ...followUpDraft("project", { name: c.name, label: p.name }) };
  }

  // quotation / invoice
  const table = type === "quotation" ? "quotations" : "invoices";
  const { data: d } = await supabase.from(table).select("*").eq("id", id).maybeSingle();
  if (!d) return null;
  let to = (d.client_email as string | null)?.trim() ?? "";
  if (!to && d.contact_id) {
    const { data: c } = await supabase.from("contacts").select("email").eq("id", d.contact_id).maybeSingle();
    to = c?.email?.trim() ?? "";
  }
  if (!to) to = (await companyContactEmail(supabase, d.company_id as string | null)).email;
  const number = (d.number as string | null) ?? "";
  const ctx = { ...base, label: number || "Draft", clientName: (d.client_company as string) || (d.client_name as string) || "", to, canAttach: !!number };
  const name = (d.client_name as string | null) || (d.client_company as string | null);

  if (type === "invoice" && kind === "payment_reminder") {
    const { data: pays } = await supabase.from("invoice_payments").select("amount").eq("invoice_id", id).is("voided_at", null);
    const balance = Math.round((Number(d.grand_total) - (pays ?? []).reduce((a, p) => a + Number(p.amount), 0)) * 100) / 100;
    const blocked = !number ? "Issue the invoice before sending a payment reminder."
      : !invoiceOpen(d.state as string, balance) ? (d.state === "cancelled" ? "This invoice has been cancelled." : "This invoice has been paid in full, so no reminder is needed.") : undefined;
    const s = await getReminderSettings(supabase);
    const inv = { number, client_name: d.client_name as string | null, client_company: d.client_company as string | null, project_name: d.project_name as string | null, balance_due: balance, due_date: d.due_date as string | null };
    const draft = s?.subject && s.body ? { subject: fillReminderTemplate(s.subject, inv).slice(0, 200), body: fillReminderTemplate(s.body, inv) } : followUpDraft("invoice", { name, label: number });
    return { ...ctx, ...draft, blocked };
  }
  return { ...ctx, ...followUpDraft(type, { name, label: number }) };
}
