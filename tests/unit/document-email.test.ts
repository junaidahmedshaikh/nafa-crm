import { afterEach, describe, expect, it, vi } from "vitest";
import { sendEmailWithPdf } from "@/lib/documents/email";
import { documentEmailDraft, parseAddressList } from "@/lib/documents/email-template";
import { sendEmailSchema } from "@/lib/documents/schemas";

describe("document email templates", () => {
  it("builds the quotation email", () => {
    const d = documentEmailDraft("quotation", { number: "NAFA-QUO-26-014", clientName: "Priya Shah", clientCompany: "Acme" });
    expect(d.subject).toBe("Quotation NAFA-QUO-26-014 – NAFA Events & Activations");
    expect(d.message.startsWith("Dear Priya Shah,\n\nPlease find attached our quotation for your requested requirements.")).toBe(true);
    expect(d.message).toContain("The document includes the proposed scope of work and commercials for your review.");
    expect(d.message.endsWith("Regards,\nTeam NAFA\nNAFA Events & Activations\nwww.nafaevents.in\ncontact@nafaevents.in\n+91 81695 12822")).toBe(true);
  });
  it("builds the invoice email", () => {
    const d = documentEmailDraft("invoice", { number: "NAFA-INV-26-003", clientName: "Priya Shah" });
    expect(d.subject).toBe("Invoice NAFA-INV-26-003 – NAFA Events & Activations");
    expect(d.message).toContain("Please find attached the invoice for your reference.");
    expect(d.message).toContain("We appreciate your business and look forward to continuing our association.");
    expect(d.message).not.toContain("quotation");
  });
  it("falls back to the company, then a neutral greeting", () => {
    expect(documentEmailDraft("invoice", { number: "N-1", clientName: " ", clientCompany: "Acme Pvt Ltd" }).message).toMatch(/^Dear Acme Pvt Ltd,/);
    expect(documentEmailDraft("invoice", { number: "N-1" }).message).toMatch(/^Dear Sir\/Madam,/);
  });
});

describe("recipient validation", () => {
  const base = { to: "client@example.com", subject: "S", message: "M" };
  it("parses address lists", () => {
    expect(parseAddressList(" A@x.com, b@y.com;a@x.com \n c@z.com ")).toEqual(["a@x.com", "b@y.com", "c@z.com"]);
    expect(parseAddressList("")).toEqual([]);
    expect(parseAddressList(undefined)).toEqual([]);
  });
  it("accepts a valid recipient with optional CC / BCC", () => {
    const r = sendEmailSchema.parse({ ...base, to: "  Client@Example.com ", cc: "a@x.com, b@y.com", bcc: "" });
    expect(r).toMatchObject({ to: "client@example.com", cc: ["a@x.com", "b@y.com"], bcc: [] });
    expect(sendEmailSchema.parse(base)).toMatchObject({ cc: [], bcc: [] });
  });
  it("rejects bad addresses, header injection and empty content", () => {
    expect(sendEmailSchema.safeParse({ ...base, to: "not-an-email" }).success).toBe(false);
    expect(sendEmailSchema.safeParse({ ...base, to: "" }).success).toBe(false);
    expect(sendEmailSchema.safeParse({ ...base, to: "a@x.com\nBcc: evil@x.com" }).success).toBe(false);
    expect(sendEmailSchema.safeParse({ ...base, cc: "ok@x.com, nope" }).success).toBe(false);
    expect(sendEmailSchema.safeParse({ ...base, bcc: Array.from({ length: 11 }, (_, i) => `u${i}@x.com`).join(",") }).success).toBe(false);
    expect(sendEmailSchema.safeParse({ ...base, subject: " " }).success).toBe(false);
    expect(sendEmailSchema.safeParse({ ...base, idempotencyKey: "nope" }).success).toBe(false);
  });
});

describe("sendEmailWithPdf", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
  const opts = { to: "c@x.com", cc: ["a@x.com"], bcc: [], subject: "S", text: "T", filename: "N-1.pdf", pdf: Buffer.from("%PDF"), idempotencyKey: "k-1" };
  const configure = () => { vi.stubEnv("RESEND_API_KEY", "re_test"); vi.stubEnv("EMAIL_FROM", "NAFA <contact@nafaevents.in>"); };

  it("refuses to send when email is not configured", async () => {
    vi.stubEnv("RESEND_API_KEY", ""); vi.stubEnv("EMAIL_FROM", "");
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    expect((await sendEmailWithPdf(opts)).ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("sends recipient, copies, the PDF and an idempotency key, and reports success only with a provider id", async () => {
    configure();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "msg_1" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await sendEmailWithPdf(opts)).toEqual({ ok: true, providerId: "msg_1" });
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ to: ["c@x.com"], cc: ["a@x.com"], subject: "S", text: "T", attachments: [{ filename: "N-1.pdf", content: Buffer.from("%PDF").toString("base64") }] });
    expect(body.bcc).toBeUndefined();
    expect((init.headers as Record<string, string>)["Idempotency-Key"]).toBe("k-1");
  });
  it("reports failure on a provider error, a missing id, or a network error", async () => {
    configure();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ message: "Domain not verified" }), { status: 403 })));
    expect(await sendEmailWithPdf(opts)).toEqual({ ok: false, error: "Domain not verified" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
    expect((await sendEmailWithPdf(opts)).ok).toBe(false);
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    expect(await sendEmailWithPdf(opts)).toMatchObject({ ok: false, error: expect.stringContaining("offline") });
  });
});
