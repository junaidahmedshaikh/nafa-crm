import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { ADMIN_ID, OUTSIDER_ID, asUser, createDb } from "./helpers";

let db: PGlite;
beforeAll(async () => { db = await createDb(); });
const q = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => db.query<T>(sql, params).then((r) => r.rows);

describe("payments_received_total()", () => {
  it("adds up live payments, ignores voided ones, and obeys row-level security", async () => {
    // Seeded as the database owner so the test does not depend on the issue flow.
    await db.exec(`set session_replication_role = replica`);
    const [inv] = await q<{ id: string }>(`insert into invoices (client_name, grand_total) values ('Acme', 100000) returning id`);
    await q(`insert into invoice_payments (invoice_id, paid_on, amount) values ($1, '2026-11-01', 25000.50), ($1, '2026-11-02', 10000)`, [inv.id]);
    await q(`insert into invoice_payments (invoice_id, paid_on, amount, voided_at, voided_reason) values ($1, '2026-11-03', 999, now(), 'entered twice')`, [inv.id]);
    await db.exec(`set session_replication_role = origin`);

    await asUser(db, ADMIN_ID, async () => {
      expect(Number((await q<{ t: string }>(`select public.payments_received_total() as t`))[0].t)).toBe(35000.5);
    });
    // Someone without a team profile sees no payments, so their total is zero.
    await asUser(db, OUTSIDER_ID, async () => {
      expect(Number((await q<{ t: string }>(`select public.payments_received_total() as t`))[0].t)).toBe(0);
    });
    await asUser(db, null, async () => {
      await expect(q(`select public.payments_received_total()`)).rejects.toThrow(/permission denied/i);
    });
  });

  it("is created together with the supporting indexes", async () => {
    const names = (await q<{ indexname: string }>(`select indexname from pg_indexes where schemaname = 'public'`)).map((r) => r.indexname);
    for (const n of ["quotations_revision_of_idx", "proposals_revision_of_idx", "proposal_attachments_section_idx", "reimbursements_category_idx", "invoice_payments_live_idx"]) {
      expect(names, n).toContain(n);
    }
  });
});
