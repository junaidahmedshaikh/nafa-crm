import { z } from "zod";
import { optText, reqText } from "@/lib/validation/common";

export const TEMPLATE_CATEGORIES = ["marketing", "utility"] as const;
export const CATEGORY_LABELS: Record<(typeof TEMPLATE_CATEGORIES)[number], string> = { marketing: "Marketing", utility: "Utility" };
export const TEMPLATE_STATUSES = ["draft", "pending", "approved", "rejected"] as const;
export const TEMPLATE_STATUS_LABELS: Record<(typeof TEMPLATE_STATUSES)[number], string> = {
  draft: "Draft", pending: "Waiting for WhatsApp", approved: "Approved", rejected: "Rejected",
};
export const CAMPAIGN_STATUS_LABELS = { ready: "Ready", sending: "Sending", paused: "Paused", completed: "Completed", cancelled: "Cancelled" } as const;
export const CONSENT_VALUES = ["unknown", "opted_in", "opted_out"] as const;
export const CONSENT_LABELS: Record<(typeof CONSENT_VALUES)[number], string> = { unknown: "Not recorded", opted_in: "Opted in", opted_out: "Opted out" };

export const MAX_CAMPAIGN_SIZE = 2000;

export const templateInputSchema = z.object({
  name: z.string().trim().regex(/^[a-z][a-z0-9_]{0,59}$/, "Use lowercase letters, numbers and underscores, starting with a letter"),
  language: z.string().trim().regex(/^[a-z]{2}(_[A-Z]{2})?$/, "Use a language code like en or en_GB"),
  category: z.enum(TEMPLATE_CATEGORIES),
  body: reqText("Message", 1024),
  footer: optText(60),
});
export type TemplateInput = z.input<typeof templateInputSchema>;
export type TemplateData = z.output<typeof templateInputSchema>;

export const campaignInputSchema = z.object({
  name: reqText("Campaign name", 150),
  template_id: z.uuid("Choose a template"),
  contact_ids: z.array(z.uuid()).min(1, "Choose at least one contact").max(MAX_CAMPAIGN_SIZE, `Send to at most ${MAX_CAMPAIGN_SIZE} contacts per campaign`),
  custom_values: z.record(z.string(), z.string().trim().max(200, "Must be 200 characters or fewer")).default({}),
});
export type CampaignInput = z.input<typeof campaignInputSchema>;

const wholeNumber = (label: string, min: number, max: number) =>
  z.string().trim().regex(/^\d{1,7}$/, `Enter a whole number for ${label}`).transform(Number).refine((n) => n >= min && n <= max, `${label} must be between ${min} and ${max}`);

export const waSettingsSchema = z.object({
  mode: z.enum(["dry_run", "live"]),
  daily_limit: wholeNumber("daily limit", 1, 1_000_000),
  batch_size: wholeNumber("batch size", 1, 100),
  send_gap_ms: wholeNumber("gap between messages", 0, 10_000),
  repeat_window_days: wholeNumber("repeat window", 0, 365),
  cost_per_message: z.string().trim().transform((v, ctx) => {
    if (!v) return null;
    if (!/^\d{1,5}(\.\d{1,2})?$/.test(v)) { ctx.addIssue({ code: "custom", message: "Enter an amount like 0.88" }); return z.NEVER; }
    return Number(v);
  }),
});
export type WaSettingsInput = z.input<typeof waSettingsSchema>;
export type WaSettingsData = z.output<typeof waSettingsSchema>;

export const consentInputSchema = z.object({
  contact_ids: z.array(z.uuid()).min(1, "Choose at least one contact").max(5000),
  status: z.enum(CONSENT_VALUES),
  source: optText(300),
});
