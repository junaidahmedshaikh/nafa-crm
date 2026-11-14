import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { ADMIN_ID, INACTIVE_ID, OUTSIDER_ID, asUser, createDb } from "./helpers";

const ACCOUNTS = "00000000-0000-0000-0000-0000000000e1";
const SALES = "00000000-0000-0000-0000-0000000000e2"; // team member with no finance role

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

async function scheduled(over: Record<string, unknown> = {}) {
  const [r] = await q<{ id: string }>(
    `insert into scheduled_emails (kind, status, to_email, subject, body, scheduled_at, dedupe_key)
     values ($1, $2, 'c@x.com', 'S', 'B', $3, $4) returning id`,
    [over.kind ?? "follow_up", over.status ?? "scheduled", "scheduled_at" in over ? over.scheduled_at : "2026-12-01T05:00:00Z", over.dedupe_key ?? null],
  );
  return r.id;
}

describe("scheduled emails", () => {
  it("records who scheduled it and defaults to India time", async () => {
    await as(SALES, async () => {
      const id = await scheduled();
      const [r] = await q<{ created_by: string; assigned_to: string; timezone: string; revision: number; attempts: number; auto: boolean }>(`select * from scheduled_emails where id=$1`, [id]);
      expect(r).toMatchObject({ created_by: SALES, assigned_to: SALES, timezone: "Asia/Kolkata", revision: 1, attempts: 0, auto: false });
    });
  });

  it("requires a time to be scheduled, and a provider id to be marked sent", async () => {
    await as(SALES, async () => {
      await expect(scheduled({ scheduled_at: null })).rejects.toThrow(/scheduled_emails_needs_time/);
      await scheduled({ status: "draft", scheduled_at: null });   // a draft needs no time
      const id = await scheduled();
      await expect(q(`update scheduled_emails set status='sent' where id=$1`, [id])).rejects.toThrow(/scheduled_emails_sent_has_id/);
      await expect(q(`update scheduled_emails set status='delivered' where id=$1`, [id])).rejects.toThrow(/check/i);
      await expect(q(`insert into scheduled_emails (kind) values ('newsletter')`)).rejects.toThrow(/check/i);
    });
  });

  it("claims an email exactly once (no duplicate sends)", async () => {
    await as(SALES, async () => {
      const id = await scheduled();
      const claim = () => q(`update scheduled_emails set status='sending' where id=$1 and status='scheduled' returning id`, [id]);
      expect(await claim()).toHaveLength(1);
      expect(await claim()).toHaveLength(0);
    });
  });

  it("never lets a sent email be edited, re-queued or deleted", async () => {
    await as(SALES, async () => {
      const id = await scheduled();
      await q(`update scheduled_emails set status='sent', provider_id='msg_1', sent_at=now() where id=$1`, [id]);
      await expect(q(`update scheduled_emails set subject='Changed' where id=$1`, [id])).rejects.toThrow(/EMAIL_ALREADY_SENT/);
      await expect(q(`update scheduled_emails set status='scheduled' where id=$1`, [id])).rejects.toThrow(/EMAIL_ALREADY_SENT/);
      await expect(q(`delete from scheduled_emails where id=$1`, [id])).rejects.toThrow(/permission denied/i);
    });
  });

  it("creates each automatic reminder only once", async () => {
    await as(ACCOUNTS, async () => {
      const key = "inv:00000000-0000-0000-0000-000000000001:-3";
      await scheduled({ kind: "payment_reminder", dedupe_key: key });
      await expect(scheduled({ kind: "payment_reminder", dedupe_key: key })).rejects.toThrow(/duplicate key/i);
      const again = await q(`insert into scheduled_emails (kind, status, to_email, subject, body, scheduled_at, dedupe_key)
        values ('payment_reminder','scheduled','c@x.com','S','B', now(), $1) on conflict (dedupe_key) do nothing returning id`, [key]);
      expect(again).toHaveLength(0);
    });
  });

  it("is invisible and unwritable for anon, profile-less and deactivated users", async () => {
    await as(SALES, () => scheduled());
    for (const t of ["scheduled_emails", "payment_reminder_settings", "invoice_reminder_prefs", "notification_preferences"]) {
      await as(null, async () => { await expect(q(`select * from ${t}`), `anon ${t}`).rejects.toThrow(/permission denied/i); });
      for (const uid of [OUTSIDER_ID, INACTIVE_ID]) {
        await as(uid, async () => { expect(await q(`select * from ${t}`), `${uid} ${t}`).toHaveLength(0); });
      }
    }
    await as(OUTSIDER_ID, async () => {
      await expect(scheduled()).rejects.toThrow(/row-level security/i);
    });
  });
});

