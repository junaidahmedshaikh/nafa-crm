import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { ADMIN_ID, OUTSIDER_ID, asUser, createDb } from "./helpers";

const MEMBER = "00000000-0000-0000-0000-0000000000f2";
let db: PGlite;
beforeAll(async () => {
  db = await createDb();
  await db.exec(`insert into auth.users (id, email) values ('${MEMBER}','m@x'); insert into public.profiles (id, full_name, role) values ('${MEMBER}','Member','member');`);
});
const q = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => db.query<T>(sql, params).then((r) => r.rows);

describe("AI BDM schema", () => {
  it("has a default 08:30 IST briefing configuration", async () => {
    const [s] = await asUser(db, MEMBER, () => q<{ briefing_time: string; enabled: boolean }>(`select briefing_time::text, enabled from bdm_settings`));
    expect(s.briefing_time.startsWith("08:30")).toBe(true);
    expect(s.enabled).toBe(true);
  });

  it("lets only an administrator change the settings", async () => {
    await asUser(db, ADMIN_ID, () => q(`update bdm_settings set briefing_time = '07:45'`));
    const [s] = await q<{ t: string }>(`select briefing_time::text as t from bdm_settings`);
    expect(s.t.startsWith("07:45")).toBe(true);
    await asUser(db, MEMBER, () => q(`update bdm_settings set briefing_time = '06:00'`));
    const [after] = await q<{ t: string }>(`select briefing_time::text as t from bdm_settings`);
    expect(after.t.startsWith("07:45")).toBe(true); // RLS filtered the member's update to zero rows
  });

  it("keeps one recommendation per subject per day, and blocks people without access", async () => {
    const lead = await q<{ id: string }>(`insert into leads (title) values ('L') returning id`);
    const ins = (title: string) =>
      q(`insert into bdm_recommendations (for_date, dedupe_key, kind, lead_id, title, action, reason) values ('2026-11-10', $1, 'prospect', $2, $3, 'a', 'r')`, [`lead:${lead[0].id}`, lead[0].id, title]);
    await asUser(db, MEMBER, () => ins("first"));
    await expect(asUser(db, MEMBER, () => ins("duplicate"))).rejects.toThrow(/unique|duplicate/i);
    await expect(asUser(db, OUTSIDER_ID, () => ins("x"))).rejects.toThrow();
    const rows = await asUser(db, OUTSIDER_ID, () => q(`select * from bdm_recommendations`));
    expect(rows).toHaveLength(0);
  });

  it("accepts reply and message activities for reply tracking", async () => {
    const lead = await q<{ id: string }>(`insert into leads (title) values ('L2') returning id`);
    await asUser(db, MEMBER, () => q(`insert into lead_activities (lead_id, type, summary) values ($1, 'reply_received', 'Client replied')`, [lead[0].id]));
    const rows = await q(`select type from lead_activities where lead_id = $1 and type = 'reply_received'`, [lead[0].id]);
    expect(rows).toHaveLength(1);
  });

  it("allows one briefing per IST day and hides job logs from non-admins", async () => {
    await asUser(db, MEMBER, () => q(`insert into bdm_briefings (briefing_date, trigger) values ('2026-11-10', 'manual')`));
    await expect(asUser(db, MEMBER, () => q(`insert into bdm_briefings (briefing_date, trigger) values ('2026-11-10', 'cron')`))).rejects.toThrow();
    await expect(asUser(db, MEMBER, () => q(`insert into bdm_job_runs (job) values ('x')`))).rejects.toThrow();
  });
});
