import { parsePhone } from "@/lib/normalize";

export type AudienceContact = {
  id: string;
  full_name: string;
  phone: string | null;
  whatsapp: string | null;
  whatsapp_consent: "unknown" | "opted_in" | "opted_out";
  archived_at: string | null;
};

export type SkipReason = "archived" | "opted_out" | "no_consent" | "no_phone" | "invalid_phone" | "duplicate_number" | "recently_messaged";

export const SKIP_LABELS: Record<SkipReason, string> = {
  archived: "Archived contact",
  opted_out: "Opted out of WhatsApp",
  no_consent: "No recorded WhatsApp consent",
  no_phone: "No phone number",
  invalid_phone: "Phone number looks invalid",
  duplicate_number: "Same number already in this list",
  recently_messaged: "Messaged recently",
};

export type AudienceEntry =
  | { contact: AudienceContact; phone: string; reason: null }
  | { contact: AudienceContact; phone: string | null; reason: SkipReason };

/**
 * Decides who may be messaged. Only people recorded as opted in, with a usable number, who have not been
 * messaged inside the repeat window, and who are not already in the list under another record.
 * `recentlyMessaged` holds contact ids that were sent a message within the repeat window.
 */
export function evaluateAudience(
  contacts: AudienceContact[],
  opts: { defaultCountryCode: string; recentlyMessaged?: Set<string> },
): { entries: AudienceEntry[]; eligible: Extract<AudienceEntry, { reason: null }>[]; skipped: Record<SkipReason, number> } {
  const skipped = Object.fromEntries(Object.keys(SKIP_LABELS).map((k) => [k, 0])) as Record<SkipReason, number>;
  const seenNumbers = new Set<string>();
  const entries: AudienceEntry[] = contacts.map((contact) => {
    const raw = contact.whatsapp?.trim() || contact.phone?.trim() || null;
    const phone = raw ? parsePhone(raw, opts.defaultCountryCode) : null;
    let reason: SkipReason | null = null;
    if (contact.archived_at) reason = "archived";
    else if (contact.whatsapp_consent === "opted_out") reason = "opted_out";
    else if (contact.whatsapp_consent !== "opted_in") reason = "no_consent";
    else if (!raw) reason = "no_phone";
    else if (!phone) reason = "invalid_phone";
    else if (opts.recentlyMessaged?.has(contact.id)) reason = "recently_messaged";
    else if (seenNumbers.has(phone)) reason = "duplicate_number";
    if (reason) {
      skipped[reason]++;
      return { contact, phone, reason };
    }
    seenNumbers.add(phone!);
    return { contact, phone: phone!, reason: null };
  });
  return { entries, eligible: entries.filter((e): e is Extract<AudienceEntry, { reason: null }> => e.reason === null), skipped };
}

/** Mask a number for lists, e.g. +91 98••• ••210. Full numbers stay on the contact record. */
export function maskPhone(phone: string): string {
  const d = phone.replace(/\D/g, "");
  return d.length <= 6 ? phone : `+${d.slice(0, 2)} ${d.slice(2, 4)}••• ••${d.slice(-3)}`;
}
