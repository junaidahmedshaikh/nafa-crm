import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { ADMIN_ID, INACTIVE_ID, OUTSIDER_ID, asUser, createDb } from "./helpers";

const ACCOUNTS = "00000000-0000-0000-0000-0000000000f1";
const OPS = "00000000-0000-0000-0000-0000000000f2";      // finance role without manage rights
const SALES = "00000000-0000-0000-0000-0000000000f3";    // team member with no finance role

let db: PGlite;
let led: string;
const vendor: Record<string, string> = {};
beforeAll(async () => {
  db = await createDb();
  await db.exec(`
    insert into auth.users (id, email) values ('${ACCOUNTS}','a@x'), ('${OPS}','o@x'), ('${SALES}','s@x');
    insert into public.profiles (id, full_name, role, finance_role) values
      ('${ACCOUNTS}','Accounts','member','accounts'), ('${OPS}','Ops','member','operations'), ('${SALES}','Sales','member','none');
  `);
});
const q = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => db.query<T>(sql, params).then((r) => r.rows);
const as = <T>(id: string | null, fn: () => Promise<T>) => asUser(db, id, fn);
const addRate = (v: string, p: string, rate: number, extra = "") =>
  q<{ id: string }>(`insert into vendor_rates (vendor_id, product_id, rate_type, unit, rate, gst_percent ${extra ? ", " + extra.split("=")[0] : ""})
     values ($1, $2, 'per_day', 'Per Day', $3, 18 ${extra ? ", " + extra.split("=")[1] : ""}) returning id`, [v, p, rate]).then((r) => r[0].id);

