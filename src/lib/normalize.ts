/**
 * Normalisation helpers. These MUST stay in sync with the generated columns in
 * supabase/migrations/*_schema.sql (companies.name_normalized, contacts.email_normalized,
 * contacts.phone_normalized). tests/db/schema.test.ts checks the parity against a real Postgres.
 */

export function normalizeCompanyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\b(pvt|private|ltd|limited|llp|inc|llc)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeEmail(email: string | null | undefined): string | null {
  const v = email?.trim().toLowerCase();
  return v ? v : null;
}

/** Digits only (including the country code), matching contacts.phone_normalized. */
export function phoneDigits(phone: string | null | undefined): string | null {
  const v = (phone ?? "").replace(/\D/g, "");
  return v ? v : null;
}

/**
 * Parses a user-entered phone number into "+<countrycode><number>".
 * - "+91 98765 43210" -> "+919876543210"
 * - "9876543210" (10 digits, no +) -> default country code is applied
 * - "09876543210" -> leading trunk zero dropped, default country code applied
 * Returns null if it does not look like a valid number (7-15 digits incl. country code).
 */
export function parsePhone(input: string | null | undefined, defaultCountryCode = "+91"): string | null {
  const raw = (input ?? "").trim();
  if (!raw) return null;
  if (!/^[+\d\s().-]+$/.test(raw)) return null;
  const hasPlus = raw.startsWith("+") || raw.startsWith("00");
  let digits = raw.replace(/\D/g, "");
  if (raw.startsWith("00")) digits = digits.slice(2);
  if (hasPlus) {
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  }
  const cc = defaultCountryCode.replace(/\D/g, "") || "91";
  digits = digits.replace(/^0+/, "");
  if (digits.length < 6 || digits.length > 12) return null;
  // Already includes the default country code (e.g. "919876543210")?
  if (digits.startsWith(cc) && digits.length > 10) digits = digits.slice(cc.length);
  const full = cc + digits;
  return full.length >= 8 && full.length <= 15 ? `+${full}` : null;
}

/** Hostname without "www.", for website comparison. */
export function websiteDomain(url: string | null | undefined): string | null {
  const v = url?.trim();
  if (!v) return null;
  try {
    const host = new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`).hostname.toLowerCase();
    return host.replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}
