import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { ADMIN_ID, OUTSIDER_ID, asUser, createDb } from "./helpers";

const MEMBER = "00000000-0000-0000-0000-0000000000f3";
let db: PGlite;
let campaign: string;
beforeAll(async () => {
  db = await createDb();
  await db.exec(`insert into auth.users (id, email) values ('${MEMBER}','m@x'); insert into public.profiles (id, full_name, role) values ('${MEMBER}','Member','member');`);
  campaign = (await asUser(db, MEMBER, () => q<{ id: string }>(`insert into email_campaigns (name) values ('C1') returning id`)))[0].id;
});
const q = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => db.query<T>(sql, params).then((r) => r.rows);
const addRecipient = (email: string, status = "pending") =>
  q<{ unsubscribe_token: string; id: string }>(`insert into email_recipients (campaign_id, email, email_normalized, full_name, status) values ($1, $2, lower($2), 'N', $3) returning id, unsubscribe_token`, [campaign, email, status]);

describe("email marketing schema", () => {
  it("starts with no templates and lets members manage their own", async () => {
    expect(await q(`select id from email_templates`)).toHaveLength(0);
    await asUser(db, MEMBER, () => q(`insert into email_templates (name, subject, body_html) values ('Mine', 's', '<p>b</p>')`));
    await asUser(db, MEMBER, () => q(`delete from email_templates where name = 'Mine'`));
    expect(await q(`select id from email_templates`)).toHaveLength(0);
  });

  it("never allows the same address twice in one campaign", async () => {
    await asUser(db, MEMBER, () => addRecipient("dup@x.com"));
    await expect(asUser(db, MEMBER, () => addRecipient("DUP@x.com"))).rejects.toThrow(/unique|duplicate/i);
  });

  it("only an administrator can activate a campaign, and content is frozen afterwards", async () => {
    await expect(asUser(db, MEMBER, () => q(`update email_campaigns set status = 'scheduled' where id = $1`, [campaign]))).rejects.toThrow(/ADMIN_APPROVAL_REQUIRED/);
    await asUser(db, ADMIN_ID, () => q(`update email_campaigns set status = 'scheduled' where id = $1`, [campaign]));
    await expect(asUser(db, ADMIN_ID, () => q(`update email_campaigns set subject = 'changed' where id = $1`, [campaign]))).rejects.toThrow(/CAMPAIGN_LOCKED/);
    await asUser(db, MEMBER, () => q(`update email_campaigns set status = 'paused' where id = $1`, [campaign])); // anyone may pause
    await asUser(db, MEMBER, () => q(`update email_campaigns set status = 'draft' where id = $1`, [campaign]));
  });

  it("claims each queued recipient exactly once and respects the limit", async () => {
    for (const e of ["c1@x.com", "c2@x.com", "c3@x.com"]) await addRecipient(e);
    const first = await asUser(db, ADMIN_ID, () => q<{ email: string }>(`select * from claim_email_recipients($1, 2)`, [campaign]));
    const second = await asUser(db, ADMIN_ID, () => q<{ email: string }>(`select * from claim_email_recipients($1, 10)`, [campaign]));
    expect(first).toHaveLength(2);
    const all = [...first, ...second].map((r) => r.email);
    expect(new Set(all).size).toBe(all.length); // nobody claimed twice
    await expect(asUser(db, MEMBER, () => q(`select * from claim_email_recipients($1, 1)`, [campaign]))).rejects.toThrow(/NOT_AUTHORISED/);
    await expect(asUser(db, null, () => q(`select * from claim_email_recipients($1, 1)`, [campaign]))).rejects.toThrow();
  });

  it("unsubscribing by token suppresses the address, cancels queued mail and flags the contact", async () => {
    await db.exec(`insert into contacts (full_name, email) values ('Una', 'una@x.com')`);
    const [r] = await asUser(db, MEMBER, () => addRecipient("una@x.com"));
    const res = await asUser(db, null, () => q<{ unsubscribe_by_token: string }>(`select unsubscribe_by_token($1)`, [r.unsubscribe_token]));
    expect(res[0].unsubscribe_by_token).toBe("ok");
    expect(await q(`select 1 from email_suppressions where email_normalized = 'una@x.com'`)).toHaveLength(1);
    expect((await q<{ status: string; skip_reason: string }>(`select status, skip_reason from email_recipients where id = $1`, [r.id]))[0]).toMatchObject({ status: "skipped", skip_reason: "unsubscribed" });
    expect((await q<{ email_status: string }>(`select email_status from contacts where email = 'una@x.com'`))[0].email_status).toBe("unsubscribed");
    const bad = await asUser(db, null, () => q<{ unsubscribe_by_token: string }>(`select unsubscribe_by_token('00000000-0000-0000-0000-000000000000')`));
    expect(bad[0].unsubscribe_by_token).toBe("invalid");
  });

  it("limits settings changes to admins and hides data from outsiders", async () => {
    await asUser(db, MEMBER, () => q(`update email_settings set daily_limit = 5000`));
    expect((await q<{ daily_limit: number }>(`select daily_limit from email_settings`))[0].daily_limit).toBe(50);
    await asUser(db, ADMIN_ID, () => q(`update email_settings set daily_limit = 120`));
    expect((await q<{ daily_limit: number }>(`select daily_limit from email_settings`))[0].daily_limit).toBe(120);
    expect(await asUser(db, OUTSIDER_ID, () => q(`select * from email_campaigns`))).toHaveLength(0);
    expect(await asUser(db, OUTSIDER_ID, () => q(`select * from email_suppressions`))).toHaveLength(0);
  });
});