describe("vendor rate catalogue", () => {
  it("keeps existing vendors and catalogue items working and seeds the categories", async () => {
    await as(ACCOUNTS, async () => {
      for (const n of ["Vendor A", "Vendor B", "Vendor C"]) vendor[n] = (await q<{ id: string }>(`insert into vendors (name, city) values ($1, 'Mumbai') returning id`, [n]))[0].id;
      led = (await q<{ id: string }>(`insert into products_services (name, unit, default_rate) values ('24 x 12 ft LED Screen', 'Per Day', 0) returning id`))[0].id;
      const [v] = await q<{ status: string; gst_registered: boolean; is_preferred: boolean; rating_quality: number | null }>(`select * from vendors where id=$1`, [vendor["Vendor A"]]);
      expect(v).toMatchObject({ status: "active", gst_registered: false, is_preferred: false, rating_quality: null });
      expect((await q<{ n: number }>(`select count(*)::int as n from vendor_categories`))[0].n).toBe(22);
      await expect(q(`insert into vendors (name) values ('vendor a')`)).rejects.toThrow(/duplicate key/i);   // no duplicate vendors
    });
  });

  it("holds rates from several vendors for the same service and computes the estimated cost", async () => {
    await as(ACCOUNTS, async () => {
      await addRate(vendor["Vendor A"], led, 45000, "transport_charges=2000");
      await addRate(vendor["Vendor B"], led, 48000);
      await addRate(vendor["Vendor C"], led, 42000, "setup_charges=3000");
      const rows = await q<{ vendor_name: string; rate: string; estimated_cost: string; is_expired: boolean }>(
        `select vendor_name, rate, estimated_cost, is_expired from vendor_rate_list where product_id=$1 order by estimated_cost`, [led]);
      expect(rows.map((r) => [r.vendor_name, Number(r.estimated_cost)])).toEqual([["Vendor C", 53100], ["Vendor A", 55460], ["Vendor B", 56640]]);
      expect(rows.every((r) => r.is_expired === false)).toBe(true);
    });
  });

  it("refuses a second live rate of the same type, bad values and unknown types", async () => {
    await as(ACCOUNTS, async () => {
      await expect(addRate(vendor["Vendor A"], led, 44000)).rejects.toThrow(/vendor_rates_live_uidx|duplicate key/i);
      await expect(q(`insert into vendor_rates (vendor_id, product_id, unit, rate) values ($1, $2, 'nos', -1)`, [vendor["Vendor B"], led])).rejects.toThrow(/check/i);
      await expect(q(`insert into vendor_rates (vendor_id, product_id, unit, rate, rate_type) values ($1, $2, 'nos', 1, 'barter')`, [vendor["Vendor B"], led])).rejects.toThrow(/vendor_rates_type_check/);
      await expect(q(`insert into vendor_rates (vendor_id, product_id, unit, rate, gst_percent, rate_type) values ($1, $2, 'nos', 1, 140, 'purchase')`, [vendor["Vendor B"], led])).rejects.toThrow(/check/i);
      await expect(q(`update vendors set status='banned' where id=$1`, [vendor["Vendor A"]])).rejects.toThrow(/vendors_status_check/);
      await expect(q(`update vendors set rating_quality=6 where id=$1`, [vendor["Vendor A"]])).rejects.toThrow(/vendors_ratings_check/);
    });
  });

  it("keeps the previous price, who changed it, when and why, on every price change", async () => {
    await as(ACCOUNTS, async () => {
      const [r] = await q<{ id: string }>(`select id from vendor_rates where vendor_id=$1`, [vendor["Vendor A"]]);
      await q(`update vendor_rates set rate=47000, change_note='Diesel surcharge', effective_from='2026-12-01' where id=$1`, [r.id]);
      await q(`update vendor_rates set notes='spoke to Rakesh' where id=$1`, [r.id]);                       // not a price change: no history row
      await q(`update vendor_rates set rate=46000, transport_charges=2500, change_note='Negotiated', effective_from='2027-01-01' where id=$1`, [r.id]);
      const h = await q<{ old_rate: string; new_rate: string; old_transport_charges: string; note: string; changed_by: string; effective_from: string; old_effective_from: string }>(
        `select old_rate, new_rate, old_transport_charges, note, changed_by, effective_from::text, old_effective_from::text from vendor_rate_history where rate_id=$1 order by id`, [r.id]);
      expect(h).toHaveLength(2);
      expect(h[0]).toMatchObject({ note: "Diesel surcharge", changed_by: ACCOUNTS, effective_from: "2026-12-01" });
      expect([Number(h[0].old_rate), Number(h[0].new_rate)]).toEqual([45000, 47000]);
      expect([Number(h[1].old_rate), Number(h[1].new_rate), Number(h[1].old_transport_charges)]).toEqual([47000, 46000, 2000]);
      expect(h[1]).toMatchObject({ note: "Negotiated", old_effective_from: "2026-12-01", effective_from: "2027-01-01" });
      // The history cannot be rewritten or erased, and a rate cannot be deleted (only deactivated).
      await expect(q(`update vendor_rate_history set old_rate=1`)).rejects.toThrow(/permission denied/i);
      await expect(q(`delete from vendor_rate_history`)).rejects.toThrow(/permission denied/i);
      await expect(q(`delete from vendor_rates where id=$1`, [r.id])).rejects.toThrow(/permission denied/i);
      await q(`update vendor_rates set is_active=false where id=$1`, [r.id]);
      expect(await q(`select 1 from vendor_rate_history where rate_id=$1`, [r.id])).toHaveLength(2);
      await addRate(vendor["Vendor A"], led, 44000);   // with the old one inactive, a new live rate is allowed
    });
  });

  it("marks expired rates", async () => {
    await as(ACCOUNTS, async () => {
      await q(`update vendor_rates set valid_until='2020-01-01' where vendor_id=$1`, [vendor["Vendor B"]]);
      expect((await q<{ is_expired: boolean }>(`select is_expired from vendor_rate_list where vendor_id=$1`, [vendor["Vendor B"]]))[0].is_expired).toBe(true);
    });
  });

  it("shows purchase rates only to people with a finance role, and lets only managers change them", async () => {
    for (const t of ["vendor_rates", "vendor_rate_history", "vendor_rate_list", "vendor_list", "vendor_categories"]) {
      await as(null, async () => { await expect(q(`select * from ${t}`), `anon ${t}`).rejects.toThrow(/permission denied/i); });
      for (const uid of [OUTSIDER_ID, INACTIVE_ID, SALES]) {
        await as(uid, async () => { expect(await q(`select * from ${t}`), `${uid} ${t}`).toHaveLength(0); });
      }
    }
    await as(OPS, async () => {
      expect((await q(`select * from vendor_rate_list`)).length).toBeGreaterThan(0);          // may read
      await expect(addRate(vendor["Vendor B"], led, 1)).rejects.toThrow(/row-level security/i);   // may not add
      await q(`update vendor_rates set rate=1`);                                               // silently affects nothing
    });
    await as(SALES, async () => { await expect(addRate(vendor["Vendor B"], led, 1)).rejects.toThrow(/row-level security/i); });
    await as(ADMIN_ID, async () => {
      expect((await q<{ n: number }>(`select count(*)::int as n from vendor_rates where rate = 1`))[0].n).toBe(0);
      // Sales can still read the quotation catalogue itself: it holds selling rates only.
    });
    await as(SALES, async () => { expect((await q(`select * from products_services`)).length).toBeGreaterThan(0); });
  });

  it("deletes a rate softly: hidden everywhere, history kept, and the same rate can be added again", async () => {
    await as(SALES, async () => { await q(`update vendor_rates set deleted_at = now()`); });   // no rights: nothing happens
    await as(ACCOUNTS, async () => {
      const [r] = await q<{ id: string }>(`select id from vendor_rates where vendor_id=$1 and not is_active`, [vendor["Vendor A"]]);   // the one with two history rows
      const [live] = await q<{ id: string }>(`select id from vendor_rates where vendor_id=$1 and is_active`, [vendor["Vendor A"]]);
      const before = (await q(`select 1 from vendor_rate_list where vendor_id=$1`, [vendor["Vendor A"]])).length;
      await q(`update vendor_rates set deleted_at = now() where id in ($1, $2)`, [r.id, live.id]);
      expect((await q(`select 1 from vendor_rate_list where vendor_id=$1`, [vendor["Vendor A"]])).length).toBe(before - 2);
      const [d] = await q<{ deleted_by: string; is_active: boolean }>(`select deleted_by, is_active from vendor_rates where id=$1`, [live.id]);
      expect(d).toMatchObject({ deleted_by: ACCOUNTS, is_active: false });
      expect(await q(`select 1 from vendor_rate_history where rate_id=$1`, [r.id])).toHaveLength(2);
      expect((await q<{ rate_count: number }>(`select rate_count from vendor_list where id=$1`, [vendor["Vendor A"]]))[0].rate_count).toBe(0);
      await addRate(vendor["Vendor A"], led, 43000);   // a deleted rate does not block a new one
    });
  });

  it("deletes a vendor softly and takes its rates out of the catalogue", async () => {
    await as(OPS, async () => { await expect(q(`update vendors set deleted_at = now() where id=$1`, [vendor["Vendor C"]])).resolves.toBeDefined(); });
    expect((await q<{ deleted_at: string | null }>(`select deleted_at from vendors where id=$1`, [vendor["Vendor C"]]))[0].deleted_at).toBeNull();   // ops cannot delete
    await as(ACCOUNTS, async () => {
      await q(`update vendors set deleted_at = now() where id=$1`, [vendor["Vendor C"]]);
      expect(await q(`select 1 from vendor_rate_list where vendor_id=$1`, [vendor["Vendor C"]])).toHaveLength(0);
      expect(await q(`select 1 from vendor_list where id=$1 and deleted_at is null`, [vendor["Vendor C"]])).toHaveLength(0);
      await q(`insert into vendors (name) values ('Vendor C')`);   // the name is free again
    });
    expect(await q(`select 1 from vendors where id=$1`, [vendor["Vendor C"]])).toHaveLength(1);   // the row itself is kept
  });

  it("deletes a catalogue item only when no vendor rate uses it, and only for managers", async () => {
    const [spare] = await q<{ id: string }>(`insert into products_services (name, unit) values ('Spare item', 'nos') returning id`);
    await as(SALES, async () => { await q(`delete from products_services where id=$1`, [spare.id]); });
    expect(await q(`select 1 from products_services where id=$1`, [spare.id])).toHaveLength(1);   // sales cannot delete
    await as(ACCOUNTS, async () => {
      await expect(q(`delete from products_services where id=$1`, [led])).rejects.toThrow(/foreign key/i);   // still has vendor rates
      expect(await q(`delete from products_services where id=$1 returning id`, [spare.id])).toHaveLength(1);
    });
  });

  it("never copies a purchase rate into the quotation catalogue or a quotation", async () => {
    const [p] = await q<{ default_rate: string }>(`select default_rate from products_services where id=$1`, [led]);
    expect(Number(p.default_rate)).toBe(0);
    const cols = (await q<{ column_name: string }>(`select column_name from information_schema.columns where table_schema='public' and table_name in ('quotations','quotation_items','invoices','invoice_items')`)).map((c) => c.column_name);
    expect(cols.filter((c) => /vendor|purchase|cost/.test(c))).toEqual([]);
  });
});
