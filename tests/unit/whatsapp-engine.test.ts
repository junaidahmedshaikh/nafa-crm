import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { processBatch } from "@/lib/whatsapp/engine";
import { DryRunProvider, type SendResult, type WhatsAppProvider } from "@/lib/whatsapp/provider";

type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;

/** A tiny in-memory stand-in for the parts of the Supabase client the engine uses. */
function fakeSupabase(tables: Tables): SupabaseClient {
  class Query {
    private filters: ((r: Row) => boolean)[] = [];
    private op: "select" | "update" = "select";
    private patch: Row = {};
    private head = false;
    private joinTemplate = false;
    constructor(private name: string) {}
    select(cols?: string, o?: { head?: boolean }) {
      this.head = !!o?.head;
      this.joinTemplate = !!cols?.includes("template:");
      return this;
    }
    update(p: Row) { this.op = "update"; this.patch = p; return this; }
    eq(k: string, v: unknown) { this.filters.push((r) => r[k] === v); return this; }
    in(k: string, vs: unknown[]) { this.filters.push((r) => vs.includes(r[k])); return this; }
    private run() {
      const rows = (tables[this.name] ?? []).filter((r) => this.filters.every((f) => f(r)));
      if (this.op === "update") {
        rows.forEach((r) => Object.assign(r, this.patch));
        return { data: null, count: rows.length, error: null };
      }
      const out = this.joinTemplate ? rows.map((r) => ({ ...r, template: tables.whatsapp_templates.find((t) => t.id === r.template_id) })) : rows;
      return { data: this.head ? null : out, count: rows.length, error: null };
    }
    maybeSingle() { const r = this.run(); return Promise.resolve({ data: (r.data as Row[] | null)?.[0] ?? null, error: null }); }
    then<T>(res: (v: ReturnType<Query["run"]>) => T) { return Promise.resolve(this.run()).then(res); }
  }
  return {
    from: (name: string) => new Query(name),
    rpc: async (fn: string, args: Row) => {
      const msgs = tables.whatsapp_messages;
      if (fn === "whatsapp_claim_messages") {
        const mine = msgs.filter((m) => m.campaign_id === args.p_campaign && m.status === "queued").slice(0, args.p_limit as number);
        mine.forEach((m) => (m.status = "sending"));
        return { data: mine.map((m) => ({ ...m })), error: null };
      }
      if (fn === "whatsapp_sent_last_24h") return { data: msgs.filter((m) => m.sent_at).length, error: null };
      return { data: 0, error: null };
    },
  } as unknown as SupabaseClient;
}

function setup(n: number, over: { settings?: Row; template?: Row; campaign?: Row; sentBefore?: number; mode?: "dry_run" | "live" } = {}) {
  const tables: Tables = {
    whatsapp_settings: [{ mode: "dry_run", daily_limit: 250, batch_size: 20, send_gap_ms: 0, repeat_window_days: 3, cost_per_message: null, ...over.settings }],
    whatsapp_templates: [{ id: "t1", name: "event_invite", language: "en", status: "approved", ...over.template }],
    whatsapp_campaigns: [{ id: "c1", status: "ready", mode: over.mode ?? "dry_run", template_id: "t1", started_at: null, paused_reason: null, ...over.campaign }],
    contacts: Array.from({ length: n }, (_, i) => ({ id: `p${i}`, whatsapp_consent: "opted_in", archived_at: null })),
    whatsapp_messages: Array.from({ length: n }, (_, i) => ({
      id: `m${i}`, campaign_id: "c1", contact_id: `p${i}`, to_phone: `+9198000000${String(i).padStart(2, "0")}`, body: "hi", params: ["x"], status: "queued", sent_at: null, error: null,
    })),
  };
  for (let i = 0; i < (over.sentBefore ?? 0); i++) tables.whatsapp_messages.push({ id: `old${i}`, campaign_id: "other", contact_id: "z", status: "sent", sent_at: "2026-01-01" });
  return { tables, supabase: fakeSupabase(tables) };
}
const count = (t: Tables, status: string) => t.whatsapp_messages.filter((m) => m.campaign_id === "c1" && m.status === status).length;
const run = (s: SupabaseClient, p: WhatsAppProvider = new DryRunProvider()) => processBatch(s, "c1", p, { sleep: async () => {} });

