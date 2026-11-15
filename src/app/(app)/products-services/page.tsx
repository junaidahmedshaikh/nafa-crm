import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Lock, Package, Scale, Star, Store } from "lucide-react";
import { ProductManager } from "@/components/documents/product-manager";
import { ExportLink } from "@/components/shared/export-link";
import { FilterForm } from "@/components/shared/filter-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form";
import { Card, DataTable, EmptyState, PageHeader, Pagination, Td, Th } from "@/components/ui/layout";
import { DeleteButton, ImportRatesButton, RateActiveToggle, RateFormButton, VendorFormButton } from "@/components/vendors/vendor-ui";
import { requireMember } from "@/lib/auth";
import { formatDate } from "@/lib/datetime";
import { listActiveProducts, listProducts } from "@/lib/documents/repo";
import { getFinanceAccess } from "@/lib/finance/repo";
import { formatINR } from "@/lib/format";
import { RATE_TYPES, RATE_TYPE_LABEL, sortComparison, VENDOR_STATUSES, VENDOR_STATUS_LABEL, type CompareSort, type RateType } from "@/lib/vendors/core";
import { comparableProducts, listRates, listVendorCategories, listVendorProfiles, ratesForProduct, vendorOptions, VENDOR_SETUP, type RateRow } from "@/lib/vendors/repo";
import { cn } from "@/lib/utils";

export const metadata = { title: "Vendor Rates & Services" };
type SP = Record<string, string | string[] | undefined>;
type Opt = { id: string; name: string };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const money = (v: number | string | null) => formatINR(v ?? 0, { exact: true });
const VIEWS = [["vendors", "Vendors", Store], ["rates", "Service catalogue & rates", Package], ["compare", "Compare vendors", Scale], ["items", "Quotation items", Package]] as const;
const STATUS_TONE: Record<string, "success" | "neutral" | "danger"> = { active: "success", inactive: "neutral", blacklisted: "danger" };
const BASE = "/products-services";
const link = (view: string, extra: Record<string, string>) => `${BASE}?${new URLSearchParams(Object.entries({ view, ...extra }).filter(([, v]) => v))}`;

function Rating({ value }: { value: number | string | null }) {
  return value === null
    ? <span className="text-xs text-muted">Not rated</span>
    : <span className="inline-flex items-center gap-1 tabular-nums"><Star className="h-3.5 w-3.5 fill-warning text-warning" aria-hidden />{Number(value).toFixed(1)}</span>;
}
const SetupNotice = () => <p className="border-b border-border bg-warning-soft px-4 py-2 text-sm text-warning">{VENDOR_SETUP}</p>;

export default async function VendorRatesPage({ searchParams }: PageProps<"/products-services">) {
  const sp = await searchParams;
  const { supabase } = await requireMember();
  const access = await getFinanceAccess(supabase).catch(() => ({ any: false, manage: false }));
  const view = VIEWS.some(([v]) => v === one(sp.view)) ? one(sp.view) : access.any ? "vendors" : "items";
  const q = one(sp.q).trim().slice(0, 100);
  const page = Math.max(1, Math.floor(Number(one(sp.page))) || 1);
  const restricted = view !== "items" && !access.any;

  const [categories, vendors, products]: [string[], Opt[], Opt[]] = view === "items" || restricted
    ? [[], [], []]
    : await Promise.all([listVendorCategories(supabase), vendorOptions(supabase), listActiveProducts(supabase).then((p) => p.map((x) => ({ id: x.id, name: x.name })))]);

  const body = restricted
    ? <Card><EmptyState icon={Lock} title="Vendor rates are restricted" description="Purchase rates are confidential. Ask an administrator for a finance role to see them. The Quotation items view is open to everyone." /></Card>
    : view === "vendors" ? await vendorsView(supabase, sp, q, page, categories, access.manage)
      : view === "rates" ? await ratesView(supabase, sp, q, page, categories, vendors, products, access.manage)
        : view === "compare" ? await compareView(supabase, sp)
          : await itemsView(supabase, q, page, one(sp.inactive) === "1", access.manage);

  return (
    <>
      <PageHeader
        title="Vendor Rate Catalogue"
        description="Vendors, the services they offer and their purchase and rental rates, for costing quotations and project budgets. Internal only: these rates never appear on client documents."
        actions={access.manage && view !== "items" ? (
          <div className="flex flex-wrap gap-2">
            <VendorFormButton categories={categories} />
            <RateFormButton vendors={vendors} products={products} variant="secondary" />
            <ImportRatesButton />
            <ExportLink href="/api/export/vendor-rates" label="Export Excel" />
          </div>
        ) : undefined}
      />
      <nav aria-label="Catalogue views" className="mb-4 flex flex-wrap gap-1 border-b border-border">
        {VIEWS.map(([v, label, Icon]) => (
          <Link key={v} href={`${BASE}?view=${v}`} aria-current={view === v ? "page" : undefined}
            className={cn("-mb-px inline-flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium", view === v ? "border-accent text-foreground" : "border-transparent text-muted hover:text-foreground")}>
            <Icon className="h-4 w-4" aria-hidden />{label}
          </Link>
        ))}
      </nav>
      {body}
    </>
  );
}

