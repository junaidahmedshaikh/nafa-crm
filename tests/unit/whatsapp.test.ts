import { describe, expect, it } from "vitest";
import { evaluateAudience, maskPhone, type AudienceContact } from "@/lib/whatsapp/audience";
import { circuitBreaker, daysToSend, estimateCost, nextBatchSize } from "@/lib/whatsapp/limits";
import { CloudApiProvider, DryRunProvider, ProviderNotConfigured } from "@/lib/whatsapp/provider";
import { checkTemplate, customPlaceholders, isOptOutText, placeholdersOf, renderTemplate, toMetaBody } from "@/lib/whatsapp/template";

describe("template checks", () => {
  const ok = { body: "Hi {{first_name}}, we are hosting {{event_name}} at our studio this Saturday.", footer: "Reply STOP to unsubscribe", category: "marketing" as const };

  it("accepts a well-formed marketing template", () => {
    const r = checkTemplate(ok);
    expect(r.errors).toEqual([]);
    expect(r.placeholders).toEqual(["first_name", "event_name"]);
  });

  it("requires marketing messages to carry an opt-out line", () => {
    expect(checkTemplate({ ...ok, footer: "" }).errors.join(" ")).toMatch(/opt out/);
    expect(checkTemplate({ ...ok, footer: "", body: `${ok.body} Reply STOP to opt out.` }).errors).toEqual([]);
    expect(checkTemplate({ ...ok, category: "utility", footer: "" }).errors).toEqual([]);
  });

  it("rejects what Meta rejects: placeholder at the start or end, adjacent placeholders, bad names", () => {
    expect(checkTemplate({ ...ok, body: "{{first_name}} come and see our new space on Saturday" }).errors.join()).toMatch(/first or very last/);
    expect(checkTemplate({ ...ok, body: "Come and see our new space on Saturday {{first_name}}" }).errors.join()).toMatch(/first or very last/);
    expect(checkTemplate({ ...ok, body: "Hello {{first_name}}{{event_name}} is on Saturday at our studio" }).errors.join()).toMatch(/next to each other/);
    expect(checkTemplate({ ...ok, body: "Hello {{First Name}}, see you on Saturday at our studio" }).errors.join()).toMatch(/Invalid placeholder/);
    expect(checkTemplate({ ...ok, body: "Hello {{first_name, see you on Saturday at our studio" }).errors.join()).toMatch(/Invalid placeholder/);
  });

  it("enforces length limits and warns about spammy writing", () => {
    expect(checkTemplate({ ...ok, body: "a ".repeat(600) }).errors.join()).toMatch(/1,024/);
    expect(checkTemplate({ ...ok, footer: "x".repeat(61) }).errors.join()).toMatch(/footer/);
    expect(checkTemplate({ ...ok, body: "Visit bit.ly/abc for details about our new studio opening on Saturday" }).warnings.join()).toMatch(/shorteners/);
    expect(checkTemplate({ ...ok, body: "BIG NEWS EVERYONE COME TO OUR GRAND OPENING THIS SATURDAY AT THE STUDIO" }).warnings.join()).toMatch(/CAPITAL/);
    expect(checkTemplate({ category: "utility", body: "Get a big discount on your next booking with us this week" }).warnings.join()).toMatch(/promotional/);
  });
});

