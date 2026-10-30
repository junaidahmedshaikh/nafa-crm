import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, createDb, ADMIN_ID, INACTIVE_ID, OUTSIDER_ID } from "./helpers";
import { invoicePaymentStatus } from "@/lib/documents/calc";

let db: PGlite;
beforeAll(async () => {
  db = await createDb();
});

const q = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => db.query<T>(sql, params).then((r) => r.rows);
const as = <T>(fn: () => Promise<T>) => asUser(db, ADMIN_ID, fn);

const item = (over: Record<string, unknown> = {}) => ({ description: "Stage", qty: 1, rate: 1000, amount: 1000, ...over });
const quotationPayload = (over: Record<string, unknown> = {}) => ({
  client_name: "Asha", client_company: "Aurora Motors", grand_total: 1180, subtotal: 1000, taxable_value: 1000, cgst: 90, sgst: 90,
  config: { tax: { mode: "cgst_sgst", rate: 18 } },
  items: [item(), item({ description: "Staff", qty: 2.5, rate: 100, amount: 250 })],
  milestones: [{ label: "Advance", kind: "percent", value: 50, due_text: "On confirmation", amount: 590 }, { label: "Balance", kind: "percent", value: 50, due_text: "", amount: 590 }],
  terms: ["Valid 7 days"],
  ...over,
});

async function newQuotation(over: Record<string, unknown> = {}): Promise<string> {
  const [r] = await q<{ id: string }>(`select public.save_quotation($1::jsonb) as id`, [JSON.stringify(quotationPayload(over))]);
  return r.id;
}
async function issueQuotation(id: string) {
  const [row] = await q<{ updated_at: string }>(`select updated_at from quotations where id=$1`, [id]);
  const [r] = await q<{ n: string }>(`select public.issue_document('quotation', $1, '{"snap":true}'::jsonb, $2::timestamptz) as n`, [id, row.updated_at]);
  return r.n;
}
async function newInvoice(over: Record<string, unknown> = {}) {
  const [r] = await q<{ id: string }>(`select public.save_invoice($1::jsonb) as id`, [
    JSON.stringify({ client_company: "Aurora", grand_total: 1000, subtotal: 1000, taxable_value: 1000, due_date: "2099-01-01", items: [item()], ...over }),
  ]);
  return r.id;
}
async function issueInvoice(id: string) {
  const [row] = await q<{ updated_at: string }>(`select updated_at from invoices where id=$1`, [id]);
  const [r] = await q<{ n: string }>(`select public.issue_document('invoice', $1, '{}'::jsonb, $2::timestamptz) as n`, [id, row.updated_at]);
  return r.n;
}

