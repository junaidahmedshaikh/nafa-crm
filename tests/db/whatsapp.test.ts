import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { ADMIN_ID, OUTSIDER_ID, asUser, createDb } from "./helpers";

const MEMBER = "00000000-0000-0000-0000-0000000000f2";
let db: PGlite;
let contactA: string;
let contactB: string;
let contactC: string;
let templateId: string;
let campaignId: string;

beforeAll(async () => {
  db = await createDb();
  await db.exec(`insert into auth.users (id, email) values ('${MEMBER}','m2@x'); insert into public.profiles (id, full_name, role) values ('${MEMBER}','Member','member');`);
  const ids = await q<{ id: string }>(`insert into contacts (full_name, phone) values ('Asha Rao','+919800000001'),('Bilal Khan','+919800000002'),('Chitra Das','+919800000003') returning id`);
  [contactA, contactB, contactC] = ids.map((r) => r.id);
});

const q = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => db.query<T>(sql, params).then((r) => r.rows);
const asMember = <T>(fn: () => Promise<T>) => asUser(db, MEMBER, fn);
const asAdmin = <T>(fn: () => Promise<T>) => asUser(db, ADMIN_ID, fn);

describe("WhatsApp consent on contacts", () => {
  it("starts as unknown and is exposed through contact_list", async () => {
    const [row] = await asMember(() => q<{ whatsapp_consent: string }>(`select whatsapp_consent from contact_list where id = $1`, [contactA]));
    expect(row.whatsapp_consent).toBe("unknown");
  });

  it("will not record an opt-in without a source (proof of consent)", async () => {
    await expect(asMember(() => q(`update contacts set whatsapp_consent = 'opted_in' where id = $1`, [contactA]))).rejects.toThrow(/contacts_whatsapp_opt_in_has_source/);
    await expect(asMember(() => q(`update contacts set whatsapp_consent = 'opted_in', whatsapp_consent_source = '  ' where id = $1`, [contactA]))).rejects.toThrow();
  });

  it("records the time when consent changes", async () => {
    await asMember(() => q(`update contacts set whatsapp_consent = 'opted_in', whatsapp_consent_source = 'Form on website, 12 Oct' where id = $1`, [contactA]));
    await asMember(() => q(`update contacts set whatsapp_consent = 'opted_in', whatsapp_consent_source = 'Signed sheet' where id = $1`, [contactB]));
    const [a] = await q<{ whatsapp_consent_at: string | null }>(`select whatsapp_consent_at from contacts where id = $1`, [contactA]);
    expect(a.whatsapp_consent_at).not.toBeNull();
  });

  it("makes an opt-out sticky: only an admin can re-opt someone in", async () => {
    await asMember(() => q(`update contacts set whatsapp_consent = 'opted_out' where id = $1`, [contactB]));
    await expect(
      asMember(() => q(`update contacts set whatsapp_consent = 'opted_in', whatsapp_consent_source = 'asked again' where id = $1`, [contactB])),
    ).rejects.toThrow(/OPT_OUT_LOCKED/);
    await asAdmin(() => q(`update contacts set whatsapp_consent = 'opted_in', whatsapp_consent_source = 'Customer re-subscribed by email' where id = $1`, [contactB]));
    const [b] = await q<{ whatsapp_consent: string }>(`select whatsapp_consent from contacts where id = $1`, [contactB]);
    expect(b.whatsapp_consent).toBe("opted_in");
  });

  it("does not touch the timestamp when other fields change", async () => {
    const [before] = await q<{ t: string }>(`select whatsapp_consent_at::text t from contacts where id = $1`, [contactA]);
    await asMember(() => q(`update contacts set designation = 'Head of Events' where id = $1`, [contactA]));
    const [after] = await q<{ t: string }>(`select whatsapp_consent_at::text t from contacts where id = $1`, [contactA]);
    expect(after.t).toBe(before.t);
  });
});

describe("WhatsApp templates", () => {
  it("lets any team member draft a template but not self-approve it", async () => {
    const [t] = await asMember(() => q<{ id: string }>(`insert into whatsapp_templates (name, category, body) values ('event_invite', 'marketing', 'Hi {{first_name}}, join us at {{event_name}} this weekend.') returning id`));
    templateId = t.id;
    await expect(asMember(() => q(`update whatsapp_templates set status = 'approved' where id = $1`, [templateId]))).rejects.toThrow(/ADMIN_ONLY/);
    await expect(asMember(() => q(`insert into whatsapp_templates (name, category, body, status) values ('sneaky', 'utility', 'Hello there friend', 'approved')`))).rejects.toThrow(/ADMIN_ONLY/);
  });

  it("lets an admin approve, and sends an approved template back to draft when its text changes", async () => {
    await asAdmin(() => q(`update whatsapp_templates set status = 'approved', meta_template_id = 'm1' where id = $1`, [templateId]));
    await asMember(() => q(`update whatsapp_templates set archived_at = now() where id = $1`, [templateId])); // unrelated edit keeps approval
    let [t] = await q<{ status: string }>(`select status from whatsapp_templates where id = $1`, [templateId]);
    expect(t.status).toBe("approved");
    await asMember(() => q(`update whatsapp_templates set archived_at = null, body = 'Hi {{first_name}}, new text for {{event_name}} now.' where id = $1`, [templateId]));
    [t] = await q<{ status: string }>(`select status from whatsapp_templates where id = $1`, [templateId]);
    expect(t.status).toBe("draft");
    await asAdmin(() => q(`update whatsapp_templates set status = 'approved' where id = $1`, [templateId]));
  });

  it("enforces Meta's naming rules", async () => {
    await expect(asMember(() => q(`insert into whatsapp_templates (name, category, body) values ('Bad Name', 'utility', 'x')`))).rejects.toThrow();
    await expect(asMember(() => q(`insert into whatsapp_templates (name, category, body) values ('ok_name', 'promo', 'x')`))).rejects.toThrow();
  });
});

