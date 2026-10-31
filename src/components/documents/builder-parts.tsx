"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useFieldArray, useFormContext, useWatch, type UseFormReturn } from "react-hook-form";
import { ArrowDown, ArrowUp, ExternalLink, Maximize2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Field, FormSection, Input, Select, Textarea } from "@/components/ui/form";
import { calculateDocument, computeMilestones, type CalcConfig, type DiscountSpec } from "@/lib/documents/calc";
import type { Product, LeadOption } from "@/lib/documents/repo";
import type { QuotationFormValues } from "@/lib/documents/schemas";
import { formatINR } from "@/lib/format";
import type { ActionResult } from "@/lib/types";
import { cn } from "@/lib/utils";

/** The parts of both document forms that the shared editors read/write. */
export type CommonValues = Pick<
  QuotationFormValues,
  "items" | "config" | "lead_id" | "company_id" | "contact_id" | "client_name" | "client_company" | "client_address" | "client_email" | "client_phone" | "client_gstin"
>;
const useCommonForm = () => useFormContext() as unknown as UseFormReturn<CommonValues>;

const errText = (e: unknown): string | undefined => (e && typeof e === "object" && "message" in e ? String((e as { message?: unknown }).message ?? "") || undefined : undefined);

// ---------------------------------------------------------------------------
// Live calculation shared by the summary panel
// ---------------------------------------------------------------------------
const spec = (d: { type: string; value: string } | undefined): DiscountSpec => (d && d.type && d.value ? { type: d.type as "percent" | "fixed", value: d.value } : null);

export function toCalcConfig(c: CommonValues["config"]): CalcConfig {
  return {
    discount: spec(c.discount),
    agency_fee: { enabled: !!c.agency_fee.enabled, rate: c.agency_fee.rate || "0", base: c.agency_fee.base },
    tax: { mode: c.tax.mode, rate: c.tax.rate || "0" },
    other_charges: (c.other_charges ?? []).map((o) => ({ label: o.label, amount: o.amount || "0", taxable: !!o.taxable })),
    round_to_rupee: !!c.round_to_rupee,
  };
}

export function useLiveCalc() {
  const { control } = useCommonForm();
  const items = useWatch({ control, name: "items" });
  const config = useWatch({ control, name: "config" });
  return useMemo(
    () => calculateDocument((items ?? []).map((i) => ({ qty: i.qty, rate: i.rate, discount: spec(i.discount) })), toCalcConfig(config)),
    [items, config],
  );
}

// ---------------------------------------------------------------------------
// Client / CRM link
// ---------------------------------------------------------------------------
export function ClientSection({ leads, onLead, requireNames }: { leads: LeadOption[]; onLead?: (lead: LeadOption) => void; requireNames?: boolean }) {
  const { register, setValue, control, formState: { errors } } = useCommonForm();
  const leadId = useWatch({ control, name: "lead_id" });
  return (
    <FormSection title="Client" description="Linked to your CRM. Selecting a lead fills the details below — you can still edit them for this document.">
      <input type="hidden" {...register("company_id")} />
      <input type="hidden" {...register("contact_id")} />
      <Field label="CRM lead" className="sm:col-span-2" hint="Optional. Links this document to the lead, company and contact.">
        {(p) => (
          <Select
            {...p}
            value={leadId ?? ""}
            onChange={(e) => {
              const lead = leads.find((l) => l.id === e.target.value);
              setValue("lead_id", e.target.value, { shouldDirty: true });
              if (!lead) {
                setValue("company_id", "");
                setValue("contact_id", "");
                return;
              }
              setValue("company_id", lead.company_id ?? "");
              setValue("contact_id", lead.contact_id ?? "");
              setValue("client_name", lead.contact_name ?? "");
              setValue("client_company", lead.company_name ?? "");
              setValue("client_email", lead.contact_email ?? "");
              setValue("client_phone", lead.contact_phone ?? "");
              onLead?.(lead);
            }}
          >
            <option value="">— Not linked to a lead —</option>
            {leads.map((l) => <option key={l.id} value={l.id}>L-{String(l.lead_number).padStart(4, "0")} · {l.title}{l.company_name ? ` — ${l.company_name}` : ""}</option>)}
          </Select>
        )}
      </Field>
      <Field label="Company" required={requireNames} error={errText(errors.client_company)}>{(p) => <Input {...p} {...register("client_company")} />}</Field>
      <Field label="Contact person" required={requireNames} error={errText(errors.client_name)}>{(p) => <Input {...p} {...register("client_name")} />}</Field>
      <Field label="Billing address" className="sm:col-span-2" error={errText(errors.client_address)}>{(p) => <Textarea {...p} {...register("client_address")} rows={2} />}</Field>
      <Field label="Email" error={errText(errors.client_email)}>{(p) => <Input {...p} {...register("client_email")} type="email" />}</Field>
      <Field label="Phone" error={errText(errors.client_phone)}>{(p) => <Input {...p} {...register("client_phone")} inputMode="tel" />}</Field>
      <Field label="GSTIN" hint="If applicable" error={errText(errors.client_gstin)}>{(p) => <Input {...p} {...register("client_gstin")} className="uppercase" />}</Field>
    </FormSection>
  );
}

