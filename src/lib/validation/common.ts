import { z } from "zod";
import { parsePhone, websiteDomain } from "@/lib/normalize";
import { istLocalToIso } from "@/lib/datetime";

/** Optional free text: trims, empty string -> null. */
export const optText = (max = 500) =>
  z
    .string()
    .trim()
    .max(max, `Must be ${max} characters or fewer`)
    .optional()
    .transform((v) => (v ? v : null));

export const reqText = (label: string, max = 200) =>
  z.string().trim().min(1, `${label} is required`).max(max, `Must be ${max} characters or fewer`);

export const optEmail = z
  .string()
  .trim()
  .max(254)
  .optional()
  .transform((v) => (v ? v.toLowerCase() : null))
  .refine((v) => v === null || z.email().safeParse(v).success, "Enter a valid email address");

/** Optional phone number, normalised to +<country><number>. */
export const optPhone = (defaultCountryCode = "+91") =>
  z
    .string()
    .trim()
    .optional()
    .transform((v, ctx) => {
      if (!v) return null;
      const parsed = parsePhone(v, defaultCountryCode);
      if (!parsed) {
        ctx.addIssue({ code: "custom", message: "Enter a valid phone number with country code, e.g. +91 98765 43210" });
        return z.NEVER;
      }
      return parsed;
    });

/** Optional website; adds https:// when missing. */
export const optWebsite = z
  .string()
  .trim()
  .max(300)
  .optional()
  .transform((v, ctx) => {
    if (!v) return null;
    if (!websiteDomain(v)) {
      ctx.addIssue({ code: "custom", message: "Enter a valid website, e.g. https://example.com" });
      return z.NEVER;
    }
    return /^https?:\/\//i.test(v) ? v : `https://${v}`;
  });

/** Optional INR amount. Accepts "1,50,000" or "150000.50". */
export const optMoney = z
  .string()
  .trim()
  .optional()
  .transform((v, ctx) => {
    if (!v) return null;
    const cleaned = v.replace(/[,\s₹]/g, "").replace(/^INR/i, "");
    if (!/^\d{1,12}(\.\d{1,2})?$/.test(cleaned)) {
      ctx.addIssue({ code: "custom", message: "Enter a valid amount in INR (up to 12 digits, 2 decimals)" });
      return z.NEVER;
    }
    return Number(cleaned);
  });

/** Optional calendar date "YYYY-MM-DD". */
export const optDate = z
  .string()
  .trim()
  .optional()
  .transform((v, ctx) => {
    if (!v) return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || !istLocalToIso(`${v}T00:00`)) {
      ctx.addIssue({ code: "custom", message: "Enter a valid date" });
      return z.NEVER;
    }
    return v;
  });

/** Required IST date-time from a datetime-local input; output is a UTC ISO string. */
export const reqDateTime = (label: string) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required`)
    .transform((v, ctx) => {
      const iso = istLocalToIso(v);
      if (!iso) {
        ctx.addIssue({ code: "custom", message: `Enter a valid ${label.toLowerCase()}` });
        return z.NEVER;
      }
      return iso;
    });

export const optDateTime = z
  .string()
  .trim()
  .optional()
  .transform((v, ctx) => {
    if (!v) return null;
    const iso = istLocalToIso(v);
    if (!iso) {
      ctx.addIssue({ code: "custom", message: "Enter a valid date and time" });
      return z.NEVER;
    }
    return iso;
  });

export const optUuid = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || z.uuid().safeParse(v).success, "Invalid selection");

export function fieldErrorsFrom(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_form";
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}
