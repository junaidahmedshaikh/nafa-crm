import { beforeAll, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import type { PGlite } from "@electric-sql/pglite";
import { ADMIN_ID, asUser, createDb } from "./helpers";

/**
 * End to end: the real server actions and the real invoice page, running against a real Postgres (with the
 * real migrations, triggers and RLS) through a small stand-in for the Supabase client.
 */
let db: PGlite;

type Op = { table: string; cols: string; where: string[]; params: unknown[]; order: string[]; limit?: number; patch?: Record<string, unknown>; count?: boolean; head?: boolean };

function client() {
  class Q {
    op: Op = { table: "", cols: "*", where: [], params: [], order: [] };
    private mode: "select" | "update" = "select";
    constructor(table: string) { this.op.table = table; }
    select(cols = "*", o?: { count?: string; head?: boolean }) { this.op.cols = cols; this.op.count = !!o?.count; this.op.head = !!o?.head; return this; }
    update(patch: Record<string, unknown>) { this.mode = "update"; this.op.patch = patch; return this; }
    private cond(col: string, sql: string, v?: unknown) { if (v !== undefined) this.op.params.push(v); this.op.where.push(sql.replace("$", `$${this.op.params.length}`).replace("COL", col)); return this; }
    eq(c: string, v: unknown) { return this.cond(c, "COL = $", v); }
    is(c: string, v: null) { void v; this.op.where.push(`${c} is null`); return this; }
    in(c: string, vs: unknown[]) { this.op.params.push(vs); this.op.where.push(`${c} = any($${this.op.params.length})`); return this; }
    order(c: string, o?: { ascending?: boolean }) { this.op.order.push(`${c} ${o?.ascending === false ? "desc" : "asc"}`); return this; }
    limit(n: number) { this.op.limit = n; return this; }
    private async run() {
      const { table, where, params, order, limit, patch } = this.op;
      const embed = /(\w+):profiles\(full_name\)/.exec(this.op.cols);
      let cols = this.op.cols.replace(/,?\s*\w+:profiles\(full_name\)/, "").trim() || "*";
      if (cols === "") cols = "*";
      const extra = embed ? `, (select json_build_object('full_name', pr.full_name) from public.profiles pr where pr.id = t.created_by) as ${embed[1]}` : "";
      const w = where.length ? ` where ${where.join(" and ")}` : "";
      let sql: string;
      let args = params;
      if (this.mode === "update") {
        const keys = Object.keys(patch!);
        const sets = keys.map((k, i) => `${k} = $${params.length + i + 1}`).join(", ");
        args = [...params, ...keys.map((k) => patch![k])];
        sql = `with t as (update public.${table} t set ${sets}${w.replaceAll(/\b(\w+) (=|is)/g, "t.$1 $2")} returning ${cols === "*" ? "t.*" : cols.split(",").map((c) => `t.${c.trim()}`).join(", ")}) select to_jsonb(t) r from t`;
      } else {
        const inner = `select t.*${extra} from public.${table} t${w.replaceAll(/\b(\w+) (=|is)/g, "t.$1 $2")}${order.length ? ` order by ${order.join(", ")}` : ""}${limit ? ` limit ${limit}` : ""}`;
        sql = `select to_jsonb(s) r from (${inner}) s`;
      }
      try {
        const res = await asUser(db, ADMIN_ID, () => db.query<{ r: Record<string, unknown> }>(sql, args));
        const rows = res.rows.map((x) => x.r);
        const picked = this.mode === "select" && cols !== "*" ? rows.map((r) => Object.fromEntries([...cols.split(",").map((c) => c.trim()), ...(embed ? [embed[1]] : [])].map((c) => [c, r[c]]))) : rows;
        return { data: this.op.head ? null : picked, count: picked.length, error: null as null | { code?: string; message: string } };
      } catch (e) {
        const err = e as { code?: string; message: string };
        return { data: null, count: null, error: { code: err.code, message: err.message } };
      }
    }
    async maybeSingle() { const r = await this.run(); return { data: (r.data as unknown[] | null)?.[0] ?? null, error: r.error }; }
    async single() { return this.maybeSingle(); }
    then<T>(res: (v: Awaited<ReturnType<Q["run"]>>) => T) { return this.run().then(res); }
  }
  return {
    auth: { getUser: async () => ({ data: { user: { id: ADMIN_ID, email: "owner@example.com" } }, error: null }) },
    from: (t: string) => new Q(t),
    rpc: async (fn: string, args: Record<string, unknown>) => {
      const keys = Object.keys(args);
      const call = `public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(", ")})`;
      try {
        const res = await asUser(db, ADMIN_ID, () => db.query<{ v: unknown }>(`select to_jsonb(${call}) v`, keys.map((k) => (typeof args[k] === "object" && args[k] !== null ? JSON.stringify(args[k]) : args[k]))));
        return { data: res.rows[0]?.v ?? null, error: null as null | { code?: string; message: string } };
      } catch (e) {
        const err = e as { code?: string; message: string };
        return { data: null, error: { code: err.code, message: err.message } };
      }
    },
  };
}

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => client() }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ getAll: () => [], set() {} }), headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh() {}, push() {}, replace() {} }),
  notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
  redirect: (to: string) => { throw new Error(`REDIRECT ${to}`); },
}));
vi.mock("sonner", () => ({ toast: { success() {}, error() {} } }));

