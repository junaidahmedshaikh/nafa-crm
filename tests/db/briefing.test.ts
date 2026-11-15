import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { ADMIN_ID, INACTIVE_ID, OUTSIDER_ID, asUser, createDb } from "./helpers";

const ACCOUNTS = "00000000-0000-0000-0000-0000000000a7";
const SALES = "00000000-0000-0000-0000-0000000000a8";

let db: PGlite;
beforeAll(async () => {
  db = await createDb();
  await db.exec(`
    insert into auth.users (id, email) values ('${ACCOUNTS}','a@x'), ('${SALES}','s@x');
    insert into public.profiles (id, full_name, role, finance_role) values ('${ACCOUNTS}','Accounts','member','accounts'), ('${SALES}','Sales','member','none');
  `);
});
const q = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => db.query<T>(sql, params).then((r) => r.rows);
const as = <T>(id: string | null, fn: () => Promise<T>) => asUser(db, id, fn);

describe("daily business briefing", () => {
  it("is off by default, at 08:30 India time, every day", async () => {
    const [s] = await q<{ enabled: boolean; delivery_time: string; timezone: string; method: string; days: string }>(`select * from daily_briefing_settings`);
    expect(s).toMatchObject({ enabled: false, delivery_time: "08:30:00", timezone: "Asia/Kolkata", method: "both", days: "all" });
  });

  it("lets only an administrator change the settings", async () => {
    for (const uid of [SALES, ACCOUNTS]) await as(uid, async () => { await q(`update daily_briefing_settings set enabled = true`); });
    expect((await q<{ enabled: boolean }>(`select enabled from daily_briefing_settings`))[0].enabled).toBe(false);
    await as(ADMIN_ID, async () => {
      await q(`update daily_briefing_settings set enabled = true, recipient_email = 'owner@example.com', days = 'weekdays'`);
      await expect(q(`update daily_briefing_settings set method = 'sms'`)).rejects.toThrow(/check/i);
      await expect(q(`update daily_briefing_settings set custom_days = '{7}'`)).rejects.toThrow(/daily_briefing_days_range/);
      await expect(q(`insert into daily_briefing_settings (id) values (false)`)).rejects.toThrow();
    });
    expect((await q<{ enabled: boolean }>(`select enabled from daily_briefing_settings`))[0].enabled).toBe(true);
  });

  it("allows exactly one scheduled briefing per day, however many times the job runs", async () => {
    const ins = () => q(`insert into daily_briefings (briefing_date, kind, summary) values ('2026-11-16', 'scheduled', 's') on conflict do nothing returning id`);
    expect(await ins()).toHaveLength(1);
    expect(await ins()).toHaveLength(0);
    await expect(q(`insert into daily_briefings (briefing_date, kind) values ('2026-11-16', 'scheduled')`)).rejects.toThrow(/duplicate key/i);
    await q(`insert into daily_briefings (briefing_date, kind) values ('2026-11-17', 'scheduled')`);                 // the next day is fine
    await q(`insert into daily_briefings (briefing_date, kind) values ('2026-11-16', 'test'), ('2026-11-16', 'test')`);   // tests never collide
    await expect(q(`insert into daily_briefings (briefing_date, email_status) values ('2026-11-18', 'delivered')`)).rejects.toThrow(/check/i);
  });

  it("shows the history (which holds financial figures) only to admin and accounts / management", async () => {
    for (const t of ["daily_briefings", "daily_briefing_settings"]) {
      await as(null, async () => { await expect(q(`select * from ${t}`), `anon ${t}`).rejects.toThrow(/permission denied/i); });
      for (const uid of [OUTSIDER_ID, INACTIVE_ID, SALES]) await as(uid, async () => { expect(await q(`select * from ${t}`), `${uid} ${t}`).toHaveLength(0); });
      for (const uid of [ADMIN_ID, ACCOUNTS]) await as(uid, async () => { expect((await q(`select * from ${t}`)).length, `${uid} ${t}`).toBeGreaterThan(0); });
    }
  });

  it("lets an administrator create test briefings only, and nobody delete history", async () => {
    await as(ADMIN_ID, async () => {
      expect(await q(`insert into daily_briefings (briefing_date, kind) values ('2026-11-20', 'test') returning id`)).toHaveLength(1);
      await expect(q(`insert into daily_briefings (briefing_date, kind) values ('2026-11-20', 'scheduled')`)).rejects.toThrow(/row-level security/i);
      await q(`update daily_briefings set summary = 'tampered' where kind = 'scheduled'`);     // filtered by RLS: no effect
      await expect(q(`delete from daily_briefings`)).rejects.toThrow(/permission denied/i);
    });
    await as(ACCOUNTS, async () => { await expect(q(`insert into daily_briefings (briefing_date, kind) values ('2026-11-21', 'test')`)).rejects.toThrow(/row-level security/i); });
    expect((await q<{ n: number }>(`select count(*)::int as n from daily_briefings where summary = 'tampered'`))[0].n).toBe(0);
  });
});