// ---------------------------------------------------------------------------
// Line items
// ---------------------------------------------------------------------------
export function ItemsEditor({ catalogue, showHsn }: { catalogue: Product[]; showHsn?: boolean }) {
  const { control, register, formState: { errors } } = useCommonForm();
  const { fields, append, remove, move } = useFieldArray({ control, name: "items" });
  const live = useLiveCalc();
  const itemErrors = errors.items as unknown as Record<number, Record<string, unknown>> | undefined;

  return (
    <section className="rounded-lg border border-border bg-surface p-5" aria-labelledby="items-h">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="items-h" className="text-sm font-semibold">Line items</h2>
          <p className="text-xs text-muted">Quantities and prices accept decimals. Amounts are calculated automatically.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {catalogue.length > 0 && (
            <Select
              aria-label="Add from catalogue"
              className="w-56"
              value=""
              onChange={(e) => {
                const p = catalogue.find((x) => x.id === e.target.value);
                if (!p) return;
                append({ catalogue_id: p.id, description: p.name + (p.description ? ` — ${p.description}` : ""), notes: "", hsn_sac: p.hsn_sac ?? "", qty: "1", rate: String(p.default_rate), discount: { type: "", value: "" } });
              }}
            >
              <option value="">Add from catalogue…</option>
              {catalogue.map((p) => <option key={p.id} value={p.id}>{p.name} — {formatINR(p.default_rate)}/{p.unit}</option>)}
            </Select>
          )}
          <Button size="sm" onClick={() => append({ catalogue_id: "", description: "", notes: "", hsn_sac: "", qty: "1", rate: "", discount: { type: "", value: "" } })}>
            <Plus className="h-4 w-4" aria-hidden />Custom item
          </Button>
        </div>
      </div>

      {fields.length === 0 && <p className="rounded-md border border-dashed border-border-strong p-6 text-center text-sm text-muted">No items yet. Add a custom item or pick one from your catalogue.</p>}

      <ol className="space-y-3">
        {fields.map((f, i) => {
          const e = itemErrors?.[i] ?? {};
          return (
            <li key={f.id} className="rounded-md border border-border bg-surface-muted p-3">
              <div className="grid gap-3 md:grid-cols-12">
                <input type="hidden" {...register(`items.${i}.catalogue_id`)} />
                <Field label={`Item ${i + 1} — description`} required className="md:col-span-6" error={errText(e.description)}>
                  {(p) => <Textarea {...p} {...register(`items.${i}.description`)} rows={2} maxLength={1000} />}
                </Field>
                <Field label="Qty" required className="md:col-span-1" error={errText(e.qty)}>{(p) => <Input {...p} {...register(`items.${i}.qty`)} inputMode="decimal" />}</Field>
                <Field label="Rate (₹)" required className="md:col-span-2" error={errText(e.rate)}>{(p) => <Input {...p} {...register(`items.${i}.rate`)} inputMode="decimal" />}</Field>
                <div className="md:col-span-3">
                  <p className="mb-1.5 text-[13px] font-medium">Amount (₹)</p>
                  <p className="flex h-9 items-center justify-end rounded-md bg-surface px-3 text-sm font-semibold tabular-nums">{formatINR(live.lines[i]?.net ?? 0, { exact: true })}</p>
                  {(live.lines[i]?.discount ?? 0) > 0 && <p className="mt-0.5 text-right text-xs text-muted">after ₹{live.lines[i].discount.toFixed(2)} discount</p>}
                </div>
                <div className={cn("grid gap-3 md:col-span-12 md:grid-cols-12")}>
                  <Field label="Item discount" className="md:col-span-3">
                    {(p) => (
                      <div className="flex gap-2">
                        <Select {...p} {...register(`items.${i}.discount.type`)} className="w-28">
                          <option value="">None</option><option value="percent">%</option><option value="fixed">₹ fixed</option>
                        </Select>
                        <Input aria-label="Discount value" {...register(`items.${i}.discount.value`)} inputMode="decimal" placeholder="0" />
                      </div>
                    )}
                  </Field>
                  {showHsn && <Field label="HSN/SAC" className="md:col-span-2">{(p) => <Input {...p} {...register(`items.${i}.hsn_sac`)} />}</Field>}
                  <Field label="Item note (optional)" className={showHsn ? "md:col-span-5" : "md:col-span-7"}>{(p) => <Input {...p} {...register(`items.${i}.notes`)} maxLength={1000} />}</Field>
                  <div className="flex items-end justify-end gap-1 md:col-span-2">
                    <Button size="icon" variant="ghost" onClick={() => move(i, i - 1)} disabled={i === 0} aria-label={`Move item ${i + 1} up`}><ArrowUp className="h-4 w-4" /></Button>
                    <Button size="icon" variant="ghost" onClick={() => move(i, i + 1)} disabled={i === fields.length - 1} aria-label={`Move item ${i + 1} down`}><ArrowDown className="h-4 w-4" /></Button>
                    <Button size="icon" variant="ghost" onClick={() => remove(i)} aria-label={`Delete item ${i + 1}`}><Trash2 className="h-4 w-4 text-danger" /></Button>
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Discount, agency fee, tax, other charges
// ---------------------------------------------------------------------------
export function ConfigEditor() {
  const { control, register, formState: { errors } } = useCommonForm();
  const { fields, append, remove } = useFieldArray({ control, name: "config.other_charges" });
  const feeOn = useWatch({ control, name: "config.agency_fee.enabled" });
  const taxMode = useWatch({ control, name: "config.tax.mode" });
  const ce = errors.config as unknown as Record<string, Record<string, unknown>> | undefined;

  return (
    <FormSection title="Discounts, fees & tax" description="Applied in this order: item discounts → document discount → agency fee → tax → non-taxable charges. All are editable per document.">
      <Field label="Document discount" error={errText(ce?.discount?.value)}>
        {(p) => (
          <div className="flex gap-2">
            <Select {...p} {...register("config.discount.type")} className="w-28"><option value="">None</option><option value="percent">%</option><option value="fixed">₹ fixed</option></Select>
            <Input aria-label="Discount value" {...register("config.discount.value")} inputMode="decimal" placeholder="0" />
          </div>
        )}
      </Field>
      <div className="space-y-2">
        <label className="flex items-center gap-2 text-[13px] font-medium">
          <input type="checkbox" className="h-4 w-4" {...register("config.agency_fee.enabled")} /> Charge an agency / management fee
        </label>
        {feeOn && (
          <div className="flex gap-2">
            <Input aria-label="Agency fee percentage" {...register("config.agency_fee.rate")} inputMode="decimal" className="w-24" />
            <span className="flex items-center text-sm text-muted">% of</span>
            <Select aria-label="Fee base" {...register("config.agency_fee.base")}><option value="after_discount">subtotal after discount</option><option value="subtotal">gross subtotal</option></Select>
          </div>
        )}
        {errText(ce?.agency_fee?.rate) && <p role="alert" className="text-xs text-danger">{errText(ce?.agency_fee?.rate)}</p>}
      </div>
      <Field label="Tax treatment" hint="Choose deliberately — it is not guessed from the client's location.">
        {(p) => (
          <Select {...p} {...register("config.tax.mode")}>
            <option value="none">No tax charged</option>
            <option value="cgst_sgst">CGST + SGST (intra-state)</option>
            <option value="igst">IGST (inter-state)</option>
          </Select>
        )}
      </Field>
      <Field label="GST rate (%)" error={errText(ce?.tax?.rate)}>{(p) => <Input {...p} {...register("config.tax.rate")} inputMode="decimal" disabled={taxMode === "none"} />}</Field>
      <div className="sm:col-span-2">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-[13px] font-medium">Other charges</p>
          <Button size="sm" onClick={() => append({ label: "", amount: "", taxable: false })}><Plus className="h-4 w-4" aria-hidden />Add charge</Button>
        </div>
        {fields.map((f, i) => (
          <div key={f.id} className="mb-2 grid items-end gap-2 sm:grid-cols-12">
            <div className="sm:col-span-5"><Input aria-label={`Charge ${i + 1} label`} placeholder="e.g. Permit fees" {...register(`config.other_charges.${i}.label`)} /></div>
            <div className="sm:col-span-3"><Input aria-label={`Charge ${i + 1} amount`} placeholder="Amount ₹" inputMode="decimal" {...register(`config.other_charges.${i}.amount`)} /></div>
            <label className="flex h-9 items-center gap-2 text-sm sm:col-span-3"><input type="checkbox" className="h-4 w-4" {...register(`config.other_charges.${i}.taxable`)} /> Taxable</label>
            <Button size="icon" variant="ghost" className="sm:col-span-1" onClick={() => remove(i)} aria-label={`Remove charge ${i + 1}`}><Trash2 className="h-4 w-4 text-danger" /></Button>
          </div>
        ))}
      </div>
      <label className="flex items-center gap-2 text-[13px] font-medium sm:col-span-2">
        <input type="checkbox" className="h-4 w-4" {...register("config.round_to_rupee")} /> Round the grand total to the nearest rupee (shown as a separate “Round off” line)
      </label>
    </FormSection>
  );
}

// ---------------------------------------------------------------------------
// Live summary
// ---------------------------------------------------------------------------
export function SummaryPanel({ milestones }: { milestones?: { kind: "percent" | "fixed"; value: string; label: string }[] }) {
  const live = useLiveCalc();
  const { control } = useCommonForm();
  const config = useWatch({ control, name: "config" });
  const rate = Number(config.tax.rate || 0);
  const rows: [string, number, boolean?][] = [["Subtotal", live.subtotal]];
  if (live.discount > 0) rows.push(["Discount", -live.discount]);
  if (config.agency_fee.enabled) rows.push([`Agency fee (${Number(config.agency_fee.rate || 0)}%)`, live.agency_fee]);
  if (live.other_charges_taxable > 0) rows.push(["Taxable other charges", live.other_charges_taxable]);
  if (live.discount > 0 || live.agency_fee > 0 || live.other_charges_taxable > 0) rows.push(["Taxable value", live.taxable_value, true]);
  if (config.tax.mode === "cgst_sgst") rows.push([`CGST (${rate / 2}%)`, live.cgst], [`SGST (${rate / 2}%)`, live.sgst]);
  if (config.tax.mode === "igst") rows.push([`IGST (${rate}%)`, live.igst]);
  if (live.other_charges_untaxable > 0) rows.push(["Other charges (non-taxable)", live.other_charges_untaxable]);
  if (live.round_off !== 0) rows.push(["Round off", live.round_off]);
  const ms = milestones?.length ? computeMilestones(live.grand_total, milestones.map((m) => ({ kind: m.kind, value: m.value || "0" }))) : null;

  return (
    <div aria-live="polite" className="space-y-4">
      <dl className="space-y-1.5 text-sm">
        {rows.map(([label, v, strong]) => (
          <div key={label} className={cn("flex justify-between", strong && "border-t border-border pt-1.5 font-medium")}>
            <dt className="text-muted">{label}</dt>
            <dd className="tabular-nums">{v < 0 ? "− " : ""}{formatINR(Math.abs(v), { exact: true })}</dd>
          </div>
        ))}
        <div className="mt-2 flex items-baseline justify-between border-t-2 border-nav pt-2">
          <dt className="text-xs font-bold uppercase">Grand total</dt>
          <dd className="text-xl font-bold tabular-nums">{formatINR(live.grand_total, { exact: true })}</dd>
        </div>
      </dl>
      {ms && (
        <div className="border-t border-border pt-3 text-sm">
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">Milestones</p>
          {milestones!.map((m, i) => (
            <div key={i} className="flex justify-between"><span className="truncate text-muted">{m.label || `Milestone ${i + 1}`}</span><span className="tabular-nums">{formatINR(ms.amounts[i], { exact: true })}</span></div>
          ))}
          <p className={cn("mt-1 text-xs", ms.reconciled ? "text-success" : "font-medium text-danger")}>
            {ms.reconciled ? "✓ Milestones add up to the grand total" : `Milestones differ from the total by ${formatINR(ms.difference, { exact: true })}`}
          </p>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Live preview (server-rendered with the same template as the PDF)
// ---------------------------------------------------------------------------
export function PreviewPane({ load, deps }: { load: () => Promise<ActionResult<{ html: string }>>; deps: unknown }) {
  const [state, setState] = useState<{ html?: string; error?: string; loading: boolean }>({ loading: true });
  const [scale, setScale] = useState(0.5);
  const [zoomMode, setZoomMode] = useState<"fit" | "full">("fit");
  const [inspectOpen, setInspectOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });
  const key = JSON.stringify(deps);

  useEffect(() => {
    let live = true;
    const t = setTimeout(async () => {
      setState((s) => ({ ...s, loading: true }));
      const r = await loadRef.current();
      if (live) setState(r.ok ? { html: r.data.html, loading: false } : { error: r.error, loading: false });
    }, 600);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [key]);

  useEffect(() => {
    if (!containerRef.current) return;
    const updateScale = () => {
      if (containerRef.current) {
        const w = containerRef.current.clientWidth;
        setScale(Math.max(0.25, Math.min(1.2, w / 794)));
      }
    };
    updateScale();
    const observer = new ResizeObserver(updateScale);
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const openNewTab = () => {
    if (!state.html) return;
    const blob = new Blob([state.html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank");
  };

  return (
    <div className="space-y-2">
      {/* Preview Toolbar */}
      <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-surface p-2 shadow-xs">
        <div className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-accent animate-pulse" />
          <span className="text-xs font-semibold text-foreground">Live PDF Preview</span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant={zoomMode === "fit" ? "primary" : "ghost"}
            className="h-7 px-2 text-xs"
            onClick={() => setZoomMode("fit")}
            title="Fit to pane width"
          >
            Fit
          </Button>
          <Button
            size="sm"
            variant={zoomMode === "full" ? "primary" : "ghost"}
            className="h-7 px-2 text-xs"
            onClick={() => setZoomMode("full")}
            title="100% Actual size with scroll"
          >
            100%
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 text-muted hover:text-foreground"
            onClick={() => setInspectOpen(true)}
            title="Expand to Fullscreen Dialog"
            aria-label="Expand preview"
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 text-muted hover:text-foreground"
            onClick={openNewTab}
            disabled={!state.html}
            title="Open preview in new tab"
            aria-label="Open in new tab"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {state.error && (
        <p role="status" className="rounded-md bg-warning-soft px-3 py-2 text-xs font-medium text-warning border border-warning/20">
          {state.error}
        </p>
      )}

      {/* Preview Container */}
      <div
        ref={containerRef}
        className={cn(
          "relative overflow-hidden rounded-xl border border-border bg-surface shadow-xs transition-all",
          zoomMode === "full" ? "h-[650px] overflow-auto" : "",
        )}
        style={zoomMode === "fit" ? { aspectRatio: "210 / 297" } : undefined}
      >
        {state.html && (
          <div
            className="origin-top-left transition-transform duration-150"
            style={{
              width: "794px",
              height: "1123px",
              transform: zoomMode === "fit" ? `scale(${scale})` : "none",
            }}
          >
            <iframe
              title="Document preview"
              srcDoc={state.html}
              className="h-full w-full border-0 bg-paper shadow-sm"
            />
          </div>
        )}
        {state.loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-paper/75 backdrop-blur-xs text-xs font-medium text-paper-foreground gap-2" role="status">
            <span className="h-3 w-3 animate-spin rounded-full border-2 border-foreground border-t-transparent" />
            Updating preview…
          </div>
        )}
      </div>

      <div className="flex items-center justify-between text-[11px] text-muted px-1">
        <span>First page shown · Uses exact NAFA print layout</span>
        <button
          type="button"
          onClick={() => setInspectOpen(true)}
          className="text-accent hover:underline font-medium cursor-pointer"
        >
          View Full Size &rarr;
        </button>
      </div>

      {/* Fullscreen High-Resolution Inspection Modal */}
      {inspectOpen && (
        <Modal
          open={inspectOpen}
          onClose={() => setInspectOpen(false)}
          title="Document Preview (Full Resolution)"
          description="Exact print and PDF rendering. Check layout, alignment, typography and totals."
          className="max-w-4xl"
        >
          <div className="mt-3 flex justify-end gap-2 border-b border-border pb-2.5">
            <Button size="sm" variant="secondary" onClick={openNewTab}>
              <ExternalLink className="h-3.5 w-3.5" />
              <span>Open in New Window</span>
            </Button>
          </div>
          <div className="mt-3 max-h-[75vh] overflow-auto rounded-lg border border-border bg-surface-muted p-4 flex justify-center">
            {state.html ? (
              <iframe
                title="Fullscreen Document preview"
                srcDoc={state.html}
                style={{ width: "794px", height: "1123px" }}
                className="border border-border bg-paper shadow-xl rounded-md"
              />
            ) : (
              <p className="text-sm text-muted">Preview not available.</p>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