beforeAll(async () => {
  db = await createDb();
  await db.exec(`update public.document_settings set bank_account_number = '123456', bank_upi_id = 'nafa@upi', bank_name = 'Bank', bank_ifsc = 'IFSC0001', bank_account_holder = 'NAFA'`);
});

const q = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => db.query<T>(sql, params).then((r) => r.rows);

async function newIssuedInvoice() {
  const [r] = await q<{ id: string }>(`select public.save_invoice($1::jsonb) as id`, [JSON.stringify({
    client_company: "Aurora Motors", client_name: "Asha", client_email: "a@b.c", grand_total: 1180, subtotal: 1000, taxable_value: 1000, cgst: 90, sgst: 90,
    invoice_date: "2026-11-01", due_date: "2026-11-08", config: { tax: { mode: "cgst_sgst", rate: 18 } }, items: [{ description: "Stage", qty: 1, rate: 1000, amount: 1000 }],
  })]);
  const actions = await import("@/lib/actions/documents");
  const issued = await actions.issueInvoice(r.id);
  expect(issued).toMatchObject({ ok: true });
  return r.id;
}

async function renderInvoicePage(id: string) {
  const { default: Page } = await import("@/app/(app)/invoices/[id]/page");
  const el = await Page({ params: Promise.resolve({ id }) } as never);
  return renderToString(createElement("div", null, el));
}

describe("cancel an invoice end to end", () => {
  it("cancels an issued invoice with no payments, then the page renders", async () => {
    const id = await newIssuedInvoice();
    expect(await renderInvoicePage(id)).toContain("Aurora Motors");
    const { cancelInvoice } = await import("@/lib/actions/documents");
    const res = await cancelInvoice(id, "Raised for the wrong client");
    expect(res).toEqual({ ok: true });
    const html = await renderInvoicePage(id);
    expect(html).toContain("Cancelled");
    expect(html).toContain("Raised for the wrong client");
  });

  it("cancels after the payments were voided, then the page renders", async () => {
    const id = await newIssuedInvoice();
    const [pay] = await q<{ id: string }>(`insert into invoice_payments (invoice_id, paid_on, amount) values ($1,'2026-11-02',500) returning id`, [id]);
    const { cancelInvoice, voidPayment } = await import("@/lib/actions/documents");
    expect(await cancelInvoice(id, "Client cancelled")).toMatchObject({ ok: false, error: expect.stringContaining("recorded payments") });
    expect(await voidPayment(pay.id, "Refunded")).toEqual({ ok: true });
    expect(await cancelInvoice(id, "Client cancelled")).toEqual({ ok: true });
    const html = await renderInvoicePage(id);
    expect(html).toContain("Cancelled");
    expect(html).toContain("Refunded");
  });
});