async function vendorsView(supabase: SupabaseClient, sp: SP, q: string, page: number, categories: string[], canEdit: boolean) {
  const f = { q, category: one(sp.category), status: one(sp.status), city: one(sp.city).slice(0, 60), page };
  const { rows, total, pageSize, setupNeeded } = await listVendorProfiles(supabase, f);
  const filtered = !!(q || f.category || f.status || f.city);
  return (
    <Card>
      {setupNeeded && <SetupNotice />}
      <FilterForm basePath={BASE} className="flex flex-wrap items-center gap-3 border-b border-border p-4">
        <input type="hidden" name="view" value="vendors" />
        <Input name="q" aria-label="Search vendors" defaultValue={q} placeholder="Search vendor, contact, services, city…" className="min-w-[14rem] flex-1" />
        <Select name="category" aria-label="Vendor category" defaultValue={f.category} className="w-52"><option value="">All categories</option>{categories.map((c) => <option key={c} value={c}>{c}</option>)}</Select>
        <Select name="status" aria-label="Status" defaultValue={f.status} className="w-36"><option value="">Any status</option>{VENDOR_STATUSES.map((s) => <option key={s} value={s}>{VENDOR_STATUS_LABEL[s]}</option>)}</Select>
        <Input name="city" aria-label="City" defaultValue={f.city} placeholder="City" className="w-32" />
        <Button type="submit" variant="primary" size="sm">Apply</Button>
        {filtered && <Link href={`${BASE}?view=vendors`} className="text-sm text-accent hover:underline">Clear</Link>}
      </FilterForm>
      {rows.length === 0 ? <EmptyState icon={Store} title={filtered ? "No vendors match" : "No vendors yet"} description={filtered ? "Try a different search or filter." : "Add your first vendor, or import a spreadsheet of vendors and rates."} /> : (
        <>
          <DataTable>
            <thead><tr><Th>Vendor</Th><Th>Category</Th><Th>Contact</Th><Th>Location</Th><Th>Services</Th><Th>Rating</Th><Th>Rates</Th><Th>Status</Th>{canEdit && <Th className="text-right">Actions</Th>}</tr></thead>
            <tbody>
              {rows.map((v) => (
                <tr key={v.id} className="align-top hover:bg-surface-muted">
                  <Td><Link href={`${BASE}/vendors/${v.id}`} className="font-medium hover:text-accent hover:underline">{v.name}</Link>{v.is_preferred && <Badge tone="accent" className="ml-2">Preferred</Badge>}</Td>
                  <Td>{v.category || "—"}</Td>
                  <Td>{v.contact_person || "—"}<p className="text-xs text-muted">{[v.phone, v.email].filter(Boolean).join(" · ")}</p></Td>
                  <Td>{[v.city, v.state].filter(Boolean).join(", ") || "—"}</Td>
                  <Td className="max-w-[16rem]"><p className="truncate text-xs text-muted" title={v.services_provided}>{v.services_provided || "—"}</p></Td>
                  <Td><Rating value={v.overall_rating} /></Td>
                  <Td className="tabular-nums">{v.rate_count}</Td>
                  <Td><Badge tone={STATUS_TONE[v.status] ?? "neutral"}>{VENDOR_STATUS_LABEL[v.status] ?? v.status}</Badge></Td>
                  {canEdit && <Td><div className="flex justify-end"><DeleteButton kind="vendor" id={v.id} name={v.name} /></div></Td>}
                </tr>
              ))}
            </tbody>
          </DataTable>
          <Pagination page={page} pageSize={pageSize} total={total} hrefFor={(n) => link("vendors", { q, category: f.category, status: f.status, city: f.city, page: String(n) })} />
        </>
      )}
    </Card>
  );
}