describe("quotations: save, number allocation and locking", () => {
  it("saves header, items and milestones atomically and keeps drafts un-numbered", async () => {
    await as(async () => {
      const id = await newQuotation();
      const [row] = await q<{ number: string | null; status: string }>(`select number, status from quotations where id=$1`, [id]);
      expect(row).toEqual({ number: null, status: "draft" });
      expect(await q(`select * from quotation_items where quotation_id=$1`, [id])).toHaveLength(2);
      expect(await q(`select * from quotation_milestones where quotation_id=$1`, [id])).toHaveLength(2);
      // update replaces children
      await q(`select public.save_quotation($1::jsonb)`, [JSON.stringify(quotationPayload({ id, items: [item()] }))]);
      expect(await q(`select * from quotation_items where quotation_id=$1`, [id])).toHaveLength(1);
    });
  });

  it("rolls the whole save back when one item is invalid", async () => {
    await as(async () => {
      const before = (await q<{ n: number }>(`select count(*)::int n from quotations`))[0].n;
      await expect(newQuotation({ items: [item(), item({ qty: 0 })] })).rejects.toThrow(/check/i);
      expect((await q<{ n: number }>(`select count(*)::int n from quotations`))[0].n).toBe(before);
    });
  });

  it("allocates sequential, formatted numbers only when issued and assigns -V02 suffix for revisions without advancing sequence", async () => {
    await as(async () => {
      const q1Id = await newQuotation();
      const a = await issueQuotation(q1Id);
      expect(a).toMatch(/^NAFA-QUO-26-\d{3}$/);

      // Revision of q1
      const revId = await newQuotation({ revision_of: q1Id });
      const revNum = await issueQuotation(revId);
      expect(revNum).toBe(`${a}-V02`);

      // Revision of rev1
      const rev2Id = await newQuotation({ revision_of: revId });
      const rev2Num = await issueQuotation(rev2Id);
      expect(rev2Num).toBe(`${a}-V03`);

      // Brand new quotation should receive the NEXT sequential number
      const q2Id = await newQuotation();
      const b = await issueQuotation(q2Id);
      expect(b).toMatch(/^NAFA-QUO-26-\d{3}$/);
      const n = (s: string) => Number(s.split("-").pop());
      expect(n(b)).toBe(n(a) + 1);
    });
  });

  it("never issues duplicate numbers for simultaneous requests", async () => {
    await as(async () => {
      const ids = await Promise.all(Array.from({ length: 8 }, () => newQuotation()));
      const numbers = await Promise.all(ids.map((id) => issueQuotation(id)));
      expect(new Set(numbers).size).toBe(8);
      const sorted = numbers.map((s) => Number(s.split("-").pop())).sort((x, y) => x - y);
      expect(sorted[7] - sorted[0]).toBe(7);
    });
  });

  it("does not reuse a number after the document is gone, and refuses to wind the counter back", async () => {
    await as(async () => {
      const [first] = await q<{ next_number: number }>(`select next_number from document_sequences where doc_type='quotation'`);
      const id = await newQuotation();
      const num = await issueQuotation(id);
      expect(Number(num.split("-").pop())).toBe(first.next_number);
      const [after] = await q<{ next_number: number }>(`select next_number from document_sequences where doc_type='quotation'`);
      expect(after.next_number).toBe(first.next_number + 1);
      await expect(q(`update document_sequences set next_number = 1 where doc_type='quotation'`)).rejects.toThrow(/SEQUENCE_CANNOT_DECREASE/);
    });
  });

  it("blocks manual numbering, double issue and stale issue", async () => {
    await as(async () => {
      const id = await newQuotation();
      await expect(q(`update quotations set number='FAKE-1', status='sent' where id=$1`, [id])).rejects.toThrow(/NUMBER_ASSIGNED_BY_SYSTEM/);
      await expect(q(`update quotations set status='sent' where id=$1`, [id])).rejects.toThrow(/ISSUE_THROUGH_FUNCTION_ONLY|quotations_number_when_issued/);
      await expect(q(`insert into quotations (number) values ('FAKE-2')`)).rejects.toThrow(/NUMBER_ASSIGNED_BY_SYSTEM/);
      await expect(q(`select public.issue_document('quotation', $1, '{}'::jsonb, '2000-01-01'::timestamptz)`, [id])).rejects.toThrow(/STALE/);
      await issueQuotation(id);
      await expect(q(`select public.issue_document('quotation', $1, '{}'::jsonb, now())`, [id])).rejects.toThrow(/ALREADY_ISSUED/);
    });
  });

  it("freezes an issued quotation and its items, but allows controlled status changes", async () => {
    await as(async () => {
      const id = await newQuotation();
      await issueQuotation(id);
      await expect(q(`update quotations set client_name='Hacked' where id=$1`, [id])).rejects.toThrow(/DOCUMENT_LOCKED/);
      await expect(q(`update quotations set grand_total=1 where id=$1`, [id])).rejects.toThrow(/DOCUMENT_LOCKED/);
      await expect(q(`update quotations set number='X' where id=$1`, [id])).rejects.toThrow(/NUMBER_IMMUTABLE/);
      await expect(q(`update quotation_items set rate=1 where quotation_id=$1`, [id])).rejects.toThrow(/DOCUMENT_LOCKED/);
      await expect(q(`insert into quotation_items (quotation_id, position, description, qty, rate) values ($1,9,'x',1,1)`, [id])).rejects.toThrow(/DOCUMENT_LOCKED/);
      await expect(q(`delete from quotation_items where quotation_id=$1`, [id])).rejects.toThrow(/DOCUMENT_LOCKED/);
      await expect(q(`delete from quotations where id=$1`, [id])).resolves.toBeDefined(); // RLS: 0 rows, not allowed
      expect(await q(`select 1 from quotations where id=$1`, [id])).toHaveLength(1);
      await expect(q(`select public.save_quotation($1::jsonb)`, [JSON.stringify(quotationPayload({ id }))])).rejects.toThrow(/NOT_EDITABLE/);
      // milestone payment status remains updatable
      await q(`update quotation_milestones set status='paid' where quotation_id=$1 and position=0`, [id]);
      await expect(q(`update quotation_milestones set value=1 where quotation_id=$1`, [id])).rejects.toThrow(/DOCUMENT_LOCKED/);

      await q(`update quotations set status='accepted' where id=$1`, [id]);
      const [row] = await q<{ accepted_at: string | null }>(`select accepted_at from quotations where id=$1`, [id]);
      expect(row.accepted_at).not.toBeNull();
      await expect(q(`update quotations set status='draft' where id=$1`, [id])).rejects.toThrow(/INVALID_TRANSITION/);
      await expect(q(`update quotations set status='rejected' where id=$1`, [id])).rejects.toThrow(/INVALID_TRANSITION/);
    });
  });

  it("derives 'expired' for sent quotations past their valid-until date", async () => {
    await as(async () => {
      const id = await newQuotation({ valid_until: "2000-01-01" });
      await issueQuotation(id);
      const [r] = await q<{ effective_status: string }>(`select effective_status from quotation_list where id=$1`, [id]);
      expect(r.effective_status).toBe("expired");
    });
  });

  it("records an activity trail", async () => {
    await as(async () => {
      const id = await newQuotation();
      await issueQuotation(id);
      await q(`update quotations set status='rejected' where id=$1`, [id]);
      const acts = (await q<{ action: string }>(`select action from document_activity where doc_type='quotation' and doc_id=$1`, [id])).map((a) => a.action);
      expect(acts).toEqual(expect.arrayContaining(["created", "issued", "rejected"]));
    });
  });

  it("catalogue price changes never touch saved documents", async () => {
    await as(async () => {
      const [p] = await q<{ id: string }>(`insert into products_services (name, default_rate) values ('Hostess', 2000) returning id`);
      const id = await newQuotation({ items: [item({ description: "Hostess", rate: 2000, amount: 2000, catalogue_id: p.id })] });
      await issueQuotation(id);
      await q(`update products_services set default_rate = 9999, name = 'Renamed' where id=$1`, [p.id]);
      const [row] = await q<{ rate: string; description: string }>(`select rate, description from quotation_items where quotation_id=$1`, [id]);
      expect(Number(row.rate)).toBe(2000);
      expect(row.description).toBe("Hostess");
      const [snap] = await q<{ snapshot: { snap: boolean } }>(`select snapshot from quotations where id=$1`, [id]);
      expect(snap.snapshot.snap).toBe(true);
    });
  });
});

