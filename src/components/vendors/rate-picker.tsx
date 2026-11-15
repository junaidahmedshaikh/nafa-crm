"use client";

import { useState, useTransition } from "react";
import { Calculator, Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form";
import { Modal } from "@/components/ui/modal";
import { searchVendorRates } from "@/lib/actions/vendors";
import { formatINR } from "@/lib/format";
import { RATE_TYPE_LABEL, sellingPrice, type RateType } from "@/lib/vendors/core";
import type { RateRow } from "@/lib/vendors/repo";

export type PickedLine = { catalogue_id: string; description: string; rate: string };
const money = (v: number | string) => formatINR(v, { exact: true });
/** Cost of one unit before GST (GST on a purchase is usually recoverable, and the quotation adds its own tax). */
const costExGst = (r: RateRow) => Math.round((Number(r.rate) + Number(r.setup_charges) + Number(r.transport_charges) + Number(r.other_charges)) * 100) / 100;

/**
 * Internal cost lookup for the quotation builder. The person chooses a vendor rate and a markup or margin; ONLY the service
 * name and the resulting selling price go into the quotation line. The vendor and the purchase cost are never written to
 * the document, so they cannot reach the client PDF.
 */
export function VendorRatePicker({ onAdd }: { onAdd: (line: PickedLine) => void }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [rows, setRows] = useState<RateRow[] | null>(null);
  const [error, setError] = useState("");
  const [pct, setPct] = useState("20");
  const [mode, setMode] = useState<"markup" | "margin">("markup");

  const search = (q: string) => startTransition(async () => {
    const r = await searchVendorRates(q);
    if (r.ok) { setRows(r.data.rows); setError(""); } else { setRows([]); setError(r.error); }
  });

  return (
    <>
      <Button size="sm" onClick={() => { setOpen(true); if (rows === null) search(""); }}><Calculator className="h-4 w-4" aria-hidden />Vendor cost lookup</Button>
      {open && (
        <Modal open onClose={() => setOpen(false)} title="Vendor cost lookup" description="Internal reference only. The vendor and the purchase cost are not added to the quotation: only the service name and your selling price are." className="max-w-4xl max-h-[calc(100dvh-2rem)] overflow-y-auto">
          <div className="space-y-4 text-sm">
            <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); search(String(new FormData(e.currentTarget).get("q") ?? "")); }}>
              <label className="min-w-[14rem] flex-1 text-xs font-medium text-muted">Search the vendor rate catalogue
                <Input name="q" placeholder="LED screen, stage, promoters…" className="mt-1" autoFocus />
              </label>
              <Button type="submit" variant="primary" size="sm" loading={pending}>{!pending && <Search className="h-4 w-4" aria-hidden />}Search</Button>
              <label className="text-xs font-medium text-muted">Pricing
                <Select value={mode} onChange={(e) => setMode(e.target.value as "markup" | "margin")} className="mt-1 w-40"><option value="markup">Markup on cost</option><option value="margin">Margin on price</option></Select>
              </label>
              <label className="text-xs font-medium text-muted">{mode === "markup" ? "Markup %" : "Margin %"}
                <Input value={pct} onChange={(e) => setPct(e.target.value.replace(/[^\d.]/g, "").slice(0, 6))} inputMode="decimal" className="mt-1 w-24" />
              </label>
            </form>
            {error && <p className="rounded-md bg-warning-soft px-3 py-2 text-warning" role="alert">{error}</p>}
            {rows === null || pending ? <p className="flex items-center gap-2 py-6 text-muted" role="status"><Loader2 className="h-4 w-4 animate-spin" aria-hidden />Loading rates…</p>
              : rows.length === 0 ? <p className="py-6 text-center text-muted">No vendor rates found. Vendor rates are visible to people with a finance role; add them under Vendor Rates &amp; Services.</p> : (
                <div className="max-h-[50vh] overflow-auto rounded-md border border-border">
                  <table className="w-full min-w-[760px] text-left text-xs">
                    <thead className="sticky top-0 bg-surface-muted"><tr>{["Service", "Vendor", "Type", "Cost / unit (ex GST)", "GST", "Your selling price", ""].map((h) => <th key={h} className="px-3 py-2 font-semibold">{h}</th>)}</tr></thead>
                    <tbody className="divide-y divide-border">
                      {rows.map((r) => {
                        const cost = costExGst(r);
                        const price = sellingPrice(cost, pct || 0, mode);
                        return (
                          <tr key={r.id}>
                            <td className="px-3 py-2 font-medium">{r.product_name}<span className="block font-normal text-muted">{r.unit}{r.is_expired ? " · rate expired" : ""}</span></td>
                            <td className="px-3 py-2">{r.vendor_name}<span className="block text-muted">{r.service_location || r.vendor_city}</span></td>
                            <td className="px-3 py-2">{RATE_TYPE_LABEL[r.rate_type as RateType] ?? r.rate_type}</td>
                            <td className="px-3 py-2 tabular-nums">{money(cost)}</td>
                            <td className="px-3 py-2 tabular-nums">{Number(r.gst_percent)}%</td>
                            <td className="px-3 py-2 font-semibold tabular-nums">{price === null ? "—" : money(price)}</td>
                            <td className="px-3 py-2 text-right">
                              <Button size="sm" variant="primary" disabled={price === null}
                                onClick={() => { onAdd({ catalogue_id: r.product_id, description: r.product_name, rate: String(price) }); setOpen(false); }}>Add line</Button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            <p className="text-xs text-muted">The selling price can be edited on the quotation line afterwards. Nothing is chosen for you: compare quality, availability and location as well as price.</p>
          </div>
        </Modal>
      )}
    </>
  );
}
