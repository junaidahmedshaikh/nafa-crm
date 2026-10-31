import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { ADMIN_ID, asUser, createDb } from "./helpers";

const ACCOUNTS = "00000000-0000-0000-0000-0000000000d1";
const PM = "00000000-0000-0000-0000-0000000000d2";
const OPS = "00000000-0000-0000-0000-0000000000d3";
const PLAIN = "00000000-0000-0000-0000-0000000000d4"; // team member without any finance role

let db: PGlite;
let cat: Record<string, string>;
beforeAll(async () => {
  db = await createDb();
  await db.exec(`
    insert into auth.users (id, email) values ('${ACCOUNTS}','a@x'), ('${PM}','pm@x'), ('${OPS}','ops@x'), ('${PLAIN}','p@x');
    insert into public.profiles (id, full_name, role, finance_role) values
      ('${ACCOUNTS}','Accounts','member','accounts'), ('${PM}','PM','member','project_manager'),
      ('${OPS}','Ops','member','operations'), ('${PLAIN}','Plain','member','none');
  `);
  const rows = (await db.query<{ id: string; name: string }>(`select id, name from expense_categories`)).rows;
  cat = Object.fromEntries(rows.map((r) => [r.name, r.id]));
});

const q = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => db.query<T>(sql, params).then((r) => r.rows);
const as = <T>(id: string, fn: () => Promise<T>) => asUser(db, id, fn);
const admin = <T>(fn: () => Promise<T>) => as(ADMIN_ID, fn);