describe("quotation → invoice conversion", () => {
  it("only converts accepted quotations, copies the lines and blocks accidental duplicates", async () => {
    await as(async () => {
      const id = await newQuotation({ valid_until: "2099-01-01" });
      await expect(q(`select public.convert_quotation_to_invoice($1)`, [id])).rejects.toThrow(/QUOTATION_NOT_ACCEPTED/);
      const number = await issueQuotation(id);
      await expect(q(`select public.convert_quotation_to_invoice($1)`, [id])).rejects.toThrow(/QUOTATION_NOT_ACCEPTED/);
      await q(`update quotations set status='accepted' where id=$1`, [id]);

      const [{ convert_quotation_to_invoice: invId }] = await q<{ convert_quotation_to_invoice: string }>(`select public.convert_quotation_to_invoice($1)`, [id]);
      const [inv] = await q<Record<string, unknown>>(`select * from invoices where id=$1`, [invId]);
      expect(inv).toMatchObject({ state: "draft", number: null, quotation_id: id, quotation_number: number, client_company: "Aurora Motors" });
      expect(Number(inv.grand_total)).toBe(1180);
      const items = await q<{ description: string; qty: string; rate: string }>(`select description, qty, rate from invoice_items where invoice_id=$1 order by position`, [invId]);
      expect(items.map((i) => i.description)).toEqual(["Stage", "Staff"]);
      expect(Number(items[1].qty)).toBe(2.5);

      await expect(q(`select public.convert_quotation_to_invoice($1)`, [id])).rejects.toThrow(/ALREADY_CONVERTED/);
      const [{ convert_quotation_to_invoice: second }] = await q<{ convert_quotation_to_invoice: string }>(`select public.convert_quotation_to_invoice($1, true)`, [id]);
      expect(second).not.toBe(invId);
      expect((await q<{ invoice_count: number }>(`select invoice_count from quotation_list where id=$1`, [id]))[0].invoice_count).toBe(2);
    });
  });

  it("allows a fresh conversion once the earlier invoice has been cancelled", async () => {
    await as(async () => {
      const id = await newQuotation();
      await issueQuotation(id);
      await q(`update quotations set status='accepted' where id=$1`, [id]);
      const [{ convert_quotation_to_invoice: invId }] = await q<{ convert_quotation_to_invoice: string }>(`select public.convert_quotation_to_invoice($1)`, [id]);
      await issueInvoice(invId);
      await q(`update invoices set state='cancelled', cancel_reason='Issued in error' where id=$1`, [invId]);
      await expect(q(`select public.convert_quotation_to_invoice($1)`, [id])).resolves.toBeDefined();
    });
  });
});

