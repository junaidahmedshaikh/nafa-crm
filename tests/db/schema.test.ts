import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { createDb, asUser, ADMIN_ID, OUTSIDER_ID, INACTIVE_ID } from "./helpers";
import { normalizeCompanyName } from "@/lib/normalize";

let db: PGlite;
beforeAll(async () => {
  db = await createDb();
});

const q = <T = Record<string, unknown>>(sql: string) => db.query<T>(sql).then((r) => r.rows);

describe("row level security", () => {
  it("lets an active profile read and write business data", async () => {
    await asUser(db, ADMIN_ID, async () => {
      await db.exec(`insert into companies (name) values ('RLS Co')`);
      expect((await q(`select * from companies where name='RLS Co'`)).length).toBe(1);
    });
  });

  it("denies anon completely", async () => {
    await asUser(db, null, async () => {
      await expect(q(`select * from leads`)).rejects.toThrow(/permission denied/i);
      await expect(db.exec(`insert into companies (name) values ('x')`)).rejects.toThrow(/permission denied/i);
    });
  });

  it("gives an authenticated user without a profile no rows and no writes", async () => {
    await asUser(db, OUTSIDER_ID, async () => {
      expect(await q(`select * from companies`)).toHaveLength(0);
      expect(await q(`select * from lead_list`)).toHaveLength(0);
      await expect(db.exec(`insert into companies (name) values ('sneaky')`)).rejects.toThrow(/row-level security/i);
    });
  });

  it("gives a deactivated member no access", async () => {
    await asUser(db, INACTIVE_ID, async () => {
      expect(await q(`select * from companies`)).toHaveLength(0);
      await expect(db.exec(`insert into leads (title) values ('x')`)).rejects.toThrow(/row-level security/i);
    });
  });

  it("prevents clients from creating profiles or escalating role", async () => {
    await asUser(db, OUTSIDER_ID, async () => {
      await expect(
        db.exec(`insert into profiles (id, full_name, role) values ('${OUTSIDER_ID}', 'me', 'admin')`),
      ).rejects.toThrow(/permission denied|row-level security/i);
    });
    await asUser(db, INACTIVE_ID, async () => {
      await expect(db.exec(`update profiles set is_active = true where id = '${INACTIVE_ID}'`)).rejects.toThrow(/permission denied/i);
    });
    await asUser(db, ADMIN_ID, async () => {
      await expect(db.exec(`update profiles set role = 'member' where id = '${ADMIN_ID}'`)).rejects.toThrow(/permission denied/i);
      await db.exec(`update profiles set full_name = 'Owner Renamed' where id = '${ADMIN_ID}'`);
    });
  });

  it("makes lead activities append-only", async () => {
    await asUser(db, ADMIN_ID, async () => {
      await db.exec(`insert into leads (title) values ('Append only')`);
      await expect(db.exec(`update lead_activities set summary='tampered'`)).rejects.toThrow(/permission denied/i);
      await expect(db.exec(`delete from lead_activities`)).rejects.toThrow(/permission denied/i);
    });
  });

  it("only lets admins change business settings", async () => {
    await asUser(db, ADMIN_ID, async () => {
      await db.exec(`update business_settings set business_name = 'NAFA Test'`);
    });
    await asUser(db, INACTIVE_ID, async () => {
      expect(await q(`select * from business_settings`)).toHaveLength(0);
    });
    expect((await q<{ business_name: string }>(`select business_name from business_settings`))[0].business_name).toBe("NAFA Test");
  });
});

describe("lead lifecycle triggers", () => {
  it("logs creation, status change, win, loss (with reason) and archive", async () => {
    await asUser(db, ADMIN_ID, async () => {
      const [lead] = await q<{ id: string }>(`insert into leads (title) values ('Lifecycle') returning id`);
      await db.exec(`update leads set status='qualified' where id='${lead.id}'`);
      await db.exec(`update leads set status='won' where id='${lead.id}'`);
      await db.exec(`update leads set archived_at=now() where id='${lead.id}'`);
      const acts = await q<{ type: string }>(`select type from lead_activities where lead_id='${lead.id}'`);
      expect(acts.map((a) => a.type).sort()).toEqual(["archived", "created", "status_changed", "won"].sort());
      const [row] = await q<{ closed_at: string | null }>(`select closed_at from leads where id='${lead.id}'`);
      expect(row.closed_at).not.toBeNull();

      const [lost] = await q<{ id: string }>(`insert into leads (title) values ('Lost one') returning id`);
      await expect(db.exec(`update leads set status='lost' where id='${lost.id}'`)).rejects.toThrow(/leads_lost_reason_required/);
      await db.exec(`update leads set status='lost', lost_reason='Budget too low' where id='${lost.id}'`);
      const [la] = await q<{ summary: string }>(`select summary from lead_activities where lead_id='${lost.id}' and type='lost'`);
      expect(la.summary).toContain("Budget too low");
    });
  });

  it("clears lost_reason and closed_at when a lead is reopened", async () => {
    await asUser(db, ADMIN_ID, async () => {
      const [lead] = await q<{ id: string }>(`insert into leads (title, status, lost_reason) values ('Reopen','lost','No budget') returning id`);
      await db.exec(`update leads set status='contacted' where id='${lead.id}'`);
      const [row] = await q<{ lost_reason: string | null; closed_at: string | null }>(`select lost_reason, closed_at from leads where id='${lead.id}'`);
      expect(row.lost_reason).toBeNull();
      expect(row.closed_at).toBeNull();
    });
  });
});