async function ratesView(supabase: SupabaseClient, sp: SP, q: string, page: number, categories: string[], vendors: Opt[], products: Opt[], canEdit: boolean) {
  const f = { q, category: one(sp.category).slice(0, 100), vendorCategory: one(sp.vcat), type: one(sp.type), city: one(sp.city).slice(0, 60), gst: one(sp.gst), validity: one(sp.validity), min: one(sp.min), max: one(sp.max), sort: one(sp.sort), page };
  const { rows, total, pageSize, setupNeeded } = await listRates(supabase, f);
  const filtered = Object.entries(f).some(([k, v]) => k !== "page" && v);
  return (
    <Card>
      {setupNeeded && <SetupNotice />}
      <FilterForm basePath={BASE} className="flex flex-wrap items-center gap-3 border-b border-border p-4">
        <input type="hidden" name="view" value="rates" />
        <Input name="q" aria-label="Search rates" defaultValue={q} placeholder="Search service, product, vendor, category…" className="min-w-[14rem] flex-1" />
        <Select name="vcat" aria-label="Vendor category" defaultValue={f.vendorCategory} className="w-48"><option value="">All vendor categories</option>{categories.map((c) => <option key={c} value={c}>{c}</option>)}</Select>
        <Input name="category" aria-label="Service category" defaultValue={f.category} placeholder="Service category" className="w-40" />
        <Select name="type" aria-label="Rate type" defaultValue={f.type} className="w-40"><option value="">Purchase and rental</option>{RATE_TYPES.map((t) => <option key={t} value={t}>{RATE_TYPE_LABEL[t]}</option>)}</Select>
        <Input name="city" aria-label="Location" defaultValue={f.city} placeholder="Location" className="w-28" />
        <Select name="gst" aria-label="GST" defaultValue={f.gst} className="w-36"><option value="">GST: any</option><option value="yes">GST applicable</option><option value="no">No GST</option></Select>
        <Select name="validity" aria-label="Validity" defaultValue={f.validity} className="w-36"><option value="">Validity: any</option><option value="valid">Currently valid</option><option value="expired">Expired</option></Select>
        <Input name="min" aria-label="Minimum rate" defaultValue={f.min} placeholder="Min ₹" inputMode="numeric" className="w-24" />
        <Input name="max" aria-label="Maximum rate" defaultValue={f.max} placeholder="Max ₹" inputMode="numeric" className="w-24" />
        <Select name="sort" aria-label="Sort" defaultValue={f.sort} className="w-36"><option value="">Sort: service</option><option value="lowest">Lowest cost</option><option value="highest">Highest cost</option></Select>
        <Button type="submit" variant="primary" size="sm">Apply</Button>
        {filtered && <Link href={`${BASE}?view=rates`} className="text-sm text-accent hover:underline">Clear</Link>}
      </FilterForm>
      {rows.length === 0 ? <EmptyState icon={Package} title={filtered ? "No rates match" : "No vendor rates yet"} description={filtered ? "Try a different search or filter." : "Add a vendor rate, or import a spreadsheet."} /> : (
        <>
          <DataTable className="[&_table]:min-w-[1050px]">
            <thead><tr><Th>Service / product</Th><Th>Vendor</Th><Th>Rate type</Th><Th className="text-right">Rate</Th><Th className="text-right">Other charges</Th><Th className="text-right">GST</Th><Th className="text-right">Est. cost</Th><Th>Valid until</Th><Th className="text-right">Actions</Th></tr></thead>
            <tbody>
              {rows.map((r: RateRow) => (
                <tr key={r.id} className="align-top hover:bg-surface-muted">
                  <Td><Link href={`${BASE}?view=compare&product=${r.product_id}`} className="font-medium hover:text-accent hover:underline" title="Compare vendors for this service">{r.product_name}</Link><p className="text-xs text-muted">{r.product_category || "Uncategorised"}{r.specifications ? ` · ${r.specifications.slice(0, 60)}` : ""}</p></Td>
                  <Td><Link href={`${BASE}/vendors/${r.vendor_id}`} className="hover:text-accent hover:underline">{r.vendor_name}</Link><p className="text-xs text-muted">{r.service_location || r.vendor_city || "—"}</p></Td>
                  <Td>{RATE_TYPE_LABEL[r.rate_type as RateType] ?? r.rate_type}</Td>
                  <Td className="text-right tabular-nums">{money(r.rate)}<p className="text-xs text-muted">{r.unit}</p></Td>
                  <Td className="text-right tabular-nums">{money(Number(r.setup_charges) + Number(r.transport_charges) + Number(r.other_charges))}</Td>
                  <Td className="text-right tabular-nums">{Number(r.gst_percent)}%</Td>
                  <Td className="text-right font-semibold tabular-nums">{money(r.estimated_cost)}</Td>
                  <Td className={cn("whitespace-nowrap", r.is_expired ? "font-medium text-danger" : "text-muted")}>{r.valid_until ? formatDate(r.valid_until) : "—"}{r.is_expired && <p className="text-xs">Expired</p>}</Td>
                  <Td>{canEdit && <div className="flex justify-end gap-1"><RateFormButton rate={r} vendors={vendors} products={products} size="icon" /><RateActiveToggle id={r.id} active={r.is_active} /><DeleteButton kind="rate" id={r.id} name={`${r.product_name} from ${r.vendor_name}`} /></div>}</Td>
                </tr>
              ))}
            </tbody>
          </DataTable>
          <Pagination page={page} pageSize={pageSize} total={total} hrefFor={(n) => link("rates", { q, category: f.category, vcat: f.vendorCategory, type: f.type, city: f.city, gst: f.gst, validity: f.validity, min: f.min, max: f.max, sort: f.sort, page: String(n) })} />
        </>
      )}
    </Card>
  );
}