describe("payment reminder settings", () => {
  it("are off by default with the standard reminder days", async () => {
    await as(SALES, async () => {
      const [s] = await q<{ enabled: boolean; offsets: number[]; send_hour: number; body: string }>(`select * from payment_reminder_settings`);
      expect(s.enabled).toBe(false);
      expect(s.offsets).toEqual([-7, -3, -1, 0, 3, 7, 15]);
      expect(s.send_hour).toBe(10);
      expect(s.body).toContain("{{pending_amount}}");
    });
  });

  it("can be changed by accounts / admin only", async () => {
    await as(SALES, async () => { await q(`update payment_reminder_settings set enabled=true`); });
    expect((await q<{ enabled: boolean }>(`select enabled from payment_reminder_settings`))[0].enabled).toBe(false);   // silently filtered by RLS
    await as(ACCOUNTS, async () => { await q(`update payment_reminder_settings set enabled=true, offsets='{-3,0,7}'`); });
    expect((await q<{ enabled: boolean; offsets: number[] }>(`select enabled, offsets from payment_reminder_settings`))[0]).toMatchObject({ enabled: true, offsets: [-3, 0, 7] });
    await as(ADMIN_ID, async () => {
      await expect(q(`update payment_reminder_settings set offsets='{2}'`)).rejects.toThrow(/payment_reminder_offsets_range/);
      await expect(q(`update payment_reminder_settings set send_hour=24`)).rejects.toThrow(/check/i);
      await expect(q(`insert into payment_reminder_settings (id) values (false)`)).rejects.toThrow();
    });
  });
});

describe("notification centre", () => {
  it("raises a de-duplicated alert only once per person", async () => {
    const ins = (user: string) => q(`insert into notifications (user_id, type, title, dedupe_key) values ($1, 'invoice_overdue', 'Overdue', 'invoice-overdue:1')
      on conflict (user_id, dedupe_key) do nothing returning id`, [user]);
    expect(await ins(ADMIN_ID)).toHaveLength(1);
    expect(await ins(ADMIN_ID)).toHaveLength(0);
    expect(await ins(ACCOUNTS)).toHaveLength(1);   // a different person still gets theirs
    // ordinary notifications (no key) are never blocked
    await q(`insert into notifications (user_id, type, title) values ($1, 'payment_received', 'A'), ($1, 'payment_received', 'B')`, [ADMIN_ID]);
  });

  it("lets each person read and mark only their own notifications", async () => {
    await as(ACCOUNTS, async () => {
      const mine = await q<{ user_id: string }>(`select user_id from notifications`);
      expect(mine.length).toBeGreaterThan(0);
      expect(mine.every((n) => n.user_id === ACCOUNTS)).toBe(true);
      await q(`update notifications set read_at = now()`);
      await expect(q(`insert into notifications (user_id, type, title) values ($1, 'x', 'x')`, [ACCOUNTS])).rejects.toThrow(/permission denied/i);
    });
    expect((await q<{ n: number }>(`select count(*)::int as n from notifications where user_id=$1 and read_at is null`, [ADMIN_ID]))[0].n).toBeGreaterThan(0);
  });

  it("keeps preferences private to their owner", async () => {
    await as(SALES, async () => {
      await q(`insert into notification_preferences (user_id, muted_types) values ($1, '{expense_recorded}')`, [SALES]);
      await expect(q(`insert into notification_preferences (user_id) values ($1)`, [ADMIN_ID])).rejects.toThrow(/row-level security/i);
    });
    await as(ACCOUNTS, async () => { expect(await q(`select * from notification_preferences`)).toHaveLength(0); });
  });
});
