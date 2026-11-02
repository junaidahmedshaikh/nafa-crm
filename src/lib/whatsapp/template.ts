/**
 * WhatsApp message templates: {{placeholder}} parsing, checks against Meta's rules, and rendering.
 *
 * Templates are written with readable placeholders such as {{first_name}}. Meta wants numbered ones ({{1}}),
 * so toMetaBody() converts when a template is submitted, and the sender passes values in the same order.
 */

export const CONTACT_VARIABLES = {
  first_name: { label: "First name", fallback: "there" },
  full_name: { label: "Full name", fallback: "there" },
  company: { label: "Company", fallback: "your organisation" },
  designation: { label: "Designation", fallback: "your role" },
} as const;
export type ContactVariable = keyof typeof CONTACT_VARIABLES;
export const isContactVariable = (name: string): name is ContactVariable => name in CONTACT_VARIABLES;

const PLACEHOLDER = /\{\{([a-z][a-z0-9_]{0,39})\}\}/g;
const ANY_BRACES = /\{\{[^}]*\}\}|\{\{|\}\}/g;

/** Distinct placeholder names in order of first appearance. */
export function placeholdersOf(text: string): string[] {
  const seen: string[] = [];
  for (const m of text.matchAll(PLACEHOLDER)) if (!seen.includes(m[1])) seen.push(m[1]);
  return seen;
}

export type TemplateCheck = { errors: string[]; warnings: string[]; placeholders: string[] };

const PROMO_WORDS = /\b(offer|discount|sale|% off|buy now|limited time|deal|coupon|cashback|free gift|book now|hurry)\b/i;
const SHORTENERS = /\b(bit\.ly|tinyurl\.com|goo\.gl|t\.co|rb\.gy|cutt\.ly|shorturl\.at)\b/i;
const OPT_OUT = /\b(stop|unsubscribe|opt[ -]?out)\b/i;

/** Checks a draft against Meta's template rules plus our own safety rules. Errors block saving. */
export function checkTemplate(input: { body: string; footer?: string | null; category: "marketing" | "utility" }): TemplateCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  const body = input.body.trim();
  const footer = (input.footer ?? "").trim();

  if (!body) errors.push("Write the message text.");
  if (body.length > 1024) errors.push(`The message is ${body.length} characters; WhatsApp allows at most 1,024.`);
  if (footer.length > 60) errors.push(`The footer is ${footer.length} characters; WhatsApp allows at most 60.`);

  // Anything that looks like a placeholder but is not a valid one, e.g. {{First Name}} or an unclosed {{.
  const bad = [...body.matchAll(ANY_BRACES)].map((m) => m[0]).filter((t) => !/^\{\{[a-z][a-z0-9_]{0,39}\}\}$/.test(t));
  if (bad.length) errors.push(`Invalid placeholder ${bad[0]}. Use lowercase names with underscores, like {{first_name}}.`);
  if (/\{[^{]|[^}]\}/.test(body.replace(PLACEHOLDER, ""))) warnings.push("The text has a single curly brace. Placeholders need double braces: {{name}}.");

  const placeholders = placeholdersOf(body);
  if (/^\{\{[^}]+\}\}/.test(body) || /\{\{[^}]+\}\}[\s.!?,:;]*$/.test(body)) {
    errors.push("A placeholder cannot be the very first or very last thing in the message. WhatsApp rejects these. Add a few words around it.");
  }
  if (/\}\}\s*\{\{/.test(body)) errors.push("Two placeholders cannot sit next to each other. Put some text between them.");
  if (placeholders.length > 0) {
    const words = body.replace(PLACEHOLDER, " ").split(/\s+/).filter(Boolean).length;
    if (words < placeholders.length * 4) warnings.push("There are many placeholders for the amount of text. WhatsApp often rejects templates like this. Add more fixed wording.");
  }
  if (/\n{3,}/.test(body) || / {4,}/.test(body)) errors.push("Remove extra blank lines or runs of spaces. WhatsApp rejects them.");
  if (SHORTENERS.test(body)) warnings.push("Link shorteners (bit.ly and similar) are often rejected. Use your full website address.");
  const letters = body.replace(/[^A-Za-z]/g, "");
  if (letters.length > 20 && letters.replace(/[^A-Z]/g, "").length / letters.length > 0.5) warnings.push("Too much CAPITAL text reads like spam and raises block rates.");
  if ((body.match(/!/g) ?? []).length > 3) warnings.push("Several exclamation marks read like spam. Keep it calm.");

  if (input.category === "marketing" && !OPT_OUT.test(`${body} ${footer}`)) {
    errors.push("Marketing messages must tell people how to opt out. Add a footer such as “Reply STOP to unsubscribe”.");
  }
  if (input.category === "utility" && PROMO_WORDS.test(body)) {
    warnings.push("This sounds promotional. WhatsApp may re-categorise a “utility” template as marketing, which costs more.");
  }
  return { errors, warnings, placeholders };
}