describe("phase 4 schema", () => {
  it("allows the same address once per follow-up step but never twice in the same step", async () => {
    const c = (await q<{ id: string }>(`insert into email_campaigns (name) values ('P4') returning id`))[0].id;
    const ins = (step: number) => q(`insert into email_recipients (campaign_id, email, email_normalized, full_name, step) values ($1, 'a@x.com', 'a@x.com', 'A', $2)`, [c, step]);
    await ins(0); await ins(1);
    await expect(ins(1)).rejects.toThrow(/unique|duplicate/i);
  });

  it("freezes follow-up steps and versions once the campaign leaves draft", async () => {
    const c = (await q<{ id: string }>(`insert into email_campaigns (name) values ('P4b') returning id`))[0].id;
    await asUser(db, MEMBER, () => q(`insert into email_sequence_steps (campaign_id, step, delay_days, body_html) values ($1, 1, 4, '<p>x</p>')`, [c]));
    await asUser(db, ADMIN_ID, () => q(`update email_campaigns set status = 'scheduled' where id = $1`, [c]));
    await expect(asUser(db, MEMBER, () => q(`insert into email_sequence_steps (campaign_id, step, delay_days, body_html) values ($1, 2, 4, '<p>y</p>')`, [c]))).rejects.toThrow();
    await expect(asUser(db, MEMBER, () => q(`insert into email_campaign_variants (campaign_id, label, subject, body_html) values ($1, 'B', 's', 'b')`, [c]))).rejects.toThrow();
  });

  it("stores replies for team members only and de-duplicates provider messages", async () => {
    const ins = (id: string) => q(`insert into email_replies (from_email, from_normalized, provider_message_id, source) values ('a@x.com', 'a@x.com', $1, 'gmail')`, [id]);
    await asUser(db, MEMBER, () => ins("m1"));
    await expect(asUser(db, MEMBER, () => ins("m1"))).rejects.toThrow(/unique|duplicate/i);
    await expect(asUser(db, OUTSIDER_ID, () => ins("m2"))).rejects.toThrow();
    expect(await asUser(db, OUTSIDER_ID, () => q(`select * from email_replies`))).toHaveLength(0);
  });

  it("keeps provider events read-only for users", async () => {
    await expect(asUser(db, ADMIN_ID, () => q(`insert into email_events (type) values ('delivered')`))).rejects.toThrow();
  });
});

