import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Page } from "playwright-core";

/**
 * HTML → PDF with headless Chromium (Playwright). Text stays real, selectable text; fonts are embedded
 * from src/assets/fonts; page geometry comes from the template's @page rule.
 *
 * Deployment: needs a Chromium binary. Locally run `npx playwright-core install chromium`. On a server
 * or in Docker set PDF_CHROMIUM_PATH to an installed Chrome/Chromium executable. (Serverless platforms
 * with no bundled browser need a Chromium build such as @sparticuz/chromium — see README.)
 */
let browser: Promise<Engine> | null = null;

/** Rejects with a stage-named error instead of letting a hung step run into the platform's function timeout. */
function within<T>(stage: string, ms: number, work: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${stage} timed out after ${ms / 1000}s`)), ms);
  });
  return Promise.race([work, limit]).finally(() => clearTimeout(timer));
}

/** What the renderer needs from a browser: a fresh page, a way to release it, liveness, and shutdown. */
interface Engine {
  open(): Promise<{ page: Page; release(): Promise<void> }>;
  alive(): boolean;
  close(): Promise<void>;
}

async function launch(): Promise<Engine> {
  // Loaded on demand: only generating a PDF needs the browser library. A top-level import made every document
  // action (cancel, void, record payment...) load it, and a packaging problem there broke all of them.
  const { chromium } = await import("playwright-core");
  // On Vercel / AWS Lambda there is no system Chromium: use the serverless build bundled by @sparticuz/chromium.
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    const sparticuz = (await import("@sparticuz/chromium")).default;
    // That build runs with --single-process, which crashes Chromium when Playwright asks for a new browser context
    // ("browser.newContext: Target page, context or browser has been closed"). A persistent context is the browser's
    // own default context, so no extra one is ever created; pages are opened and closed inside it instead.
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "pw-profile-"));
    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: true,
      executablePath: await sparticuz.executablePath(),
      args: sparticuz.args,
    });
    let alive = true;
    context.on("close", () => { alive = false; });
    return {
      open: async () => {
        const page = await context.newPage();
        return { page, release: () => page.close().catch(() => {}) };
      },
      alive: () => alive,
      close: () => context.close().catch(() => {}),
    };
  }
  const b = await chromium.launch({
    headless: true,
    executablePath: process.env.PDF_CHROMIUM_PATH || undefined,
    args: ["--font-render-hinting=none", ...(process.env.PDF_CHROMIUM_NO_SANDBOX === "1" ? ["--no-sandbox"] : [])],
  });
  return {
    open: async () => {
      const context = await b.newContext();
      return { page: await context.newPage(), release: () => context.close().catch(() => {}) };
    },
    alive: () => b.isConnected(),
    close: () => b.close().catch(() => {}),
  };
}

async function getBrowser(): Promise<Engine> {
  if (!browser) {
    browser = within("Chromium launch", 25_000, launch()).catch((e) => {
      browser = null;
      throw new Error(
        `PDF engine unavailable: ${(e as Error).message.split("\n")[0]}. Run "npx playwright-core install chromium" or set PDF_CHROMIUM_PATH.`,
      );
    });
  }
  const b = await browser;
  if (!b.alive()) {
    browser = null;
    return getBrowser();
  }
  return b;
}

const PAGE_NUMBER_CSS = `@page{@bottom-right{content:"Page " counter(page) " of " counter(pages);font-family:"Quattrocento Sans","Arimo",sans-serif;font-size:7pt;color:#6e6e6e;padding-right:2pt;vertical-align:top;padding-top:2pt}}`;

async function renderOnce(html: string): Promise<Buffer> {
  const b = await getBrowser();
  const { page, release } = await b.open();
  try {
    // Never let a template reach the network: everything (fonts, images) is inlined.
    await page.route("**/*", (route) => (route.request().url().startsWith("data:") ? route.continue() : route.abort()));
    await within("Page load", 15_000, page.setContent(html, { waitUntil: "load" }));
    await within("Font load", 10_000, page.evaluate(() => document.fonts.ready));
    return Buffer.from(await within("PDF print", 20_000, page.pdf({ preferCSSPageSize: true, printBackground: true })));
  } finally {
    await release();
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