describe("follow-up triggers", () => {
  it("keeps next_follow_up_at in sync and never leaves completed tasks pending", async () => {
    await asUser(db, ADMIN_ID, async () => {
      const [lead] = await q<{ id: string }>(`insert into leads (title) values ('FU lead') returning id`);
      const [a] = await q<{ id: string }>(`insert into follow_ups (lead_id, title, due_at) values ('${lead.id}','A', now() + interval '2 days') returning id`);
      await db.exec(`insert into follow_ups (lead_id, title, due_at) values ('${lead.id}','B', now() + interval '5 days')`);
      let [row] = await q<{ ok: boolean }>(`select next_follow_up_at = (select due_at from follow_ups where id='${a.id}') as ok from leads where id='${lead.id}'`);
      expect(row.ok).toBe(true);

      await db.exec(`update follow_ups set status='completed', completed_at=now() where id='${a.id}'`);
      [row] = await q<{ ok: boolean }>(`select next_follow_up_at = (select due_at from follow_ups where title='B' and lead_id='${lead.id}') as ok from leads where id='${lead.id}'`);
      expect(row.ok).toBe(true);

      await expect(db.exec(`update follow_ups set status='completed' where title='B' and lead_id='${lead.id}'`)).rejects.toThrow(/follow_ups_completed_at_consistent/);

      await db.exec(`update follow_ups set due_at = now() + interval '9 days' where title='B' and lead_id='${lead.id}'`);
      const types = (await q<{ type: string }>(`select type from lead_activities where lead_id='${lead.id}'`)).map((r) => r.type);
      expect(types).toEqual(expect.arrayContaining(["follow_up_scheduled", "follow_up_completed", "follow_up_rescheduled"]));
    });
  });

  it("cancels pending follow-ups when a lead is closed and clears next_follow_up_at", async () => {
    await asUser(db, ADMIN_ID, async () => {
      const [lead] = await q<{ id: string }>(`insert into leads (title) values ('Closing') returning id`);
      await db.exec(`insert into follow_ups (lead_id, title, due_at) values ('${lead.id}','Call', now() + interval '1 day')`);
      await db.exec(`update leads set status='won' where id='${lead.id}'`);
      const [fu] = await q<{ status: string }>(`select status from follow_ups where lead_id='${lead.id}'`);
      expect(fu.status).toBe("cancelled");
      const [l] = await q<{ next_follow_up_at: string | null }>(`select next_follow_up_at from leads where id='${lead.id}'`);
      expect(l.next_follow_up_at).toBeNull();
    });
  });
});

describe("normalisation used for duplicate detection", () => {
  const samples = ["Acme Pvt. Ltd.", "ACME   Private Limited", "Tata Motors Ltd", "Zee & Co LLP", "  Nafa  Events ", "Infosys"];
  it("matches the TypeScript normaliser exactly", async () => {
    for (const name of samples) {
      await asUser(db, ADMIN_ID, async () => {
        const [inserted] = await q<{ id: string }>(`insert into companies (name) values ('${name.replace(/'/g, "''")}') returning id`);
        const [row] = await q<{ name_normalized: string }>(`select name_normalized from companies where id='${inserted.id}'`);
        expect(normalizeCompanyName(name), name).toBe(row.name_normalized);
      });
    }
  });
  it("stores generated normalised email and phone", async () => {
    await asUser(db, ADMIN_ID, async () => {
      await db.exec(`insert into contacts (full_name, email, phone) values ('A', '  Foo@Bar.COM ', '+91 98765-43210')`);
      const [ct] = await q<{ email_normalized: string; phone_normalized: string }>(`select email_normalized, phone_normalized from contacts where full_name='A'`);
      expect(ct).toEqual({ email_normalized: "foo@bar.com", phone_normalized: "919876543210" });
    });
  });
});

