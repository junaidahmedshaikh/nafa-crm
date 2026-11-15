import Link from "next/link";
import { notFound } from "next/navigation";
import { Star } from "lucide-react";
import { NoFinanceAccess } from "@/components/finance/bits";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, DataTable, DetailList, EmptyState, PageHeader, Td, Th } from "@/components/ui/layout";
import { DeleteButton, RateActiveToggle, RateFormButton, VendorFormButton } from "@/components/vendors/vendor-ui";
import { requireMember } from "@/lib/auth";
import { formatDate, formatDateTime } from "@/lib/datetime";
import { listActiveProducts } from "@/lib/documents/repo";
import { getFinanceAccess } from "@/lib/finance/repo";
import { formatINR } from "@/lib/format";
import { RATE_TYPE_LABEL, VENDOR_STATUS_LABEL, type RateType } from "@/lib/vendors/core";
import { getVendorProfile, listVendorCategories } from "@/lib/vendors/repo";
import { cn } from "@/lib/utils";

export const metadata = { title: "Vendor" };
const money = (v: number | string | null) => formatINR(v ?? 0, { exact: true });
const STATUS_TONE: Record<string, "success" | "neutral" | "danger"> = { active: "success", inactive: "neutral", blacklisted: "danger" };
const stars = (n: number | null) => (n === null ? "Not rated" : `${n} / 5`);

