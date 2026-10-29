import { chromium, type Browser } from "playwright-core";

/**
 * HTML → PDF with headless Chromium (Playwright). Text stays real, selectable text; fonts are embedded
 * from src/assets/fonts; page geometry comes from the template's @page rule.
 *
 * Deployment: needs a Chromium binary. Locally run `npx playwright-core install chromium`. On a server
 * or in Docker set PDF_CHROMIUM_PATH to an installed Chrome/Chromium executable. (Serverless platforms
 * with no bundled browser need a Chromium build such as @sparticuz/chromium — see README.)
 */
let browser: Promise<Browser> | null = null;

function launch(): Promise<Browser> {
  return chromium.launch({
    headless: true,
    executablePath: process.env.PDF_CHROMIUM_PATH || undefined,
    args: ["--font-render-hinting=none", ...(process.env.PDF_CHROMIUM_NO_SANDBOX === "1" ? ["--no-sandbox"] : [])],
  });
}

async function getBrowser(): Promise<Browser> {
  if (!browser) {
    browser = launch().catch((e) => {
      browser = null;
      throw new Error(
        `PDF engine unavailable: ${(e as Error).message.split("\n")[0]}. Run "npx playwright-core install chromium" or set PDF_CHROMIUM_PATH.`,
      );
    });
  }
  const b = await browser;
  if (!b.isConnected()) {
    browser = null;
    return getBrowser();
  }
  return b;
}

const PAGE_NUMBER_CSS = `@page{@bottom-right{content:"Page " counter(page) " of " counter(pages);font-family:"Quattrocento Sans","Arimo",sans-serif;font-size:7pt;color:#6e6e6e;padding-right:2pt;vertical-align:top;padding-top:2pt}}`;

async function renderOnce(html: string): Promise<Buffer> {
  const b = await getBrowser();
  const context = await b.newContext();
  try {
    const page = await context.newPage();
    // Never let a template reach the network: everything (fonts, images) is inlined.
    await page.route("**/*", (route) => (route.request().url().startsWith("data:") ? route.continue() : route.abort()));
    await page.setContent(html, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    return Buffer.from(await page.pdf({ preferCSSPageSize: true, printBackground: true }));
  } finally {
    await context.close();
  }
}

export function countPdfPages(pdf: Buffer): number {
  return (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;
}

/** Renders a PDF; multi-page documents are re-rendered once with "Page x of y" numbering. */
export async function htmlToPdf(html: string): Promise<{ pdf: Buffer; pages: number }> {
  const first = await renderOnce(html);
  const pages = countPdfPages(first);
  if (pages <= 1) return { pdf: first, pages };
  const numbered = html.replace("</style>", `${PAGE_NUMBER_CSS}</style>`);
  return { pdf: await renderOnce(numbered), pages };
}

export async function closePdfEngine() {
  if (browser) {
    const b = await browser.catch(() => null);
    browser = null;
    await b?.close();
  }
}