/** Placeholders the template uses that are not contact fields, so the campaign must supply them. */
export const customPlaceholders = (body: string) => placeholdersOf(body).filter((p) => !isContactVariable(p));

/** Converts {{first_name}} to {{1}} in order of first use, and returns that order. */
export function toMetaBody(body: string): { text: string; order: string[] } {
  const order = placeholdersOf(body);
  return { text: body.replace(PLACEHOLDER, (_, name: string) => `{{${order.indexOf(name) + 1}}}`), order };
}

/** WhatsApp rejects variable values with new lines, tabs or runs of 4+ spaces. */
export function cleanValue(v: string, max = 200): string {
  return v.replace(/[\r\n\t]+/g, " ").replace(/ {2,}/g, " ").trim().slice(0, max);
}

export type ContactForRender = { full_name: string; company_name?: string | null; designation?: string | null };

const TITLES = new Set(["mr", "mrs", "ms", "miss", "dr", "prof", "shri", "smt", "sri"]);

export function contactValues(c: ContactForRender): Record<ContactVariable, string> {
  const parts = c.full_name.trim().split(/\s+/).filter((p) => !TITLES.has(p.toLowerCase().replace(/\.$/, "")));
  const full = parts.join(" ");
  return {
    first_name: cleanValue(parts[0] ?? "") || CONTACT_VARIABLES.first_name.fallback,
    full_name: cleanValue(full) || CONTACT_VARIABLES.full_name.fallback,
    company: cleanValue(c.company_name ?? "") || CONTACT_VARIABLES.company.fallback,
    designation: cleanValue(c.designation ?? "") || CONTACT_VARIABLES.designation.fallback,
  };
}

export type Rendered = { text: string; params: string[]; missing: string[] };

/** Fills a template for one contact. `custom` supplies campaign-wide placeholders. */
export function renderTemplate(
  tpl: { body: string; footer?: string | null },
  contact: ContactForRender,
  custom: Record<string, string> = {},
): Rendered {
  const values: Record<string, string> = { ...contactValues(contact) };
  for (const [k, v] of Object.entries(custom)) if (!isContactVariable(k)) values[k] = cleanValue(v);
  const missing = placeholdersOf(tpl.body).filter((p) => !values[p]);
  const text = tpl.body.replace(PLACEHOLDER, (_, name: string) => values[name] ?? "");
  const params = placeholdersOf(tpl.body).map((p) => values[p] ?? "");
  return { text: tpl.footer?.trim() ? `${text}\n\n${tpl.footer.trim()}` : text, params, missing };
}

/** True if an incoming customer message is a request to stop (used when replies are processed). */
export function isOptOutText(text: string): boolean {
  return /^\s*(stop|stop all|unsubscribe|cancel|opt[ -]?out|do not message|dont message|don't message|remove me)\s*[.!]*\s*$/i.test(text);
}