async function compareView(supabase: SupabaseClient, sp: SP) {
  const options = await comparableProducts(supabase);
  const productId = one(sp.product);
  const sort = (["lowest", "highest", "rating"].includes(one(sp.sort)) ? one(sp.sort) : "lowest") as CompareSort;
  const rows = productId ? sortComparison(await ratesForProduct(supabase, productId), sort) : [];
  const chosen = options.find((o) => o.id === productId);
  return (
    <Card>
      <FilterForm basePath={BASE} className="flex flex-wrap items-end gap-3 border-b border-border p-4">
        <input type="hidden" name="view" value="compare" />
        <label className="text-xs font-medium text-muted">Service / product
          <Select name="product" defaultValue={productId} className="mt-1 w-80"><option value="">Choose a service to compare…</option>{options.map((o) => <option key={o.id} value={o.id}>{o.name} ({o.vendors} vendor{o.vendors === 1 ? "" : "s"})</option>)}</Select>
        </label>
        <label className="text-xs font-medium text-muted">Sort by
          <Select name="sort" defaultValue={sort} className="mt-1 w-44"><option value="lowest">Lowest cost first</option><option value="highest">Highest cost first</option><option value="rating">Vendor rating</option></Select>
        </label>
      </FilterForm>
      {!productId ? <EmptyState icon={Scale} title="Choose a service" description={options.length ? "Pick a service above to see every vendor's rate side by side." : "Add rates from more than one vendor for the same service to compare them."} />
        : rows.length === 0 ? <EmptyState title="No live rates for this service" /> : (
          <>
            <p className="border-b border-border px-5 py-3 text-sm"><span className="font-semibold">{chosen?.name ?? rows[0].product_name}</span><span className="text-muted"> · {rows.length} vendor rate{rows.length === 1 ? "" : "s"}. The order is only a sort: choose the vendor yourself on quality, availability, location and price.</span></p>
            <DataTable className="[&_table]:min-w-[1100px]">
              <thead><tr><Th>Vendor</Th><Th>Rate type</Th><Th className="text-right">Rate</Th><Th className="text-right">GST</Th><Th className="text-right">Transport</Th><Th className="text-right">Installation</Th><Th className="text-right">Other</Th><Th className="text-right">Final est. cost</Th><Th>Validity</Th><Th>Location</Th><Th>Rating</Th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="align-top hover:bg-surface-muted">
                    <Td><Link href={`${BASE}/vendors/${r.vendor_id}`} className="font-medium hover:text-accent hover:underline">{r.vendor_name}</Link>{r.is_preferred && <Badge tone="accent" className="ml-2">Preferred</Badge>}{r.vendor_status !== "active" && <Badge tone={STATUS_TONE[r.vendor_status] ?? "neutral"} className="ml-2">{VENDOR_STATUS_LABEL[r.vendor_status]}</Badge>}</Td>
                    <Td>{RATE_TYPE_LABEL[r.rate_type as RateType] ?? r.rate_type}</Td>
                    <Td className="text-right tabular-nums">{money(r.rate)}<p className="text-xs text-muted">{r.unit}</p></Td>
                    <Td className="text-right tabular-nums">{Number(r.gst_percent)}%</Td>
                    <Td className="text-right tabular-nums">{money(r.transport_charges)}</Td>
                    <Td className="text-right tabular-nums">{money(r.setup_charges)}</Td>
                    <Td className="text-right tabular-nums">{money(r.other_charges)}</Td>
                    <Td className="text-right font-semibold tabular-nums">{money(r.estimated_cost)}</Td>
                    <Td className={cn("whitespace-nowrap", r.is_expired ? "font-medium text-danger" : "text-muted")}>{r.valid_until ? formatDate(r.valid_until) : "Open"}{r.is_expired ? " (expired)" : ""}</Td>
                    <Td>{r.service_location || r.vendor_city || "—"}</Td>
                    <Td><Rating value={r.vendor_rating} /></Td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
            <p className="border-t border-border px-5 py-2 text-xs text-muted">Final estimated cost = (rate for one unit + installation + transport + other charges) + GST. It is a reference estimate; actual purchases are recorded as project expenses.</p>
          </>
        )}
    </Card>
  );
}

