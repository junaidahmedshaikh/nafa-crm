"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Papa from "papaparse";
import { AlertTriangle, CheckCircle2, FileUp, Pencil, Plus, Power, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { ConfirmDialog, Modal } from "@/components/ui/modal";
import { addVendorCategory, deleteVendorRecord, importVendorRates, saveVendorProfile, saveVendorRate, setVendorRateActive, type DeleteKind, type ImportSummary } from "@/lib/actions/vendors";
import { formatINR } from "@/lib/format";
import { estimatedCost, parseImportRows, RATE_TYPES, RATE_TYPE_LABEL, UNITS, VENDOR_STATUSES, VENDOR_STATUS_LABEL, type ImportRow } from "@/lib/vendors/core";
import type { RateRow, VendorRow } from "@/lib/vendors/repo";

const wide = "max-w-3xl max-h-[calc(100dvh-2rem)] overflow-y-auto";
const fd = (form: HTMLFormElement) => Object.fromEntries(new FormData(form)) as Record<string, string>;
const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));

// ---------------------------------------------------------------------------
// Vendor add / edit
// ---------------------------------------------------------------------------
export function VendorFormButton({ vendor, categories, canAddCategory = true, label, variant = "primary" }: { vendor?: VendorRow; categories: string[]; canAddCategory?: boolean; label?: string; variant?: "primary" | "secondary" }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const v = vendor;
  const cats = v?.category && !categories.includes(v.category) ? [...categories, v.category] : categories;

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = fd(e.currentTarget);
    startTransition(async () => {
      if (f.new_category?.trim()) {
        const c = await addVendorCategory(f.new_category);
        if (!c.ok && !c.error.includes("already exists")) { toast.error(c.error); return; }
      }
      const r = await saveVendorProfile({
        ...f, name: f.name, category: f.new_category?.trim() || f.category, gst_registered: f.gst_registered === "on", is_preferred: f.is_preferred === "on",
        status: f.status as (typeof VENDOR_STATUSES)[number],
      }, v?.id);
      if (r.ok) { toast.success(v ? "Vendor updated" : "Vendor added"); setOpen(false); setErrors({}); if (!v) router.push(`/products-services/vendors/${r.data.id}`); else router.refresh(); }
      else { setErrors(r.fieldErrors ?? {}); toast.error(r.error); }
    });
  }
  const t = (name: keyof VendorRow & string, lbl: string, extra: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <Field label={lbl} error={errors[name]}>{(p) => <Input {...p} name={name} defaultValue={str(v?.[name])} disabled={pending} {...extra} />}</Field>
  );
  const rate = (name: keyof VendorRow & string, lbl: string) => (
    <Field label={lbl} error={errors[name]}>{(p) => (
      <Select {...p} name={name} defaultValue={str(v?.[name])} disabled={pending}><option value="">Not rated</option>{[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n} / 5</option>)}</Select>)}
    </Field>
  );

  return (
    <>
      <Button variant={variant} size={v ? "md" : "sm"} onClick={() => setOpen(true)}>{v ? <Pencil className="h-4 w-4" aria-hidden /> : <Plus className="h-4 w-4" aria-hidden />}{label ?? (v ? "Edit vendor" : "Add vendor")}</Button>
      {open && (
        <Modal open onClose={() => setOpen(false)} title={v ? `Edit ${v.name}` : "Add vendor"} description="Internal vendor record. None of this appears on client documents." className={wide}>
          <form className="space-y-5" onSubmit={submit} noValidate>
            <fieldset className="grid gap-4 sm:grid-cols-2">
              <legend className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Basic information</legend>
              <Field label="Vendor / company name" required error={errors.name} className="sm:col-span-2">{(p) => <Input {...p} name="name" defaultValue={v?.name ?? ""} maxLength={200} disabled={pending} autoFocus />}</Field>
              {t("contact_person", "Contact person")}{t("phone", "Mobile number")}{t("whatsapp", "WhatsApp number")}{t("email", "Email address", { type: "email" })}
              {t("website", "Website")}{t("city", "City")}{t("state", "State")}{t("service_locations", "Service locations", { placeholder: "Mumbai, Pune, PAN-India…" })}
              <Field label="Full address" error={errors.address} className="sm:col-span-2">{(p) => <Textarea {...p} name="address" rows={2} defaultValue={v?.address ?? ""} disabled={pending} />}</Field>
            </fieldset>
            <fieldset className="grid gap-4 sm:grid-cols-2">
              <legend className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Business information</legend>
              <Field label="Vendor category" error={errors.category}>{(p) => (
                <Select {...p} name="category" defaultValue={v?.category ?? ""} disabled={pending}><option value="">Choose…</option>{cats.map((c) => <option key={c} value={c}>{c}</option>)}</Select>)}
              </Field>
              {canAddCategory ? <Field label="…or add a new category">{(p) => <Input {...p} name="new_category" maxLength={80} disabled={pending} />}</Field> : <div />}
              <Field label="Services provided" error={errors.services_provided} className="sm:col-span-2">{(p) => <Textarea {...p} name="services_provided" rows={2} defaultValue={v?.services_provided ?? ""} disabled={pending} />}</Field>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="gst_registered" className="h-4 w-4" defaultChecked={v?.gst_registered} disabled={pending} />GST registered</label>
              <div />
              {t("gstin", "GSTIN (optional)", { maxLength: 15 })}{t("pan", "PAN (optional)", { maxLength: 10 })}
              {t("payment_terms", "Payment terms")}{t("credit_period_days", "Credit period (days)", { inputMode: "numeric" })}
              {t("advance_requirement", "Advance payment requirement", { placeholder: "e.g. 50% advance" })}
              <Field label="Vendor status" error={errors.status}>{(p) => (
                <Select {...p} name="status" defaultValue={v?.status ?? "active"} disabled={pending}>{VENDOR_STATUSES.map((s) => <option key={s} value={s}>{VENDOR_STATUS_LABEL[s]}</option>)}</Select>)}
              </Field>
              <Field label="Internal notes" error={errors.notes} className="sm:col-span-2">{(p) => <Textarea {...p} name="notes" rows={2} defaultValue={v?.notes ?? ""} disabled={pending} />}</Field>
            </fieldset>
            <fieldset className="grid gap-4 sm:grid-cols-4">
              <legend className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Performance (entered by your team)</legend>
              {rate("rating_quality", "Quality")}{rate("rating_pricing", "Pricing")}{rate("rating_reliability", "Reliability")}{rate("rating_timeliness", "Timeliness")}
              <label className="flex items-center gap-2 text-sm sm:col-span-4"><input type="checkbox" name="is_preferred" className="h-4 w-4" defaultChecked={v?.is_preferred} disabled={pending} />Preferred vendor</label>
              <Field label="Past project references" error={errors.past_projects} className="sm:col-span-2">{(p) => <Textarea {...p} name="past_projects" rows={2} defaultValue={v?.past_projects ?? ""} disabled={pending} />}</Field>
              <Field label="Internal feedback" error={errors.feedback} className="sm:col-span-2">{(p) => <Textarea {...p} name="feedback" rows={2} defaultValue={v?.feedback ?? ""} disabled={pending} />}</Field>
            </fieldset>
            <div className="flex justify-end gap-2"><Button onClick={() => setOpen(false)} disabled={pending}>Cancel</Button><Button type="submit" variant="primary" loading={pending}>{v ? "Save vendor" : "Add vendor"}</Button></div>
          </form>
        </Modal>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Rate add / edit (an edit that changes the price keeps the old price in the history)
// ---------------------------------------------------------------------------
type Opt = { id: string; name: string };
export function RateFormButton({ rate, vendors, products, vendorId, label, size = "sm", variant = "primary" }: { rate?: RateRow; vendors: Opt[]; products: Opt[]; vendorId?: string; label?: string; size?: "sm" | "icon"; variant?: "primary" | "secondary" | "ghost" }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [type, setType] = useState(rate?.rate_type ?? "purchase");
  const r = rate;

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = fd(e.currentTarget);
    startTransition(async () => {
      const res = await saveVendorRate({ ...f, unit: f.unit, vendor_id: r?.vendor_id ?? f.vendor_id, product_id: r?.product_id ?? (f.product_id || null), rate_type: f.rate_type as (typeof RATE_TYPES)[number] }, r?.id);
      if (res.ok) { toast.success(r ? "Rate updated. The previous price is kept in the history." : "Rate added"); setOpen(false); setErrors({}); router.refresh(); }
      else { setErrors(res.fieldErrors ?? {}); toast.error(res.error); }
    });
  }
  const n = (name: keyof RateRow & string, lbl: string, hint?: string) => (
    <Field label={lbl} error={errors[name]} hint={hint}>{(p) => <Input {...p} name={name} inputMode="decimal" defaultValue={r ? str(r[name]) : ""} disabled={pending} />}</Field>
  );
  const t = (name: keyof RateRow & string, lbl: string, extra: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <Field label={lbl} error={errors[name]}>{(p) => <Input {...p} name={name} defaultValue={r ? str(r[name]) : ""} disabled={pending} {...extra} />}</Field>
  );

  return (
    <>
      {size === "icon"
        ? <Button size="icon" variant="ghost" onClick={() => setOpen(true)} aria-label="Edit rate" title="Edit rate"><Pencil className="h-4 w-4" aria-hidden /></Button>
        : <Button size="sm" variant={variant} onClick={() => setOpen(true)}><Plus className="h-4 w-4" aria-hidden />{label ?? "Add vendor rate"}</Button>}
      {open && (
        <Modal open onClose={() => setOpen(false)} title={r ? `Update rate · ${r.product_name}` : "Add vendor rate"} description={r ? `${r.vendor_name}. Changing the price saves the old one to the rate history.` : "A vendor's price for one service. The same service can have rates from many vendors."} className={wide}>
          <form className="space-y-4" onSubmit={submit} noValidate>
            {!r && (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Vendor" required error={errors.vendor_id}>{(p) => (
                  <Select {...p} name="vendor_id" defaultValue={vendorId ?? ""} disabled={pending || !!vendorId}><option value="">Choose a vendor…</option>{vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</Select>)}
                </Field>
                {vendorId && <input type="hidden" name="vendor_id" value={vendorId} />}
                <Field label="Existing service / product" error={errors.product_id}>{(p) => (
                  <Select {...p} name="product_id" defaultValue="" disabled={pending}><option value="">New service (enter below)…</option>{products.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</Select>)}
                </Field>
                <Field label="New service / product name" error={errors.product_name} hint="Only when it is not in the list above.">{(p) => <Input {...p} name="product_name" maxLength={200} disabled={pending} />}</Field>
                <Field label="Service category">{(p) => <Input {...p} name="product_category" maxLength={100} disabled={pending} />}</Field>
                <Field label="Detailed description" className="sm:col-span-2">{(p) => <Textarea {...p} name="description" rows={2} disabled={pending} />}</Field>
              </div>
            )}
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Rate type" required error={errors.rate_type}>{(p) => (
                <Select {...p} name="rate_type" value={type} onChange={(e) => setType(e.target.value)} disabled={pending}>{RATE_TYPES.map((x) => <option key={x} value={x}>{RATE_TYPE_LABEL[x]}</option>)}</Select>)}
              </Field>
              <Field label="Unit of measurement" required error={errors.unit}>{(p) => <><Input {...p} name="unit" list="vendor-units" defaultValue={r?.unit ?? ""} maxLength={40} disabled={pending} /><datalist id="vendor-units">{UNITS.map((u) => <option key={u} value={u} />)}</datalist></>}</Field>
              {n("rate", "Vendor rate (₹)")}
              {n("setup_charges", "Setup / installation (₹)")}{n("transport_charges", "Transportation (₹)")}{n("other_charges", "Additional charges (₹)")}
              {n("gst_percent", "GST %")}{n("min_order_qty", "Minimum order quantity")}
              <Field label="Rate valid until" error={errors.valid_until}>{(p) => <Input {...p} name="valid_until" type="date" defaultValue={r?.valid_until ?? ""} disabled={pending} />}</Field>
            </div>
            {type === "rental" && (
              <div className="grid gap-4 rounded-md border border-border p-3 sm:grid-cols-3">
                {t("rental_duration", "Rental duration", { placeholder: "e.g. 3 days" })}{n("weekly_rate", "Weekly rate (₹)")}{n("monthly_rate", "Monthly rate (₹)")}
                {n("security_deposit", "Security deposit (₹)")}<div className="sm:col-span-2">{t("damage_charges", "Damage / replacement charges")}</div>
              </div>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              {t("availability", "Availability", { placeholder: "e.g. 2 units, 7 days notice" })}{t("service_location", "Service location")}
              <Field label="Specifications" error={errors.specifications} className="sm:col-span-2">{(p) => <Textarea {...p} name="specifications" rows={2} defaultValue={r?.specifications ?? ""} disabled={pending} />}</Field>
              <Field label="Notes" error={errors.notes} className="sm:col-span-2">{(p) => <Textarea {...p} name="notes" rows={2} defaultValue={r?.notes ?? ""} disabled={pending} />}</Field>
            </div>
            {r && (
              <div className="grid gap-4 rounded-md border border-border p-3 sm:grid-cols-2">
                <Field label="New rate effective from" error={errors.effective_from}>{(p) => <Input {...p} name="effective_from" type="date" disabled={pending} />}</Field>
                <Field label="Reason for the change" hint="Saved with the previous price in the history.">{(p) => <Input {...p} name="change_note" maxLength={300} disabled={pending} />}</Field>
              </div>
            )}
            <div className="flex justify-end gap-2"><Button onClick={() => setOpen(false)} disabled={pending}>Cancel</Button><Button type="submit" variant="primary" loading={pending}>{r ? "Update rate" : "Add rate"}</Button></div>
          </form>
        </Modal>
      )}
    </>
  );
}

export function RateActiveToggle({ id, active }: { id: string; active: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button size="icon" variant="ghost" disabled={pending} title={active ? "Deactivate rate" : "Reactivate rate"} aria-label={active ? "Deactivate rate" : "Reactivate rate"}
      onClick={() => startTransition(async () => { const r = await setVendorRateActive(id, !active); if (r.ok) toast.success(active ? "Rate deactivated (history kept)" : "Rate reactivated"); else toast.error(r.error); router.refresh(); })}>
      <Power className={active ? "h-4 w-4 text-success" : "h-4 w-4 text-muted"} aria-hidden />
    </Button>
  );
}

const DELETE_COPY: Record<DeleteKind, { title: string; body: string; done: string }> = {
  vendor: { title: "Delete this vendor?", body: "The vendor and all of its rates disappear from the catalogue, comparisons and the quotation cost lookup. Bills and payments already recorded against it are kept.", done: "Vendor deleted" },
  rate: { title: "Delete this rate?", body: "The rate disappears from the catalogue and comparisons. Its price history is kept in the database.", done: "Rate deleted" },
  item: { title: "Delete this catalogue item?", body: "It will no longer be offered when building quotations and invoices. Documents that already use it keep their own text and price. This cannot be undone.", done: "Item deleted" },
};

/** Delete with a confirmation step. `redirectTo` is where to go when the page being viewed is the thing deleted. */
export function DeleteButton({ kind, id, name, redirectTo, withLabel }: { kind: DeleteKind; id: string; name: string; redirectTo?: string; withLabel?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const copy = DELETE_COPY[kind];
  return (
    <>
      {withLabel
        ? <Button variant="danger-outline" onClick={() => setOpen(true)}><Trash2 className="h-4 w-4" aria-hidden />Delete</Button>
        : <Button size="icon" variant="ghost" onClick={() => setOpen(true)} aria-label={`Delete ${name}`} title="Delete"><Trash2 className="h-4 w-4 text-danger" aria-hidden /></Button>}
      <ConfirmDialog open={open} onClose={() => setOpen(false)} pending={pending} confirmLabel="Delete" title={copy.title} description={`${name}. ${copy.body}`}
        onConfirm={() => startTransition(async () => {
          const r = await deleteVendorRecord(kind, id);
          setOpen(false);
          if (!r.ok) { toast.error(r.error); return; }
          toast.success(copy.done);
          if (redirectTo) router.replace(redirectTo); else router.refresh();
        })} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Spreadsheet import: parse in the browser, review every row, then save only what was approved
// ---------------------------------------------------------------------------
export function ImportRatesButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [parsed, setParsed] = useState<{ raw: Record<string, unknown>[]; rows: ImportRow[]; unknown: string[]; missing: string[] } | null>(null);
  const [done, setDone] = useState<ImportSummary | null>(null);
  const [fileError, setFileError] = useState("");
  const close = () => { setOpen(false); setParsed(null); setDone(null); setFileError(""); };

  function onFile(file: File | undefined) {
    setParsed(null); setDone(null); setFileError("");
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) return setFileError("The file is larger than 2 MB. Split it into smaller files.");
    if (!/\.(csv|txt)$/i.test(file.name)) return setFileError("Save the sheet as CSV first (Excel: File > Save As > CSV UTF-8), then upload the .csv file.");
    Papa.parse<Record<string, unknown>>(file, {
      header: true, skipEmptyLines: "greedy",
      complete: (res) => {
        const raw = res.data.slice(0, 500);
        const p = parseImportRows(raw);
        setParsed({ raw, rows: p.rows, unknown: p.unknownColumns, missing: p.missingColumns });
        if (res.data.length > 500) setFileError("Only the first 500 rows are shown. Import the rest in a second file.");
      },
      error: () => setFileError("The file could not be read."),
    });
  }
  const good = parsed?.rows.filter((r) => !r.errors.length) ?? [];
  const bad = parsed?.rows.filter((r) => r.errors.length) ?? [];

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}><Upload className="h-4 w-4" aria-hidden />Import Excel</Button>
      {open && (
        <Modal open onClose={close} title="Import vendor rates" description="Upload a spreadsheet, review every row, then approve. Nothing is saved until you confirm." className="max-w-5xl max-h-[calc(100dvh-2rem)] overflow-y-auto">
          {done ? (
            <div className="space-y-3 text-sm">
              <p className="flex items-center gap-2 rounded-md bg-success-soft px-3 py-2 text-success"><CheckCircle2 className="h-4 w-4" aria-hidden />Import finished: {done.ratesCreated} rate{done.ratesCreated === 1 ? "" : "s"} added, {done.ratesUpdated} updated, {done.vendorsCreated} new vendor{done.vendorsCreated === 1 ? "" : "s"}, {done.servicesCreated} new service{done.servicesCreated === 1 ? "" : "s"}.</p>
              {done.skipped.length > 0 && <ul className="list-disc space-y-1 pl-5 text-danger">{done.skipped.map((s) => <li key={s.line}>Row {s.line}: {s.reason}</li>)}</ul>}
              <div className="flex justify-end"><Button variant="primary" onClick={close}>Done</Button></div>
            </div>
          ) : (
            <div className="space-y-4 text-sm">
              <div className="flex flex-wrap items-center gap-3">
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-border-strong bg-surface px-3 py-2 font-medium hover:bg-surface-muted">
                  <FileUp className="h-4 w-4" aria-hidden />Choose CSV file<input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} />
                </label>
                <a className="text-accent underline" href="/api/export/vendor-rate-template" download>Download the template</a>
                <span className="text-xs text-muted">Opens in Excel. Save as CSV before uploading. Up to 500 rows.</span>
              </div>
              {fileError && <p className="rounded-md bg-warning-soft px-3 py-2 text-warning" role="alert">{fileError}</p>}
              {parsed && (
                <>
                  {parsed.missing.length > 0 && <p className="flex items-start gap-2 rounded-md bg-danger-soft px-3 py-2 text-danger" role="alert"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />Required column{parsed.missing.length === 1 ? "" : "s"} missing: {parsed.missing.join(", ")}. Use the template headings.</p>}
                  {parsed.unknown.length > 0 && <p className="text-xs text-muted">Ignored columns: {parsed.unknown.join(", ")}</p>}
                  <p><span className="font-semibold text-success">{good.length} row{good.length === 1 ? "" : "s"} ready</span>{bad.length > 0 && <span className="font-semibold text-danger"> · {bad.length} with errors (will be skipped)</span>}. Existing vendors and services are matched by name and never duplicated; an existing rate is updated and its old price kept in the history.</p>
                  <div className="max-h-[45vh] overflow-auto rounded-md border border-border">
                    <table className="w-full min-w-[820px] text-left text-xs">
                      <thead className="sticky top-0 bg-surface-muted"><tr>{["Row", "Vendor", "Service", "Type", "Unit", "Rate", "Charges", "GST %", "Valid until", "Check"].map((h) => <th key={h} className="px-2 py-1.5 font-semibold">{h}</th>)}</tr></thead>
                      <tbody className="divide-y divide-border">
                        {parsed.rows.map((r) => (
                          <tr key={r.line} className={r.errors.length ? "bg-danger-soft/40" : undefined}>
                            <td className="px-2 py-1.5 text-muted">{r.line}</td><td className="px-2 py-1.5">{r.vendor.name}<span className="block text-muted">{r.vendor.city}</span></td>
                            <td className="px-2 py-1.5">{r.service.name}</td><td className="px-2 py-1.5">{RATE_TYPE_LABEL[r.rate.rate_type]}</td><td className="px-2 py-1.5">{r.rate.unit}</td>
                            <td className="px-2 py-1.5 tabular-nums">{formatINR(r.rate.rate, { exact: true })}</td>
                            <td className="px-2 py-1.5 tabular-nums">{formatINR(r.rate.setup_charges + r.rate.transport_charges + r.rate.other_charges, { exact: true })}</td>
                            <td className="px-2 py-1.5">{r.rate.gst_percent}</td><td className="px-2 py-1.5">{r.rate.valid_until ?? "—"}</td>
                            <td className="px-2 py-1.5">{r.errors.length ? <span className="text-danger">{r.errors.join("; ")}</span> : <span className="text-success">OK · est. {formatINR(estimatedCost(r.rate), { exact: true })}</span>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
              <div className="flex justify-end gap-2">
                <Button onClick={close} disabled={pending}>Cancel</Button>
                <Button variant="primary" loading={pending} disabled={!good.length}
                  onClick={() => startTransition(async () => {
                    // Send only the rows that passed review; the server validates each one again.
                    const okLines = new Set(good.map((g) => g.line));
                    const r = await importVendorRates(parsed!.raw.filter((_, i) => okLines.has(i + 2)));
                    if (r.ok) { setDone(r.data); router.refresh(); } else toast.error(r.error);
                  })}>Approve and import {good.length || ""} row{good.length === 1 ? "" : "s"}</Button>
              </div>
            </div>
          )}
        </Modal>
      )}
    </>
  );
}