describe("push subscriptions", () => {
  const sub = (user: string, endpoint: string) => q(`insert into push_subscriptions (user_id, endpoint, p256dh, auth) values ($1, $2, 'k', 'a')`, [user, endpoint]);
  it("lets a person register and see only their own devices", async () => {
    await asUser(db, MEMBER, () => sub(MEMBER, "https://push.example/m1"));
    await asUser(db, ADMIN_ID, () => sub(ADMIN_ID, "https://push.example/a1"));
    expect(await asUser(db, MEMBER, () => q(`select endpoint from push_subscriptions`))).toHaveLength(1);
    expect(await asUser(db, ADMIN_ID, () => q(`select endpoint from push_subscriptions`))).toHaveLength(1);
  });
  it("blocks registering for someone else, outsiders, and deleting another person's device", async () => {
    await expect(asUser(db, MEMBER, () => sub(ADMIN_ID, "https://push.example/x"))).rejects.toThrow();
    await expect(asUser(db, OUTSIDER_ID, () => sub(OUTSIDER_ID, "https://push.example/o"))).rejects.toThrow();
    await asUser(db, MEMBER, () => q(`delete from push_subscriptions where endpoint = 'https://push.example/a1'`));
    expect(await q(`select 1 from push_subscriptions where endpoint = 'https://push.example/a1'`)).toHaveLength(1);
  });
});

describe("recipient groups schema", () => {
  const contact = async (email: string) => (await q<{ id: string }>(`insert into contacts (full_name, email) values ('C', $1) returning id`, [email]))[0].id;
  it("keeps one group assignment per contact and group, and group names unique", async () => {
    const g = (await asUser(db, MEMBER, () => q<{ id: string }>(`insert into recipient_groups (name) values ('Wedding Planners') returning id`)))[0].id;
    await expect(asUser(db, MEMBER, () => q(`insert into recipient_groups (name) values ('  wedding planners ')`))).rejects.toThrow(/unique|duplicate/i);
    const c = await contact("g1@x.com");
    await asUser(db, MEMBER, () => q(`insert into contact_recipient_groups (contact_id, group_id) values ($1, $2)`, [c, g]));
    await expect(asUser(db, MEMBER, () => q(`insert into contact_recipient_groups (contact_id, group_id) values ($1, $2)`, [c, g]))).rejects.toThrow(/unique|duplicate/i);
  });
  it("deleting a group removes assignments but never the contacts; only admins may delete", async () => {
    const g = (await q<{ id: string }>(`insert into recipient_groups (name) values ('Temp') returning id`))[0].id;
    const c = await contact("g2@x.com");
    await q(`insert into contact_recipient_groups (contact_id, group_id) values ($1, $2)`, [c, g]);
    await asUser(db, MEMBER, () => q(`delete from recipient_groups where id = $1`, [g]));
    expect(await q(`select 1 from recipient_groups where id = $1`, [g])).toHaveLength(1);       // member cannot delete
    await asUser(db, ADMIN_ID, () => q(`delete from recipient_groups where id = $1`, [g]));
    expect(await q(`select 1 from contact_recipient_groups where group_id = $1`, [g])).toHaveLength(0);
    expect(await q(`select 1 from contacts where id = $1`, [c])).toHaveLength(1);
  });
  it("blocks outsiders and keeps an audit trail", async () => {
    await expect(asUser(db, OUTSIDER_ID, () => q(`insert into recipient_groups (name) values ('Nope')`))).rejects.toThrow();
    await asUser(db, MEMBER, () => q(`insert into recipient_group_audit (action, details) values ('assign', '{"contacts": 3}')`));
    expect((await asUser(db, MEMBER, () => q(`select action from recipient_group_audit`))).length).toBeGreaterThan(0);
    expect(await asUser(db, OUTSIDER_ID, () => q(`select * from recipient_group_audit`))).toHaveLength(0);
  });
});