describe("placeholders and rendering", () => {
  it("finds distinct placeholders in order and the ones a campaign must supply", () => {
    const body = "Hi {{first_name}}, {{event_name}} on {{event_date}}. See you at {{event_name}}!";
    expect(placeholdersOf(body)).toEqual(["first_name", "event_name", "event_date"]);
    expect(customPlaceholders(body)).toEqual(["event_name", "event_date"]);
  });

  it("converts to Meta's numbered form, reusing numbers for repeats", () => {
    const { text, order } = toMetaBody("Hi {{first_name}}, {{event_name}} is on. Bring {{first_name}}'s friends to {{event_name}}.");
    expect(text).toBe("Hi {{1}}, {{2}} is on. Bring {{1}}'s friends to {{2}}.");
    expect(order).toEqual(["first_name", "event_name"]);
  });

  it("fills contact and campaign values, drops titles, and never leaves a value empty", () => {
    const tpl = { body: "Hi {{first_name}} from {{company}}, join {{event_name}} on Saturday.", footer: "Reply STOP to unsubscribe" };
    const r = renderTemplate(tpl, { full_name: "Dr. Asha Rao", company_name: "Acme Pvt Ltd" }, { event_name: "Brand Night" });
    expect(r.text).toBe("Hi Asha from Acme Pvt Ltd, join Brand Night on Saturday.\n\nReply STOP to unsubscribe");
    expect(r.params).toEqual(["Asha", "Acme Pvt Ltd", "Brand Night"]);
    const blank = renderTemplate(tpl, { full_name: "  ", company_name: null }, { event_name: "Brand Night" });
    expect(blank.params).toEqual(["there", "your organisation", "Brand Night"]);
    expect(renderTemplate(tpl, { full_name: "Asha" }, {}).missing).toEqual(["event_name"]);
  });

  it("strips line breaks and long space runs from values, which WhatsApp rejects", () => {
    const r = renderTemplate({ body: "Hi {{first_name}}, join {{event_name}} on Saturday." }, { full_name: "Asha" }, { event_name: "Brand\nNight    Live\t2026" });
    expect(r.params[1]).toBe("Brand Night Live 2026");
  });

  it("recognises opt-out replies", () => {
    for (const t of ["STOP", "stop.", " Unsubscribe ", "opt out", "Remove me"]) expect(isOptOutText(t)).toBe(true);
    for (const t of ["please don't stop the event", "stopping by tomorrow", "yes"]) expect(isOptOutText(t)).toBe(false);
  });
});

describe("audience safety filter", () => {
  const c = (id: string, over: Partial<AudienceContact> = {}): AudienceContact => ({
    id, full_name: id, phone: "9800000001", whatsapp: null, whatsapp_consent: "opted_in", archived_at: null, ...over,
  });

  it("only lets opted-in people with a valid number through", () => {
    const r = evaluateAudience(
      [
        c("good", { phone: "98000 00001" }),
        c("unknown", { whatsapp_consent: "unknown", phone: "9800000002" }),
        c("out", { whatsapp_consent: "opted_out", phone: "9800000003" }),
        c("nophone", { phone: null }),
        c("bad", { phone: "12" }),
        c("old", { archived_at: "2026-01-01", phone: "9800000004" }),
      ],
      { defaultCountryCode: "+91" },
    );
    expect(r.eligible.map((e) => e.contact.id)).toEqual(["good"]);
    expect(r.eligible[0].phone).toBe("+919800000001");
    expect(r.skipped).toMatchObject({ no_consent: 1, opted_out: 1, no_phone: 1, invalid_phone: 1, archived: 1 });
  });

  it("prefers the WhatsApp number, and sends to a shared number only once", () => {
    const r = evaluateAudience([c("a", { phone: "9800000001", whatsapp: "9800000009" }), c("b", { phone: "9800000009" })], { defaultCountryCode: "+91" });
    expect(r.eligible.map((e) => [e.contact.id, e.phone])).toEqual([["a", "+919800000009"]]);
    expect(r.skipped.duplicate_number).toBe(1);
  });

  it("holds back people messaged recently", () => {
    const r = evaluateAudience([c("a"), c("b", { phone: "9800000002" })], { defaultCountryCode: "+91", recentlyMessaged: new Set(["a"]) });
    expect(r.eligible.map((e) => e.contact.id)).toEqual(["b"]);
    expect(r.skipped.recently_messaged).toBe(1);
  });

  it("masks numbers for display", () => {
    expect(maskPhone("+919800000001")).toBe("+91 98••• ••001");
  });
});

describe("throttling", () => {
  it("never plans more than the batch size, the daily allowance, or what is queued", () => {
    expect(nextBatchSize({ dailyLimit: 250, sentLast24h: 0, batchSize: 20, queued: 500 })).toBe(20);
    expect(nextBatchSize({ dailyLimit: 250, sentLast24h: 245, batchSize: 20, queued: 500 })).toBe(5);
    expect(nextBatchSize({ dailyLimit: 250, sentLast24h: 250, batchSize: 20, queued: 500 })).toBe(0);
    expect(nextBatchSize({ dailyLimit: 250, sentLast24h: 400, batchSize: 20, queued: 500 })).toBe(0);
    expect(nextBatchSize({ dailyLimit: 250, sentLast24h: 0, batchSize: 20, queued: 3 })).toBe(3);
  });

  it("works out how many days a list takes and what it costs", () => {
    expect(daysToSend(0, 250, 0)).toBe(0);
    expect(daysToSend(200, 250, 0)).toBe(1);
    expect(daysToSend(600, 250, 0)).toBe(3);
    expect(daysToSend(300, 250, 200)).toBe(2);
    expect(estimateCost(120, 0.88)).toBe(105.6);
    expect(estimateCost(120, null)).toBeNull();
  });
});