describe("invoices and payments", () => {
  it("blocks payments on drafts and cancelled invoices, and over-payment", async () => {
    await as(async () => {
      const id = await newInvoice();
      await expect(q(`insert into invoice_payments (invoice_id, paid_on, amount) values ($1,'2026-11-01',100)`, [id])).rejects.toThrow(/INVOICE_NOT_PAYABLE/);
      await issueInvoice(id);
      await q(`insert into invoice_payments (invoice_id, paid_on, amount, method, reference) values ($1,'2026-11-01',400,'upi','UPI123')`, [id]);
      await expect(q(`insert into invoice_payments (invoice_id, paid_on, amount) values ($1,'2026-11-02',700)`, [id])).rejects.toThrow(/PAYMENT_EXCEEDS_BALANCE/);
      await expect(q(`insert into invoice_payments (invoice_id, paid_on, amount) values ($1,'2026-11-02',0)`, [id])).rejects.toThrow(/check/i);
    });
  });

  it("derives payment status and balance in the view, matching the TypeScript rules", async () => {
    await as(async () => {
      const today = (await q<{ d: string }>(`select (now() at time zone 'Asia/Kolkata')::date::text as d`))[0].d;
      const cases: { due: string | null; pay: number[]; expect: string }[] = [
        { due: "2099-01-01", pay: [], expect: "issued" },
        { due: "2099-01-01", pay: [250], expect: "partially_paid" },
        { due: "2099-01-01", pay: [250, 750], expect: "paid" },
        { due: "2000-01-01", pay: [], expect: "overdue" },
        { due: "2000-01-01", pay: [300], expect: "overdue" },
        { due: "2000-01-01", pay: [1000], expect: "paid" },
        { due: null, pay: [100], expect: "partially_paid" },
      ];
      for (const c of cases) {
        const id = await newInvoice({ due_date: c.due });
        await issueInvoice(id);
        for (const amount of c.pay) await q(`insert into invoice_payments (invoice_id, paid_on, amount) values ($1,'2026-11-01',$2)`, [id, amount]);
        const [row] = await q<{ payment_status: string; amount_received: string; balance_due: string }>(`select payment_status, amount_received, balance_due from invoice_list where id=$1`, [id]);
        const received = c.pay.reduce((a, b) => a + b, 0);
        expect(row.payment_status, JSON.stringify(c)).toBe(c.expect);
        expect(Number(row.amount_received)).toBe(received);
        expect(Number(row.balance_due)).toBe(1000 - received);
        expect(invoicePaymentStatus({ state: "issued", total: 1000, received, dueDate: c.due, today })).toBe(c.expect);
      }
      const draft = await newInvoice();
      expect((await q<{ payment_status: string }>(`select payment_status from invoice_list where id=$1`, [draft]))[0].payment_status).toBe("draft");
    });
  });

  it("voiding restores the balance; payments cannot be edited; cancelling needs a reason and no live payments", async () => {
    await as(async () => {
      const id = await newInvoice();
      await issueInvoice(id);
      const [pay] = await q<{ id: string }>(`insert into invoice_payments (invoice_id, paid_on, amount) values ($1,'2026-11-01',1000) returning id`, [id]);
      expect((await q<{ payment_status: string }>(`select payment_status from invoice_list where id=$1`, [id]))[0].payment_status).toBe("paid");
      await expect(q(`update invoice_payments set amount=1 where id=$1`, [pay.id])).rejects.toThrow(/permission denied|PAYMENT_IMMUTABLE/);
      await expect(q(`delete from invoice_payments where id=$1`, [pay.id])).rejects.toThrow(/permission denied/);
      await expect(q(`update invoices set state='cancelled', cancel_reason='x' where id=$1`, [id])).rejects.toThrow(/HAS_PAYMENTS/);
      await expect(q(`update invoice_payments set voided_at=now() where id=$1`, [pay.id])).rejects.toThrow(/invoice_payments_void_reason/);
      await q(`update invoice_payments set voided_at=now(), voided_reason='Cheque bounced' where id=$1`, [pay.id]);
      expect((await q<{ payment_status: string; balance_due: string }>(`select payment_status, balance_due from invoice_list where id=$1`, [id]))[0]).toMatchObject({ payment_status: "issued", balance_due: "1000.00" });
      await expect(q(`update invoices set state='cancelled' where id=$1`, [id])).rejects.toThrow(/invoices_cancel_reason/);
      await q(`update invoices set state='cancelled', cancel_reason='Wrong client' where id=$1`, [id]);
      await expect(q(`update invoices set state='issued' where id=$1`, [id])).rejects.toThrow(/INVALID_TRANSITION/);
    });
  });

  it("freezes an issued invoice and logs payments in the activity history", async () => {
    await as(async () => {
      const id = await newInvoice();
      const number = await issueInvoice(id);
      expect(number).toMatch(/^NAFA-INV-26-\d{3}$/);
      await expect(q(`update invoices set grand_total=5 where id=$1`, [id])).rejects.toThrow(/DOCUMENT_LOCKED/);
      await expect(q(`update invoice_items set rate=1 where invoice_id=$1`, [id])).rejects.toThrow(/DOCUMENT_LOCKED/);
      await q(`insert into invoice_payments (invoice_id, paid_on, amount) values ($1,'2026-11-01',100)`, [id]);
      const acts = (await q<{ action: string }>(`select action from document_activity where doc_type='invoice' and doc_id=$1`, [id])).map((a) => a.action);
      expect(acts).toEqual(expect.arrayContaining(["created", "issued", "payment_recorded"]));
    });
  });
});

