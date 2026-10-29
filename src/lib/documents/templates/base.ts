import fs from "node:fs";
import path from "node:path";

export { dmy, esc, escMultiline, longDate, money, qtyText, RUPEE } from "../format";
import { esc } from "../format";

const ASSETS = path.join(process.cwd(), "src", "assets");
const cache = new Map<string, string>();

function dataUri(file: string, mime: string): string {
  let v = cache.get(file);
  if (!v) {
    v = `data:${mime};base64,${fs.readFileSync(path.join(ASSETS, file)).toString("base64")}`;
    cache.set(file, v);
  }
  return v;
}

export const logoDataUri = () => dataUri("logo.png", "image/png");
export const signatureDataUri = () => dataUri("signature.png", "image/png");

/**
 * Quattrocento Sans is the typeface of the supplied templates (SIL OFL, bundled in src/assets/fonts).
 * The templates render ₹ with Arial; Arimo is the metric-compatible open equivalent and is used as the
 * fallback face, so ₹ resolves exactly where Quattrocento Sans has no glyph.
 */
export function fontFaceCss(): string {
  const face = (family: string, file: string, weight: number, style = "normal") =>
    `@font-face{font-family:"${family}";font-weight:${weight};font-style:${style};src:url(${dataUri(`fonts/${file}`, "font/woff2")}) format("woff2");}`;
  return [
    face("Quattrocento Sans", "quattrocento-sans-latin-400-normal.woff2", 400),
    face("Quattrocento Sans", "quattrocento-sans-latin-700-normal.woff2", 700),
    face("Quattrocento Sans", "quattrocento-sans-latin-400-italic.woff2", 400, "italic"),
    face("Arimo", "arimo-latin-ext-400-normal.woff2", 400),
    face("Arimo", "arimo-latin-ext-700-normal.woff2", 700),
  ].join("\n");
}

/** Wraps page markup in a complete HTML document. */
export function htmlDocument(opts: { title: string; css: string; body: string; lang?: string }): string {
  return `<!doctype html><html lang="${opts.lang ?? "en-IN"}"><head><meta charset="utf-8"><title>${esc(opts.title)}</title>
<style>${fontFaceCss()}
*{box-sizing:border-box;margin:0;padding:0}
html,body{background:#fff}
body{font-family:"Quattrocento Sans","Arimo",sans-serif;color:#111;-webkit-print-color-adjust:exact;print-color-adjust:exact;font-variant-numeric:normal}
${opts.css}</style></head><body>${opts.body}</body></html>`;
}