async function itemsView(supabase: SupabaseClient, q: string, page: number, all: boolean, canDelete: boolean) {
  const { rows, total, pageSize } = await listProducts(supabase, { q, page, activeOnly: !all });
  return (
    <Card>
      <p className="border-b border-border px-4 py-2 text-xs text-muted">The reusable items and <span className="font-medium">selling</span> rates offered in the quotation and invoice builders. Vendor purchase rates are kept separately and are never copied here.</p>
      <FilterForm basePath={BASE} className="flex flex-wrap items-center gap-3 border-b border-border p-4">
        <input type="hidden" name="view" value="items" />
        <Input name="q" aria-label="Search catalogue" defaultValue={q} placeholder="Search name, category, HSN/SAC…" className="max-w-md flex-1" />
        {all && <input type="hidden" name="inactive" value="1" />}
        <Button type="submit" variant="primary" size="sm">Search</Button>
        <Link href={all ? `${BASE}?view=items` : `${BASE}?view=items&inactive=1`} className="text-sm text-muted hover:text-foreground hover:underline">{all ? "Hide inactive" : "Show inactive"}</Link>
      </FilterForm>
      {rows.length === 0 && !q && <EmptyState icon={Package} title="Your catalogue is empty" description="Add the services you quote most often to build documents faster." />}
      <ProductManager rows={rows} canDelete={canDelete} />
      {rows.length === 0 && q && <EmptyState title="No items match" />}
      {rows.length > 0 && <Pagination page={page} pageSize={pageSize} total={total} hrefFor={(n) => link("items", { q, inactive: all ? "1" : "", page: String(n) })} />}
    </Card>
  );
}
