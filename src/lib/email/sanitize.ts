/**
 * Allow-list HTML sanitiser for email bodies (AI output, pasted content and editor content).
 * Keeps basic formatting only; drops scripts, styles, event handlers, forms and anything not listed.
 */
const ALLOWED = new Set(["p", "br", "strong", "b", "em", "i", "u", "h1", "h2", "h3", "ul", "ol", "li", "a", "img", "blockquote", "div", "span", "hr"]);
const VOID = new Set(["br", "img", "hr"]);
const DROP_WITH_CONTENT = /<(script|style|iframe|object|embed|form|noscript)\b[\s\S]*?<\/\1\s*>/gi;

const safeUrl = (u: string, allowMailto: boolean) => {
  const v = u.trim();
  if (/^https?:\/\//i.test(v)) return v;
  if (allowMailto && /^mailto:/i.test(v)) return v;
  return null;
};
const attr = (v: string) => v.replace(/&(?!amp;|lt;|gt;|quot;|#\d+;)/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

export function sanitizeEmailHtml(input: string): string {
  const html = input.replace(/<!--[\s\S]*?-->/g, "").replace(DROP_WITH_CONTENT, "");
  return html.replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g, (full, rawTag: string, rest: string) => {
    const tag = rawTag.toLowerCase();
    if (!ALLOWED.has(tag)) return "";
    if (full.startsWith("</")) return VOID.has(tag) ? "" : `</${tag}>`;
    const get = (name: string) => new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(rest);
    let attrs = "";
    if (tag === "a") {
      const m = get("href");
      const href = m ? safeUrl(m[1] ?? m[2] ?? m[3] ?? "", true) : null;
      if (href) attrs = ` href="${attr(href)}" target="_blank" rel="noopener noreferrer"`;
    } else if (tag === "img") {
      const m = get("src");
      const src = m ? safeUrl(m[1] ?? m[2] ?? m[3] ?? "", false) : null;
      if (!src) return "";
      const alt = get("alt");
      attrs = ` src="${attr(src)}" alt="${attr(alt ? alt[1] ?? alt[2] ?? alt[3] ?? "" : "")}" style="max-width:100%;height:auto"`;
    }
    return `<${tag}${attrs}${VOID.has(tag) ? " /" : ""}>`;
  });
}