describe("sending engine", () => {
  it("sends in batches of the configured size and completes the campaign", async () => {
    const { tables, supabase } = setup(45);
    const a = await run(supabase);
    expect(a).toMatchObject({ state: "sent_batch", sent: 20, queued: 25 });
    expect(tables.whatsapp_campaigns[0].status).toBe("sending");
    await run(supabase);
    const c = await run(supabase);
    expect(c).toMatchObject({ state: "completed", sent: 5 });
    expect(count(tables, "sent")).toBe(45);
    expect(tables.whatsapp_campaigns[0].status).toBe("completed");
    expect(tables.whatsapp_messages.filter((m) => m.status === "sent").every((m) => String(m.provider_message_id).startsWith("dryrun_"))).toBe(true);
  });

  it("never exceeds the rolling daily limit, counting other campaigns, and pauses with a clear reason", async () => {
    const { tables, supabase } = setup(30, { settings: { daily_limit: 25 }, sentBefore: 20 });
    const a = await run(supabase);
    expect(a).toMatchObject({ state: "sent_batch", sent: 5, queued: 25 });
    const b = await run(supabase);
    expect(b.state).toBe("paused");
    expect(b.message).toMatch(/daily limit of 25/);
    expect(count(tables, "sent")).toBe(5);
    expect(count(tables, "queued")).toBe(25);
    expect(tables.whatsapp_campaigns[0]).toMatchObject({ status: "paused" });
  });

  it("re-checks consent at send time and skips anyone who opted out since the campaign was built", async () => {
    const { tables, supabase } = setup(4);
    tables.contacts[1].whatsapp_consent = "opted_out";
    tables.contacts[2].archived_at = "2026-02-01";
    const r = await run(supabase);
    expect(r).toMatchObject({ sent: 2, skipped: 2, state: "completed" });
    expect(tables.whatsapp_messages.find((m) => m.id === "m1")).toMatchObject({ status: "skipped" });
  });

  it("stops the whole campaign on an account-level error and returns unsent messages to the queue", async () => {
    const { tables, supabase } = setup(10);
    let n = 0;
    const provider: WhatsAppProvider = { kind: "dry_run", send: async (): Promise<SendResult> => (++n === 3 ? { ok: false, error: "Spam rate limit hit", code: 131048 } : { ok: true, providerId: `id${n}` }) };
    const r = await run(supabase, provider);
    expect(r.state).toBe("paused");
    expect(r.message).toMatch(/131048/);
    expect(count(tables, "sent")).toBe(2);
    expect(count(tables, "failed")).toBe(1);
    expect(count(tables, "queued")).toBe(7);
    expect(count(tables, "sending")).toBe(0);
    expect(tables.whatsapp_campaigns[0].paused_reason).toMatch(/131048/);
  });

  it("stops after five failures in a row", async () => {
    const { tables, supabase } = setup(20);
    const provider: WhatsAppProvider = { kind: "dry_run", send: async () => ({ ok: false, error: "Not on WhatsApp", code: 131026 }) };
    const r = await run(supabase, provider);
    expect(r.state).toBe("paused");
    expect(count(tables, "failed")).toBe(5);
    expect(count(tables, "queued")).toBe(15);
  });

  it("hands unsent messages back when it runs out of time", async () => {
    const { tables, supabase } = setup(10);
    let t = 0;
    const r = await processBatch(supabase, "c1", new DryRunProvider(), { sleep: async () => {}, now: () => (t += 10_000), budgetMs: 25_000 });
    expect(r.state).toBe("sent_batch");
    expect(r.sent).toBeLessThan(10);
    expect(count(tables, "sending")).toBe(0);
    expect(count(tables, "sent") + count(tables, "queued")).toBe(10);
  });

  it("refuses to send live through an unapproved template, or to mix modes", async () => {
    const live = setup(3, { mode: "live", template: { status: "pending" } });
    const liveProvider: WhatsAppProvider = { kind: "live", send: async () => ({ ok: true, providerId: "x" }) };
    const r = await run(live.supabase, liveProvider);
    expect(r.state).toBe("paused");
    expect(r.message).toMatch(/not approved/);
    expect(count(live.tables, "sent")).toBe(0);

    const dry = setup(3);
    expect((await run(dry.supabase, liveProvider)).state).toBe("idle");
    expect(count(dry.tables, "sent")).toBe(0);
  });

  it("does not send for campaigns that are paused, cancelled or finished", async () => {
    for (const status of ["paused", "cancelled", "completed"]) {
      const { tables, supabase } = setup(3, { campaign: { status } });
      expect((await run(supabase)).state).toBe("idle");
      expect(count(tables, "sent")).toBe(0);
    }
  });

  it("lets a dry run rehearse with a template that is still a draft", async () => {
    const { tables, supabase } = setup(2, { template: { status: "draft" } });
    expect((await run(supabase)).state).toBe("completed");
    expect(count(tables, "sent")).toBe(2);
  });
});
