/** Sending backends. Dry run simulates a send; the Cloud API provider calls Meta's WhatsApp Business Platform. */

export type SendInput = {
  /** Recipient in +E.164 form. */
  to: string;
  template: { name: string; language: string };
  /** Values for {{1}}, {{2}}… in order. */
  params: string[];
  /** The fully rendered text (used by dry run and logs). */
  body: string;
};

export type SendResult = { ok: true; providerId: string } | { ok: false; error: string; code?: number };

export interface WhatsAppProvider {
  readonly kind: "dry_run" | "live";
  send(input: SendInput): Promise<SendResult>;
}

export class ProviderNotConfigured extends Error {}

/** Pretends to send. Nothing leaves the server. Use it to rehearse a campaign end to end. */
export class DryRunProvider implements WhatsAppProvider {
  readonly kind = "dry_run" as const;
  constructor(private readonly failFor: (to: string) => SendResult | null = () => null) {}
  async send(input: SendInput): Promise<SendResult> {
    return this.failFor(input.to) ?? { ok: true, providerId: `dryrun_${crypto.randomUUID()}` };
  }
}

type CloudConfig = { token: string; phoneNumberId: string; version: string };

/** Meta WhatsApp Cloud API. Needs WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID in the server environment. */
export class CloudApiProvider implements WhatsAppProvider {
  readonly kind = "live" as const;
  constructor(private readonly cfg: CloudConfig, private readonly fetchImpl: typeof fetch = fetch) {}

  static fromEnv(env: Record<string, string | undefined> = process.env): CloudApiProvider {
    const token = env.WHATSAPP_ACCESS_TOKEN?.trim();
    const phoneNumberId = env.WHATSAPP_PHONE_NUMBER_ID?.trim();
    if (!token || !phoneNumberId) {
      throw new ProviderNotConfigured("Live sending is not connected yet. Add WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID to the server environment.");
    }
    return new CloudApiProvider({ token, phoneNumberId, version: env.WHATSAPP_API_VERSION?.trim() || "v21.0" });
  }

  async send(input: SendInput): Promise<SendResult> {
    const payload = {
      messaging_product: "whatsapp",
      to: input.to.replace(/\D/g, ""),
      type: "template",
      template: {
        name: input.template.name,
        language: { code: input.template.language },
        ...(input.params.length ? { components: [{ type: "body", parameters: input.params.map((text) => ({ type: "text", text })) }] } : {}),
      },
    };
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15_000);
    try {
      const res = await this.fetchImpl(`https://graph.facebook.com/${this.cfg.version}/${this.cfg.phoneNumberId}/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.cfg.token}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: ctrl.signal,
      });
      const json = (await res.json().catch(() => ({}))) as {
        messages?: { id?: string }[];
        error?: { code?: number; message?: string; error_data?: { details?: string } };
      };
      const id = json.messages?.[0]?.id;
      if (res.ok && id) return { ok: true, providerId: id };
      const e = json.error;
      return { ok: false, code: e?.code, error: (e?.error_data?.details ?? e?.message ?? `WhatsApp returned HTTP ${res.status}`).slice(0, 300) };
    } catch (err) {
      return { ok: false, error: err instanceof Error && err.name === "AbortError" ? "WhatsApp did not answer in time." : "Could not reach WhatsApp." };
    } finally {
      clearTimeout(timer);
    }
  }
}

export function providerFor(mode: "dry_run" | "live"): WhatsAppProvider {
  return mode === "live" ? CloudApiProvider.fromEnv() : new DryRunProvider();
}