describe("settings and access", () => {
  it("starts in dry-run mode with a conservative daily limit", async () => {
    const [s] = await asMember(() => q<{ mode: string; daily_limit: number }>(`select mode, daily_limit from whatsapp_settings`));
    expect(s).toMatchObject({ mode: "dry_run", daily_limit: 250 });
  });

  it("only lets an admin change them (a member's update changes nothing)", async () => {
    await asMember(() => q(`update whatsapp_settings set mode = 'live', daily_limit = 100000`));
    let [s] = await q<{ mode: string }>(`select mode from whatsapp_settings`);
    expect(s.mode).toBe("dry_run");
    await asAdmin(() => q(`update whatsapp_settings set daily_limit = 1000`));
    [s] = await q<{ mode: string }>(`select mode from whatsapp_settings`);
    expect(s.mode).toBe("dry_run");
    await asAdmin(() => q(`update whatsapp_settings set daily_limit = 250`));
  });

  it("keeps people without access out", async () => {
    await expect(asUser(db, OUTSIDER_ID, () => q(`select * from whatsapp_templates`))).resolves.toEqual([]);
    await expect(asUser(db, null, () => q(`select * from whatsapp_templates`))).rejects.toThrow();
    await expect(asUser(db, OUTSIDER_ID, () => q(`select public.whatsapp_sent_last_24h()`))).resolves.toBeTruthy();
  });
});

describe("the sending queue", () => {
  it("claims each queued message exactly once", async () => {
    const [c] = await asMember(() => q<{ id: string }>(`insert into whatsapp_campaigns (name, template_id, mode) values ('Diwali invite', $1, 'dry_run') returning id`, [templateId]));
    campaignId = c.id;
    await asMember(() => q(`insert into whatsapp_messages (campaign_id, contact_id, to_phone, body) values ($1,$2,'+919800000001','a'),($1,$3,'+919800000002','b'),($1,$4,'+919800000003','c')`, [campaignId, contactA, contactB, contactC]));
    const first = await asMember(() => q<{ id: string; status: string }>(`select * from whatsapp_claim_messages($1, 2)`, [campaignId]));
    const second = await asMember(() => q<{ id: string }>(`select * from whatsapp_claim_messages($1, 5)`, [campaignId]));
    const third = await asMember(() => q<{ id: string }>(`select * from whatsapp_claim_messages($1, 5)`, [campaignId]));
    expect(first).toHaveLength(2);
    expect(first.every((m) => m.status === "sending")).toBe(true);
    expect(second).toHaveLength(1);
    expect(third).toHaveLength(0);
    expect(new Set([...first, ...second].map((m) => m.id)).size).toBe(3);
  });

  it("cannot queue the same person twice in one campaign", async () => {
    await expect(asMember(() => q(`insert into whatsapp_messages (campaign_id, contact_id, to_phone, body) values ($1,$2,'+919800000001','dup')`, [campaignId, contactA]))).rejects.toThrow();
  });

  it("counts messages by status and counts what was sent in the last 24 hours", async () => {
    await q(`update whatsapp_messages set status = 'sent', sent_at = now() where campaign_id = $1 and contact_id = $2`, [campaignId, contactA]);
    await q(`update whatsapp_messages set status = 'sent', sent_at = now() - interval '30 hours' where campaign_id = $1 and contact_id = $2`, [campaignId, contactB]);
    const counts = await asMember(() => q<{ status: string; n: number }>(`select * from whatsapp_campaign_counts($1)`, [campaignId]));
    expect(Object.fromEntries(counts.map((c) => [c.status, c.n]))).toEqual({ sent: 2, sending: 1 });
    const [{ whatsapp_sent_last_24h }] = await asMember(() => q<{ whatsapp_sent_last_24h: number }>(`select whatsapp_sent_last_24h()`));
    expect(whatsapp_sent_last_24h).toBe(1);
  });

  it("fails messages stuck in 'sending' instead of silently retrying them", async () => {
    await q(`update whatsapp_messages set updated_at = now() - interval '20 minutes' where campaign_id = $1 and status = 'sending'`, [campaignId]);
    // updated_at is maintained by trigger, so age it with the trigger bypassed
    await db.exec(`alter table whatsapp_messages disable trigger whatsapp_messages_updated_at`);
    await q(`update whatsapp_messages set updated_at = now() - interval '20 minutes' where campaign_id = '${campaignId}' and status = 'sending'`);
    await db.exec(`alter table whatsapp_messages enable trigger whatsapp_messages_updated_at`);
    const [{ whatsapp_reap_stuck }] = await asMember(() => q<{ whatsapp_reap_stuck: number }>(`select whatsapp_reap_stuck($1)`, [campaignId]));
    expect(whatsapp_reap_stuck).toBe(1);
    const [m] = await q<{ status: string; error: string }>(`select status, error from whatsapp_messages where campaign_id = $1 and contact_id = $2`, [campaignId, contactC]);
    expect(m.status).toBe("failed");
    expect(m.error).toMatch(/Interrupted/);
  });

  it("keeps a person's history if they are deleted from the campaign list only by an admin", async () => {
    await expect(asMember(() => q(`delete from whatsapp_messages where campaign_id = $1`, [campaignId]))).resolves.toEqual([]);
    const [{ n }] = await q<{ n: number }>(`select count(*)::int n from whatsapp_messages where campaign_id = $1`, [campaignId]);
    expect(n).toBe(3);
  });
});