async function project(name = "Dealer Meet", over: Record<string, unknown> = {}) {
  const [r] = await q<{ id: string }>(
    `insert into projects (name, approved_value, start_date) values ($1, $2, $3) returning id`,
    [name, over.approved_value ?? 100000, over.start_date ?? "2026-11-10"],
  );
  return r.id;
}
async function expense(projectId: string, o: Record<string, unknown> = {}) {
  const [r] = await q<{ id: string }>(
    `insert into expenses (project_id, category_id, description, vendor_id, bill_number, qty, rate, gst_amount, gst_recoverable, due_date)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
    [projectId, o.category ?? cat["Miscellaneous"], o.description ?? "Item", o.vendor ?? null, o.bill ?? null, o.qty ?? 1, o.rate ?? 1000, o.gst ?? 0, o.recoverable ?? true, o.due ?? null],
  );
  return r.id;
}
const summary = async (projectId: string) =>
  (await q<Record<string, string>>(`select * from project_finance_summary where project_id=$1`, [projectId]))[0];
const num = (v: string | number | undefined) => Number(v);

describe("expense maths and GST treatment", () => {
  it("computes subtotal/total in the database and keeps recoverable GST out of cost", async () => {
    await admin(async () => {
      const p = await project();
      const e = await expense(p, { qty: 2.5, rate: 1000, gst: 450, recoverable: true });
      const [row] = await q<Record<string, string>>(`select subtotal, total_amount, cost_amount from expense_list where id=$1`, [e]);
      expect([num(row.subtotal), num(row.total_amount), num(row.cost_amount)]).toEqual([2500, 2950, 2500]);
      const s = await summary(p);
      expect(num(s.expense_cost)).toBe(2500);
      expect(num(s.gst_input_recoverable)).toBe(450);
    });
  });

  it("counts GST as a cost when it is not recoverable", async () => {
    await admin(async () => {
      const p = await project();
      await expense(p, { rate: 1000, gst: 180, recoverable: false });
      expect(num((await summary(p)).expense_cost)).toBe(1180);
    });
  });

  it("rejects bad numbers and duplicate vendor bills", async () => {
    await admin(async () => {
      const p = await project();
      await expect(expense(p, { qty: 0 })).rejects.toThrow();
      await expect(expense(p, { rate: -1 })).rejects.toThrow();
      const [v] = await q<{ id: string }>(`insert into vendors (name) values ('Sharma Fabricators') returning id`);
      await expense(p, { vendor: v.id, bill: "SF-101" });
      await expect(expense(p, { vendor: v.id, bill: " sf-101 " })).rejects.toThrow(/duplicate/i);
    });
  });
});

describe("vendor payments", () => {
  it("allows partial payments, blocks overpayment and exact duplicates, and only voids", async () => {
    await admin(async () => {
      const p = await project();
      const e = await expense(p, { rate: 1000, gst: 180, due: "2099-01-01" }); // total 1180
      const pay = (amt: number, on = "2026-11-12", ref: string | null = null) =>
        q(`insert into expense_payments (expense_id, paid_on, amount, reference) values ($1,$2,$3,$4)`, [e, on, amt, ref]);
      await pay(400, "2026-11-12", "UTR1");
      await expect(pay(400, "2026-11-12", "UTR1")).rejects.toThrow(/duplicate/i);
      await pay(400, "2026-11-13", "UTR2");
      const [mid] = await q<Record<string, string>>(`select paid_amount, outstanding_amount, payment_status from expense_list where id=$1`, [e]);
      expect([num(mid.paid_amount), num(mid.outstanding_amount), mid.payment_status]).toEqual([800, 380, "partial"]);
      await expect(pay(500, "2026-11-14")).rejects.toThrow(/PAYMENT_EXCEEDS_BALANCE/);
      await pay(380, "2026-11-14");
      expect((await q<{ payment_status: string }>(`select payment_status from expense_list where id=$1`, [e]))[0].payment_status).toBe("paid");
      // payments are immutable except for voiding
      const [one] = await q<{ id: string }>(`select id from expense_payments where expense_id=$1 limit 1`, [e]);
      await expect(q(`delete from expense_payments where id=$1`, [one.id])).rejects.toThrow();
      await expect(q(`update expense_payments set amount = 1 where id=$1`, [one.id])).rejects.toThrow(/PAYMENT_IMMUTABLE/);
      await expect(q(`update expense_payments set voided_at = now() where id=$1`, [one.id])).rejects.toThrow(); // reason required
      await q(`update expense_payments set voided_at = now(), voided_reason = 'wrong' where id=$1`, [one.id]);
      expect((await q<{ payment_status: string }>(`select payment_status from expense_list where id=$1`, [e]))[0].payment_status).toBe("partial");
    });
  });

  it("flags unpaid bills past their due date as overdue", async () => {
    await admin(async () => {
      const p = await project();
      const e = await expense(p, { due: "2020-01-01" });
      expect((await q<{ payment_status: string }>(`select payment_status from expense_list where id=$1`, [e]))[0].payment_status).toBe("overdue");
    });
  });
});

describe("reimbursements are counted exactly once", () => {
  it("counts approved ones, skips submitted/rejected, and skips ones linked to a recorded expense", async () => {
    await admin(async () => {
      const p = await project();
      const add = async (status: string, expenseId: string | null = null, amount = 500) => {
        const [r] = await q<{ id: string }>(
          `insert into reimbursements (person_name, project_id, description, category_id, amount, status, expense_id, reimbursed_on)
           values ('Ravi', $1, 'Cab', $2, $3, $4::reimbursement_status, $5, case when $4 = 'reimbursed' then current_date end) returning id`,
          [p, cat["Transportation & Logistics"], amount, status, expenseId],
        );
        return r.id;
      };
      await add("submitted");
      await add("rejected");
      expect(num((await summary(p)).reimbursement_cost)).toBe(0);
      await add("approved");
      await add("reimbursed");
      expect(num((await summary(p)).reimbursement_cost)).toBe(1000);
      // The same spend was already entered as an expense and linked: it must not be counted again.
      const e = await expense(p, { category: cat["Transportation & Logistics"], rate: 500 });
      await add("approved", e);
      const s = await summary(p);
      expect(num(s.reimbursement_cost)).toBe(1000);
      expect(num(s.expense_cost)).toBe(500);
    });
  });
});

describe("budget vs actual and alerts", () => {
  it("reports utilisation and the 75% / 90% / over thresholds", async () => {
    await admin(async () => {
      const p = await project();
      const setBudget = (c: string, a: number) => q(`insert into project_budgets (project_id, category_id, amount) values ($1,$2,$3)`, [p, cat[c], a]);
      await setBudget("Manpower & Staffing", 1000);
      await setBudget("Fabrication & Production", 1000);
      await setBudget("Food & Beverages", 1000);
      await setBudget("Accommodation", 1000);
      await expense(p, { category: cat["Manpower & Staffing"], rate: 700 });
      await expense(p, { category: cat["Fabrication & Production"], rate: 800 });
      await expense(p, { category: cat["Food & Beverages"], rate: 950 });
      await expense(p, { category: cat["Miscellaneous"], rate: 50 }); // spend with no budget at all
      const rows = await q<{ category_name: string; alert: string; utilization_pct: string | null; remaining: string }>(
        `select category_name, alert, utilization_pct, remaining from budget_status where project_id=$1`, [p]);
      const by = Object.fromEntries(rows.map((r) => [r.category_name, r]));
      expect(by["Manpower & Staffing"].alert).toBe("ok");
      expect(by["Fabrication & Production"].alert).toBe("warning");
      expect(by["Food & Beverages"].alert).toBe("critical");
      expect(by["Accommodation"].alert).toBe("ok");
      expect(by["Miscellaneous"].alert).toBe("over");
      expect(num(by["Food & Beverages"].utilization_pct ?? "")).toBe(95);
      expect(num(by["Miscellaneous"].remaining)).toBe(-50);
      await expense(p, { category: cat["Manpower & Staffing"], rate: 400 });
      expect((await q<{ alert: string }>(`select alert from budget_status where project_id=$1 and category_id=$2`, [p, cat["Manpower & Staffing"]]))[0].alert).toBe("over");
    });
  });
});

describe("client revenue is linked, not copied", () => {
  it("sums issued invoices ex-GST and non-voided payments for a linked invoice", async () => {
    await admin(async () => {
      const p = await project("Revenue project");
      const [inv] = await q<{ id: string }>(`select public.save_invoice($1::jsonb) as id`, [JSON.stringify({
        client_company: "Aurora", subtotal: 10000, taxable_value: 10000, cgst: 900, sgst: 900, grand_total: 11800, due_date: "2099-01-01",
        items: [{ description: "Stage", qty: 1, rate: 10000, amount: 10000 }],
      })]);
      await q(`insert into project_invoices (project_id, invoice_id) values ($1,$2)`, [p, inv.id]);
      expect(num((await summary(p)).invoiced_total)).toBe(0); // drafts do not count
      const [row] = await q<{ updated_at: string }>(`select updated_at from invoices where id=$1`, [inv.id]);
      await q(`select public.issue_document('invoice', $1, '{}'::jsonb, $2::timestamptz)`, [inv.id, row.updated_at]);
      await q(`insert into invoice_payments (invoice_id, paid_on, amount) values ($1,'2026-11-20',5000)`, [inv.id]);
      await q(`insert into invoice_payments (invoice_id, paid_on, amount, voided_at, voided_reason) values ($1,'2026-11-21',100,now(),'bounced')`, [inv.id]);
      const s = await summary(p);
      expect([num(s.invoiced_ex_gst), num(s.gst_collected), num(s.invoiced_total), num(s.received)]).toEqual([10000, 1800, 11800, 5000]);
      await expect(q(`insert into project_invoices (project_id, invoice_id) values ($1,$2)`, [await project("Other"), inv.id])).rejects.toThrow(/duplicate/i);
    });
  });

  it("only counts approved additional charges and change orders", async () => {
    await admin(async () => {
      const p = await project();
      await q(`insert into project_revenue_items (project_id, kind, description, amount, approved) values
        ($1,'additional_charge','Extra LED',3000,true), ($1,'change_order','Stage upgrade',5000,true),
        ($1,'change_order','Pending one',9999,false), ($1,'change_order','Scope cut',-1000,true)`, [p]);
      const s = await summary(p);
      expect([num(s.additional_charges), num(s.change_orders)]).toEqual([3000, 4000]);
    });
  });
});

describe("soft delete, restore and audit", () => {
  it("lets accounts delete, hides deleted rows from totals, and lets only an admin restore", async () => {
    const p = await admin(() => project());
    const e = await admin(() => expense(p, { rate: 700 }));
    await as(ACCOUNTS, async () => {
      await q(`update expenses set deleted_at = now() where id=$1`, [e]);
      expect(num((await summary(p)).expense_cost)).toBe(0);
      await expect(q(`update expenses set deleted_at = null where id=$1`, [e])).rejects.toThrow(/NOT_AUTHORISED|RECORD_DELETED/);
      await expect(q(`delete from expenses where id=$1`, [e])).rejects.toThrow();
    });
    await admin(async () => {
      await q(`update expenses set deleted_at = null where id=$1`, [e]);
      expect(num((await summary(p)).expense_cost)).toBe(700);
    });
  });

  it("writes an audit row for every change, readable by admin but not by accounts", async () => {
    const p = await admin(() => project("Audited"));
    const e = await admin(() => expense(p, { rate: 100 }));
    await admin(() => q(`update expenses set rate = 200 where id=$1`, [e]));
    await admin(async () => {
      const rows = await q<{ action: string; actor: string }>(`select action, actor from finance_audit where table_name='expenses' and row_id=$1 order by id`, [e]);
      expect(rows.map((r) => r.action)).toEqual(["INSERT", "UPDATE"]);
      expect(rows[0].actor).toBe(ADMIN_ID);
    });
    await as(ACCOUNTS, async () => expect(await q(`select * from finance_audit`)).toHaveLength(0));
  });
});

describe("role-based access", () => {
  it("gives no access to team members without a finance role", async () => {
    const p = await admin(() => project("Hidden"));
    await as(PLAIN, async () => {
      expect(await q(`select * from projects`)).toHaveLength(0);
      expect(await q(`select * from expenses`)).toHaveLength(0);
      expect(await q(`select * from vendors`)).toHaveLength(0);
      await expect(expense(p)).rejects.toThrow();
    });
  });

  it("lets a project manager see only assigned projects, never revenue, and not approve their own expenses", async () => {
    const mine = await admin(() => project("PM project"));
    const other = await admin(() => project("Not mine"));
    await admin(async () => {
      await q(`insert into project_team (project_id, user_id) values ($1,$2)`, [mine, PM]);
      await q(`insert into project_revenue_items (project_id, kind, description, amount, approved) values ($1,'additional_charge','x',500,true)`, [mine]);
      await q(`insert into project_budgets (project_id, category_id, amount) values ($1,$2,1000)`, [mine, cat["Miscellaneous"]]);
    });
    await as(PM, async () => {
      expect((await q<{ name: string }>(`select name from projects`)).map((r) => r.name)).toEqual(["PM project"]);
      expect(await q(`select * from project_revenue_items`)).toHaveLength(0);
      expect(await q(`select * from project_budgets where project_id=$1`, [mine])).toHaveLength(1);
      const e = await expense(mine, { rate: 300 });
      expect((await q<{ approval_status: string }>(`select approval_status from expenses where id=$1`, [e]))[0].approval_status).toBe("submitted");
      await expect(q(`update expenses set approval_status='approved' where id=$1`, [e])).rejects.toThrow(/NOT_AUTHORISED/);
      await expect(expense(other)).rejects.toThrow();
      await expect(q(`insert into expense_payments (expense_id, paid_on, amount) values ($1,'2026-11-01',10)`, [e])).rejects.toThrow();
    });
  });

  it("keeps submitted expenses out of actuals and unpayable until accounts approve them", async () => {
    const p = await admin(() => project("Approval flow"));
    await admin(() => q(`insert into project_team (project_id, user_id) values ($1,$2)`, [p, OPS]));
    const e = await as(OPS, () => expense(p, { rate: 900 }));
    await admin(async () => {
      expect(num((await summary(p)).expense_cost)).toBe(0);
      await expect(q(`insert into expense_payments (expense_id, paid_on, amount) values ($1,'2026-11-01',100)`, [e])).rejects.toThrow(/EXPENSE_NOT_APPROVED/);
    });
    await as(ACCOUNTS, async () => {
      await q(`update expenses set approval_status='approved' where id=$1`, [e]);
      await q(`insert into expense_payments (expense_id, paid_on, amount) values ($1,'2026-11-01',100)`, [e]);
      expect(num((await summary(p)).expense_cost)).toBe(900);
    });
  });

  it("lets staff submit a reimbursement for themselves only, as 'submitted'", async () => {
    const p = await admin(() => project("Reimb"));
    await admin(() => q(`insert into project_team (project_id, user_id) values ($1,$2)`, [p, OPS]));
    await as(OPS, async () => {
      await q(`insert into reimbursements (person_name, project_id, description, category_id, amount) values ('Ops',$1,'Taxi',$2,200)`, [p, cat["Transportation & Logistics"]]);
      await expect(q(`insert into reimbursements (person_name, project_id, description, category_id, amount, status) values ('Ops',$1,'x',$2,200,'approved')`, [p, cat["Miscellaneous"]])).rejects.toThrow();
      await expect(q(`insert into reimbursements (person_id, person_name, project_id, description, category_id, amount) values ($3,'Other',$1,'x',$2,200)`, [p, cat["Miscellaneous"], ACCOUNTS])).rejects.toThrow();
      await expect(q(`update reimbursements set status='approved'`)).resolves.toBeDefined(); // RLS filters: updates 0 rows
      expect((await q<{ status: string }>(`select status from reimbursements`)).every((r) => r.status === "submitted")).toBe(true);
    });
  });
});

describe("dashboard helpers", () => {
  it("returns monthly revenue/cost and per-category totals", async () => {
    await admin(async () => {
      const p = await project("Trend", { start_date: "2031-03-05" });
      await q(`insert into expenses (project_id, category_id, description, rate, expense_date) values ($1,$2,'a',1000,'2031-03-10'), ($1,$2,'b',500,'2031-04-02')`, [p, cat["Sound & Lighting"]]);
      const m = await q<{ month: string; cost: string }>(`select month::text, cost from finance_monthly('2031-01-01','2031-12-31', $1)`, [p]);
      expect(m.map((r) => [r.month, num(r.cost)])).toEqual([["2031-03-01", 1000], ["2031-04-01", 500]]);
      const c = await q<{ category_name: string; amount: string }>(`select category_name, amount from finance_category_totals(null, null, $1)`, [p]);
      expect(c).toEqual([{ category_name: "Sound & Lighting", amount: "1500.00" }]);
    });
  });
});