export default async function VendorPage({ params }: PageProps<"/products-services/vendors/[id]">) {
  const { id } = await params;
  const { supabase } = await requireMember();
  const access = await getFinanceAccess(supabase);
  if (!access.any) return <><PageHeader title="Vendor" /><NoFinanceAccess /></>;
  const found = await getVendorProfile(supabase, id);
  if (!found || found.vendor.deleted_at) notFound();
  const { vendor: v, rates, history } = found;
  const [categories, products] = access.manage
    ? await Promise.all([listVendorCategories(supabase), listActiveProducts(supabase).then((p) => p.map((x) => ({ id: x.id, name: x.name })))])
    : [[], []];
  const rateName = Object.fromEntries(rates.map((r) => [r.id, `${r.product_name} · ${RATE_TYPE_LABEL[r.rate_type as RateType] ?? r.rate_type}`]));
  const link = (href: string, label: string) => <a className="text-accent hover:underline" href={href} target={href.startsWith("http") ? "_blank" : undefined} rel="noopener noreferrer">{label}</a>;

  return (
    <>
      <PageHeader
        title={v.name}
        breadcrumbs={[{ label: "Vendor Rates & Services", href: "/products-services?view=vendors" }, { label: v.name }]}
        description={[v.category, [v.city, v.state].filter(Boolean).join(", ")].filter(Boolean).join(" · ") || undefined}
        actions={access.manage ? <div className="flex flex-wrap gap-2"><RateFormButton vendors={[{ id: v.id, name: v.name }]} products={products} vendorId={v.id} label="Add service & rate" /><VendorFormButton vendor={v} categories={categories} variant="secondary" /><DeleteButton kind="vendor" id={v.id} name={v.name} redirectTo="/products-services?view=vendors" withLabel /></div> : undefined}
      />
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <Badge tone={STATUS_TONE[v.status] ?? "neutral"}>{VENDOR_STATUS_LABEL[v.status] ?? v.status}</Badge>
        {v.is_preferred && <Badge tone="accent">Preferred vendor</Badge>}
        {v.status === "blacklisted" && <span className="text-xs text-danger">Blacklisted vendors are left out of the quotation cost lookup.</span>}
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-6">
          <Card>
            <CardHeader title={`Services & rates (${rates.filter((r) => r.is_active).length} live)`} />
            {rates.length === 0 ? <EmptyState title="No services yet" description="Add the services this vendor offers and what they charge." /> : (
              <DataTable className="[&_table]:min-w-[900px]">
                <thead><tr><Th>Service / product</Th><Th>Rate type</Th><Th className="text-right">Rate</Th><Th className="text-right">Setup</Th><Th className="text-right">Transport</Th><Th className="text-right">Other</Th><Th className="text-right">GST</Th><Th className="text-right">Est. cost</Th><Th>Valid until</Th><Th className="text-right">Actions</Th></tr></thead>
                <tbody>
                  {rates.map((r) => (
                    <tr key={r.id} className={cn("align-top hover:bg-surface-muted", !r.is_active && "text-muted")}>
                      <Td><Link href={`/products-services?view=compare&product=${r.product_id}`} className="font-medium hover:text-accent hover:underline">{r.product_name}</Link>
                        <p className="text-xs text-muted">{[r.product_category, r.specifications, r.availability, r.min_order_qty ? `Min ${Number(r.min_order_qty)}` : ""].filter(Boolean).join(" · ") || "—"}</p>
                        {r.rate_type === "rental" && <p className="text-xs text-muted">{[r.rental_duration, r.weekly_rate ? `Weekly ${money(r.weekly_rate)}` : "", r.monthly_rate ? `Monthly ${money(r.monthly_rate)}` : "", r.security_deposit ? `Deposit ${money(r.security_deposit)}` : "", r.damage_charges].filter(Boolean).join(" · ")}</p>}
                        {!r.is_active && <Badge className="mt-1">Inactive</Badge>}</Td>
                      <Td>{RATE_TYPE_LABEL[r.rate_type as RateType] ?? r.rate_type}</Td>
                      <Td className="text-right tabular-nums">{money(r.rate)}<p className="text-xs text-muted">{r.unit}</p></Td>
                      <Td className="text-right tabular-nums">{money(r.setup_charges)}</Td>
                      <Td className="text-right tabular-nums">{money(r.transport_charges)}</Td>
                      <Td className="text-right tabular-nums">{money(r.other_charges)}</Td>
                      <Td className="text-right tabular-nums">{Number(r.gst_percent)}%</Td>
                      <Td className="text-right font-semibold tabular-nums">{money(r.estimated_cost)}</Td>
                      <Td className={cn("whitespace-nowrap", r.is_expired && "font-medium text-danger")}>{r.valid_until ? formatDate(r.valid_until) : "—"}</Td>
                      <Td>{access.manage && <div className="flex justify-end gap-1"><RateFormButton rate={r} vendors={[]} products={[]} size="icon" /><RateActiveToggle id={r.id} active={r.is_active} /><DeleteButton kind="rate" id={r.id} name={r.product_name} /></div>}</Td>
                    </tr>
                  ))}
                </tbody>
              </DataTable>
            )}
          </Card>
          <Card>
            <CardHeader title="Rate history" />
            {history.length === 0 ? <p className="px-5 py-6 text-center text-sm text-muted">No price changes yet. When a rate is updated, the previous price is kept here.</p> : (
              <ul className="divide-y divide-border">
                {history.map((h) => {
                  const diff = Number(h.new_rate) - Number(h.old_rate);
                  return (
                    <li key={h.id} className="px-5 py-3 text-sm">
                      <p className="font-medium">{rateName[h.rate_id] ?? "Rate"}</p>
                      <p className="tabular-nums">{money(h.old_rate)} <span className="text-muted">/ {h.old_unit}</span> → {money(h.new_rate)}
                        {diff !== 0 && <span className={cn("ml-2 text-xs font-medium", diff > 0 ? "text-danger" : "text-success")}>{diff > 0 ? "+" : "−"}{money(Math.abs(diff))}{Number(h.old_rate) > 0 ? ` (${((diff / Number(h.old_rate)) * 100).toFixed(1)}%)` : ""}</span>}</p>
                      <p className="text-xs text-muted">Previous price was effective from {formatDate(h.old_effective_from)} · new price from {formatDate(h.effective_from)} · changed {formatDateTime(h.changed_at)}{h.author?.full_name ? ` by ${h.author.full_name}` : ""}</p>
                      <p className="text-xs text-muted">Previous charges: setup {money(h.old_setup_charges)}, transport {money(h.old_transport_charges)}, other {money(h.old_other_charges)}, GST {Number(h.old_gst_percent)}%{h.note ? ` · Reason: ${h.note}` : ""}</p>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Contact" />
            <div className="p-5"><DetailList items={[
              { label: "Contact person", value: v.contact_person || null },
              { label: "Mobile", value: v.phone ? link(`tel:${v.phone}`, v.phone) : null },
              { label: "WhatsApp", value: v.whatsapp ? link(`https://wa.me/${v.whatsapp.replace(/\D/g, "")}`, v.whatsapp) : null },
              { label: "Email", value: v.email ? link(`mailto:${v.email}`, v.email) : null },
              { label: "Website", value: v.website ? link(/^https?:\/\//i.test(v.website) ? v.website : `https://${v.website}`, v.website) : null },
              { label: "Service locations", value: v.service_locations || null },
              { label: "Address", value: v.address || null },
            ]} /></div>
          </Card>
          <Card>
            <CardHeader title="Business" />
            <div className="p-5"><DetailList items={[
              { label: "Services provided", value: v.services_provided || null },
              { label: "GST registered", value: v.gst_registered ? "Yes" : "No" },
              { label: "GSTIN", value: v.gstin || null },
              { label: "PAN", value: v.pan || null },
              { label: "Payment terms", value: v.payment_terms || null },
              { label: "Credit period", value: v.credit_period_days === null ? null : `${v.credit_period_days} days` },
              { label: "Advance", value: v.advance_requirement || null },
              { label: "Internal notes", value: v.notes || null },
            ]} /></div>
          </Card>
          <Card>
            <CardHeader title="Performance" action={<span className="inline-flex items-center gap-1 text-sm font-semibold tabular-nums">{v.overall_rating === null ? <span className="text-xs font-normal text-muted">Not rated</span> : <><Star className="h-4 w-4 fill-warning text-warning" aria-hidden />{Number(v.overall_rating).toFixed(1)}</>}</span>} />
            <div className="p-5"><DetailList items={[
              { label: "Quality", value: stars(v.rating_quality) }, { label: "Pricing", value: stars(v.rating_pricing) },
              { label: "Reliability", value: stars(v.rating_reliability) }, { label: "Timeliness", value: stars(v.rating_timeliness) },
              { label: "Past projects", value: v.past_projects || null }, { label: "Internal feedback", value: v.feedback || null },
            ]} /><p className="mt-3 text-xs text-muted">Ratings are entered by your team. The overall score is the average of the ratings given.</p></div>
          </Card>
          <Link href={`/finance/vendors?vendor=${v.id}&unpaid=0`} className="block rounded-lg border border-border bg-surface p-4 text-sm hover:bg-surface-muted"><span className="font-semibold">Bills & payments →</span><span className="block text-xs text-muted">Actual purchases from this vendor recorded as project expenses.</span></Link>
        </div>
      </div>
    </>
  );
}
