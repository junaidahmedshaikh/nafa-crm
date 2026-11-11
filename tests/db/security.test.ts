import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { ADMIN_ID, asUser, createDb } from "./helpers";

let db: PGlite;
beforeAll(async () => { db = await createDb(); });
const q = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => db.query<T>(sql, params).then((r) => r.rows);

describe("security hardening migration", () => {
  it("every public table has row level security and anon has no table access", async () => {
    expect(await q(`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`)).toEqual([]);
    expect(await q(`select table_name from information_schema.role_table_grants where grantee = 'anon' and table_schema = 'public'`)).toEqual([]);
  });

  it("throttles after the limit within a window", async () => {
    const hit = async () => (await q<{ rate_limit_hit: boolean }>(`select public.rate_limit_hit('t:one', 3, 3600)`))[0].rate_limit_hit;
    expect([await hit(), await hit(), await hit(), await hit(), await hit()]).toEqual([true, true, true, false, false]);
    expect((await q<{ rate_limit_hit: boolean }>(`select public.rate_limit_hit('t:two', 3, 3600)`))[0].rate_limit_hit).toBe(true);   // separate key
  });

  it("is not callable by signed-in users or anonymous visitors, and the table is unreadable", async () => {
    await expect(asUser(db, ADMIN_ID, () => q(`select public.rate_limit_hit('x', 1, 60)`))).rejects.toThrow();
    await expect(asUser(db, null, () => q(`select public.rate_limit_hit('x', 1, 60)`))).rejects.toThrow();
    await expect(asUser(db, ADMIN_ID, () => q(`select * from public.rate_limits`))).rejects.toThrow();
  });

  it("rejects malformed limiter arguments", async () => {
    await expect(q(`select public.rate_limit_hit('', 0, 60)`)).rejects.toThrow(/INVALID_RATE_LIMIT/);
  });

  it("added the foreign-key indexes", async () => {
    const names = (await q<{ indexname: string }>(`select indexname from pg_indexes where schemaname = 'public'`)).map((r) => r.indexname);
    for (const n of ["proposals_lead_idx", "email_recipients_contact_idx", "email_replies_contact_idx", "invoices_lead_idx"]) expect(names).toContain(n);
  });
});
