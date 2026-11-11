/**
 * {{variable}} personalisation. A variable may carry an inline fallback: {{first_name|there}}.
 * Campaign-level fallbacks fill the rest. Anything still unresolved is reported in `missing`,
 * and a message with missing fields must never be sent.
 */
export const VARIABLES = [
  "first_name", "last_name", "full_name", "company_name", "designation", "industry", "city", "website", "salesperson_name", "sender_name",
] as const;

export type Vars = Record<string, string | null | undefined>;

const PLACEHOLDER = /\{\{\s*([a-zA-Z0-9_]+)\s*(?:\|([^}]*))?\}\}/g;

export type Rendered = { text: string; missing: string[] };

export function renderTemplate(template: string, vars: Vars, fallbacks: Record<string, string> = {}, opts: { escape?: boolean } = {}): Rendered {
  const missing = new Set<string>();
  const esc = (v: string) => (opts.escape ? v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;") : v);
  const text = template.replace(PLACEHOLDER, (_m, name: string, inline?: string) => {
    const v = (vars[name] ?? "").toString().trim();
    if (v) return esc(v);
    const fb = (inline ?? "").trim() || (fallbacks[name] ?? "").trim();
    if (fb) return esc(fb);
    missing.add(name);
    return "";
  });
  return { text, missing: [...missing] };
}

/** Names of every placeholder used in the given strings (for the editor and the review screen). */
export function usedVariables(...templates: string[]): string[] {
  const out = new Set<string>();
  for (const t of templates) for (const m of t.matchAll(PLACEHOLDER)) out.add(m[1]);
  return [...out];
}

export const hasUnresolvedPlaceholder = (s: string) => /\{\{[^}]*\}\}/.test(s);

export function splitName(full: string): { first: string; last: string } {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  return { first: parts[0] ?? "", last: parts.length > 1 ? parts.slice(1).join(" ") : "" };
}

export type RecipientFacts = {
  fullName: string; companyName?: string | null; designation?: string | null; industry?: string | null;
  city?: string | null; website?: string | null;
};

export function recipientVars(r: RecipientFacts, campaign: { salespersonName: string; senderName: string }, custom: Vars = {}): Vars {
  const { first, last } = splitName(r.fullName);
  return {
    first_name: first, last_name: last, full_name: r.fullName, company_name: r.companyName, designation: r.designation,
    industry: r.industry, city: r.city, website: r.website, salesperson_name: campaign.salespersonName, sender_name: campaign.senderName,
    ...custom,
  };
}

/** Plain-text alternative generated from the HTML body. */
export function htmlToText(html: string): string {
  return html
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|ul|ol)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<a [^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, (_m, href, label) => (label.trim() === href ? href : `${label} (${href})`))
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