describe("proposals", () => {
  it("saves sections, keeps attachments linked, and locks after issue", async () => {
    await as(async () => {
      const [{ id }] = await q<{ id: string }>(`select public.save_proposal($1::jsonb) as id`, [
        JSON.stringify({ title: "Launch", client_company: "Aurora", commercial_mode: "manual", sections: [
          { type: "cover", title: "Cover", body: "Hi" }, { type: "scope", title: "Scope", body: "- a\n- b" } ] }),
      ]);
      const [sec] = await q<{ id: string }>(`select id from proposal_sections where proposal_id=$1 and position=1`, [id]);
      await q(`insert into proposal_attachments (proposal_id, section_id, filename, content_type, size_bytes, data_uri) values ($1,$2,'a.png','image/png',10,'data:image/png;base64,AA==')`, [id, sec.id]);
      // re-save with the same section ids: attachment must follow its section
      await q(`select public.save_proposal($1::jsonb)`, [JSON.stringify({ id, title: "Launch v2", sections: [{ id: sec.id, type: "scope", title: "Scope", body: "x" }],
        attachment_sections: [{ attachment_id: (await q<{ id: string }>(`select id from proposal_attachments where proposal_id=$1`, [id]))[0].id, section_id: sec.id }] })]);
      expect((await q<{ section_id: string }>(`select section_id from proposal_attachments where proposal_id=$1`, [id]))[0].section_id).toBe(sec.id);

      const [row] = await q<{ updated_at: string }>(`select updated_at from proposals where id=$1`, [id]);
      const [{ n }] = await q<{ n: string }>(`select public.issue_document('proposal', $1, '{}'::jsonb, $2::timestamptz) as n`, [id, row.updated_at]);
      expect(n).toMatch(/^NAFA-PROP-26-\d{3}$/);
      await expect(q(`update proposals set title='Hack' where id=$1`, [id])).rejects.toThrow(/DOCUMENT_LOCKED/);
      await expect(q(`update proposal_sections set body='Hack' where proposal_id=$1`, [id])).rejects.toThrow(/DOCUMENT_LOCKED/);
      await expect(q(`insert into proposals (commercial_mode) values ('linked')`)).rejects.toThrow(/proposals_linked_needs_quotation/);
    });
  });
});