describe("circuit breaker", () => {
  const ok = { ok: true };
  const bad = (code?: number) => ({ ok: false, code });
  it("lets a normal run through, including the odd failure", () => {
    expect(circuitBreaker([ok, ok, bad(131026), ok, ok, ok]).trip).toBe(false);
  });
  it("stops at once on account-level errors", () => {
    expect(circuitBreaker([ok, bad(131048)]).trip).toBe(true);
    expect(circuitBreaker([bad(130429)]).trip).toBe(true);
    expect(circuitBreaker([bad(190)]).trip).toBe(true);
  });
  it("stops after five failures in a row, or when over 30% of ten fail", () => {
    expect(circuitBreaker([ok, bad(), bad(), bad(), bad(), bad()]).trip).toBe(true);
    expect(circuitBreaker([bad(), bad(), bad(), bad()]).trip).toBe(false);
    const mixed = [ok, bad(), ok, bad(), ok, bad(), ok, bad(), ok, ok];
    expect(circuitBreaker(mixed).trip).toBe(true); // 4 of 10
    expect(circuitBreaker([...mixed.slice(0, 7), ok, ok, ok]).trip).toBe(false); // 3 of 10
  });
});

describe("providers", () => {
  it("dry run succeeds without contacting anyone, and can simulate a failure", async () => {
    const p = new DryRunProvider((to) => (to.endsWith("0") ? { ok: false, error: "nope", code: 131026 } : null));
    const a = await p.send({ to: "+919800000001", template: { name: "t", language: "en" }, params: [], body: "x" });
    expect(a.ok && a.providerId.startsWith("dryrun_")).toBe(true);
    expect(await p.send({ to: "+919800000000", template: { name: "t", language: "en" }, params: [], body: "x" })).toMatchObject({ ok: false, code: 131026 });
  });

  it("refuses to go live without credentials", () => {
    expect(() => CloudApiProvider.fromEnv({})).toThrow(ProviderNotConfigured);
    expect(() => CloudApiProvider.fromEnv({ WHATSAPP_ACCESS_TOKEN: "x" })).toThrow(ProviderNotConfigured);
  });

  it("builds the Cloud API template request and reads the response", async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const fakeFetch = (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return new Response(JSON.stringify({ messages: [{ id: "wamid.123" }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const p = new CloudApiProvider({ token: "T", phoneNumberId: "999", version: "v21.0" }, fakeFetch);
    const r = await p.send({ to: "+919800000001", template: { name: "event_invite", language: "en" }, params: ["Asha", "Brand Night"], body: "x" });
    expect(r).toEqual({ ok: true, providerId: "wamid.123" });
    expect(seen!.url).toBe("https://graph.facebook.com/v21.0/999/messages");
    expect((seen!.init.headers as Record<string, string>).Authorization).toBe("Bearer T");
    expect(JSON.parse(seen!.init.body as string)).toEqual({
      messaging_product: "whatsapp", to: "919800000001", type: "template",
      template: { name: "event_invite", language: { code: "en" }, components: [{ type: "body", parameters: [{ type: "text", text: "Asha" }, { type: "text", text: "Brand Night" }] }] },
    });
  });

  it("returns Meta's error code and message when a send is refused", async () => {
    const fakeFetch = (async () => new Response(JSON.stringify({ error: { code: 131048, message: "Spam rate limit hit" } }), { status: 400 })) as unknown as typeof fetch;
    const p = new CloudApiProvider({ token: "T", phoneNumberId: "999", version: "v21.0" }, fakeFetch);
    expect(await p.send({ to: "+919800000001", template: { name: "t", language: "en" }, params: [], body: "x" })).toEqual({ ok: false, code: 131048, error: "Spam rate limit hit" });
  });
});