describe("read views", () => {
  it("lead_list joins company, contact and owner; follow_up_list hides archived leads", async () => {
    await asUser(db, ADMIN_ID, async () => {
      const [co] = await q<{ id: string }>(`insert into companies (name) values ('View Co Pvt Ltd') returning id`);
      const [ct] = await q<{ id: string }>(`insert into contacts (full_name, email, phone, company_id) values ('Vee', 'vee@viewco.com', '+919000000001', '${co.id}') returning id`);
      const [lead] = await q<{ id: string }>(`insert into leads (title, company_id, contact_id, assigned_to, expected_revenue_inr) values ('View lead', '${co.id}', '${ct.id}', '${ADMIN_ID}', 250000) returning id`);
      await db.exec(`insert into follow_ups (lead_id, title, due_at) values ('${lead.id}', 'View task', now() + interval '1 day')`);

      const [row] = await q<Record<string, unknown>>(`select * from lead_list where id='${lead.id}'`);
      expect(row).toMatchObject({ company_name: "View Co Pvt Ltd", contact_name: "Vee", contact_email: "vee@viewco.com", contact_phone_digits: "919000000001", assigned_name: expect.any(String) });
      expect(await q(`select * from follow_up_list where lead_id='${lead.id}'`)).toHaveLength(1);
      expect((await q<{ lead_count: number; contact_count: number }>(`select lead_count, contact_count from company_list where id='${co.id}'`))[0]).toEqual({ lead_count: 1, contact_count: 1 });

      await db.exec(`update leads set archived_at = now() where id='${lead.id}'`);
      expect(await q(`select * from follow_up_list where lead_id='${lead.id}'`)).toHaveLength(0);
      expect((await q<{ lead_count: number }>(`select lead_count from company_list where id='${co.id}'`))[0].lead_count).toBe(0);
    });
  });

  it("pipeline_summary aggregates non-archived leads by status", async () => {
    await asUser(db, ADMIN_ID, async () => {
      await db.exec(`insert into leads (title, status, expected_revenue_inr) values ('P1','negotiation',1000),('P2','negotiation',500)`);
      const [r] = await q<{ lead_count: number; expected_revenue_inr: string }>(`select lead_count, expected_revenue_inr from pipeline_summary where status='negotiation'`);
      expect(r.lead_count).toBeGreaterThanOrEqual(2);
      expect(Number(r.expected_revenue_inr)).toBeGreaterThanOrEqual(1500);
    });
  });

  it("views expose nothing to anon, outsiders or deactivated members", async () => {
    for (const view of ["lead_list", "follow_up_list", "company_list", "contact_list", "pipeline_summary"]) {
      await asUser(db, null, async () => {
        await expect(q(`select * from ${view}`), view).rejects.toThrow(/permission denied/i);
      });
      for (const id of [OUTSIDER_ID, INACTIVE_ID]) {
        await asUser(db, id, async () => {
          const rows = await q(`select * from ${view}`);
          expect(rows, `${view} as ${id}`).toHaveLength(0);
        });
      }
    }
  });
});

describe("development seed", () => {
  it("runs cleanly, labels every record as demo data, and can be removed", async () => {
    const seed = fs.readFileSync(path.resolve(__dirname, "../../supabase/seed.sql"), "utf8");
    await db.exec(seed);
    const [counts] = await q<{ leads: number; demo: number; fus: number }>(
      `select count(*)::int as leads, count(*) filter (where title like '[DEMO]%')::int as demo,
              (select count(*)::int from follow_ups where title like '[DEMO]%') as fus from leads where notes = '[DEMO] sample record'`,
    );
    expect(counts.leads).toBe(3);
    expect(counts.demo).toBe(3);
    expect(counts.fus).toBe(3);
    expect((await q<{ n: number }>(`select count(*)::int as n from contacts where full_name like '[DEMO]%'`))[0].n).toBe(3);
    expect(seed).not.toMatch(/password|secret|service_role|eyJ/i);
    await db.exec(`delete from leads where title like '[DEMO]%'; delete from contacts where full_name like '[DEMO]%'; delete from companies where name like '[DEMO]%';`);
    expect((await q<{ n: number }>(`select count(*)::int as n from companies where name like '[DEMO]%'`))[0].n).toBe(0);
  });
});