describe("authorisation (RLS) for document tables", () => {
  const tables = ["quotations", "quotation_items", "invoices", "invoice_items", "invoice_payments", "proposals", "proposal_sections", "products_services",
    "document_settings", "document_sequences", "document_activity", "document_emails", "quotation_list", "invoice_list", "proposal_list", "payment_list"];

  it("hides everything from anon, profile-less and deactivated users", async () => {
    await as(async () => {
      const id = await newQuotation();
      await issueQuotation(id);
    });
    for (const t of tables) {
      await asUser(db, null, async () => {
        await expect(q(`select * from ${t}`), `anon ${t}`).rejects.toThrow(/permission denied/i);
      });
      for (const uid of [OUTSIDER_ID, INACTIVE_ID]) {
        await asUser(db, uid, async () => {
          expect(await q(`select * from ${t}`), `${uid} ${t}`).toHaveLength(0);
        });
      }
    }
  });

  it("stops outsiders writing, issuing, converting or allocating numbers", async () => {
    await asUser(db, OUTSIDER_ID, async () => {
      await expect(q(`select public.save_quotation('{"client_name":"x"}'::jsonb)`)).rejects.toThrow(/row-level security/i);
      await expect(q(`insert into products_services (name) values ('x')`)).rejects.toThrow(/row-level security/i);
      await expect(q(`select public.issue_document('quotation', gen_random_uuid(), '{}'::jsonb, now())`)).rejects.toThrow(/NOT_AUTHORISED/);
      await expect(q(`select public.next_document_number('quotation')`)).rejects.toThrow(/permission denied/i);
    });
    await asUser(db, null, async () => {
      await expect(q(`select public.save_quotation('{}'::jsonb)`)).rejects.toThrow(/permission denied/i);
    });
  });

  it("limits document settings (which hold bank details) and numbering config to admins for writes", async () => {
    await as(async () => {
      await q(`update document_settings set bank_name='Federal Bank'`);
      await q(`update document_sequences set prefix='NAFA-QT-' where doc_type='quotation'`);
      await q(`update document_sequences set prefix='NAFA-QUO-26-' where doc_type='quotation'`);
    });
    // a deactivated former admin-like member sees nothing and cannot write
    await asUser(db, INACTIVE_ID, async () => {
      expect(await q(`select * from document_settings`)).toHaveLength(0);
      await q(`update document_settings set bank_name='Evil'`);
    });
    expect((await q<{ bank_name: string }>(`select bank_name from document_settings`))[0].bank_name).toBe("Federal Bank");
  });

  it("keeps the activity log and email log append-only", async () => {
    await as(async () => {
      await expect(q(`update document_activity set summary='x'`)).rejects.toThrow(/permission denied/i);
      await expect(q(`delete from document_activity`)).rejects.toThrow(/permission denied/i);
      await expect(q(`update document_emails set status='sent'`)).rejects.toThrow(/permission denied/i);
    });
  });
});
