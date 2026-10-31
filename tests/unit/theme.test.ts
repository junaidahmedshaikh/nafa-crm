import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { DEFAULT_THEME, THEME_INIT_SCRIPT, readThemeCookie, resolveTheme } from "@/lib/theme";

const css = fs.readFileSync(path.resolve(__dirname, "../../src/app/globals.css"), "utf8");

describe("theme logic", () => {
  it("resolves the preference, including following the device for System default", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });

  it("keeps the existing light look unless someone chooses otherwise", () => {
    expect(DEFAULT_THEME).toBe("light");
    expect(readThemeCookie("")).toBe("light");
    expect(readThemeCookie("a=1; nafa_theme=dark; b=2")).toBe("dark");
    expect(readThemeCookie("nafa_theme=system")).toBe("system");
    expect(readThemeCookie("nafa_theme=neon")).toBe("light"); // junk is ignored
  });

  it("pre-paint script sets the class from the cookie, before first paint, and never throws", () => {
    const run = (cookie: string, systemDark: boolean) => {
      const classes = new Set<string>();
      const root = { classList: { toggle: (c: string, on: boolean) => (on ? classes.add(c) : classes.delete(c)) }, style: {} as Record<string, string> };
      const ctx = { document: { cookie, documentElement: root }, window: { matchMedia: () => ({ matches: systemDark }) } };
      vm.runInNewContext(THEME_INIT_SCRIPT, ctx);
      return { dark: classes.has("dark"), scheme: root.style.colorScheme };
    };
    expect(run("", true)).toEqual({ dark: false, scheme: "light" }); // no saved choice: stays light even on a dark device
    expect(run("nafa_theme=dark", false)).toEqual({ dark: true, scheme: "dark" });
    expect(run("nafa_theme=light", true)).toEqual({ dark: false, scheme: "light" });
    expect(run("nafa_theme=system", true)).toEqual({ dark: true, scheme: "dark" });
    expect(run("nafa_theme=system", false)).toEqual({ dark: false, scheme: "light" });
    expect(() => vm.runInNewContext(THEME_INIT_SCRIPT, { document: {}, window: {} })).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// WCAG contrast, computed from the actual tokens in globals.css
// ---------------------------------------------------------------------------
function tokens(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  const body = css.slice(css.indexOf("{", start) + 1, css.indexOf("\n}", start));
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}
type RGB = [number, number, number];
const light = tokens(":root");
const dark = { ...light, ...tokens(".dark") };

function parse(v: string, over?: RGB): RGB {
  const hex = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(v);
  if (hex) {
    const n = parseInt(hex[1], 16);
    const rgb: RGB = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    if (!hex[2]) return rgb;
    const a = parseInt(hex[2], 16) / 255;
    const base = over ?? [255, 255, 255];
    return rgb.map((c, i) => c * a + base[i] * (1 - a)) as RGB;
  }
  const ok = /^oklch\(([\d.]+) 0 0\)$/.exec(v); // achromatic only: enough for the grey tokens
  if (ok) {
    const lin = Number(ok[1]) ** 3;
    const c = 255 * (lin <= 0.0031308 ? lin * 12.92 : 1.055 * lin ** (1 / 2.4) - 0.055);
    return [c, c, c];
  }
  throw new Error(`cannot parse colour ${v}`);
}
const lum = ([r, g, b]: RGB) => {
  const f = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const ratio = (a: RGB, b: RGB) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

function checks(t: Record<string, string>) {
  const resolve = (v: string): string => {
    const ref = /^var\(--([a-z0-9-]+)\)$/.exec(v);
    return ref ? resolve(t[ref[1]]) : v;
  };
  const c = (k: string, over?: RGB) => parse(resolve(t[k]), over);
  const surface = c("surface");
  const bg = c("background");
  const pairs: [string, RGB, RGB, number][] = [
    ["text on page", c("foreground"), bg, 7],
    ["text on card", c("foreground"), surface, 7],
    ["text on muted surface", c("foreground"), c("surface-muted"), 7],
    ["secondary text on card", c("muted-foreground"), surface, 4.5],
    ["secondary text on page", c("muted-foreground"), bg, 4.5],
    ["secondary text on muted surface", c("muted-foreground"), c("surface-muted"), 4.5],
    ["accent text on card", c("accent"), surface, 4.5],
    ["accent text on page", c("accent"), bg, 4.5],
    ["success on card", c("success"), surface, 4.5],
    ["warning on card", c("warning"), surface, 4.5],
    ["danger on card", c("danger"), surface, 4.5],
    ["info on card", c("info"), surface, 4.5],
    ["nav text on nav", c("nav-foreground"), c("nav"), 7],
    ["nav muted text on nav", c("nav-muted"), c("nav"), 4.5],
    ["nav text on active item", c("nav-foreground"), c("nav-active"), 4.5],
    ["accent button label", c("accent-foreground"), c("accent"), 4.5],
    ["primary button label", c("btn-primary-foreground"), c("btn-primary"), 4.5],
    ["primary button label (hover)", c("btn-primary-foreground"), c("btn-primary-hover"), 4.5],
    ["danger button label", c("danger-foreground"), c("danger"), 4.5],
    ["success badge", c("success"), c("success-soft", surface), 4.5],
    ["accent badge", c("accent"), c("accent-soft", surface), 4.5],
    ["warning badge", c("warning"), c("warning-soft", surface), 4.5],
    ["danger badge", c("danger"), c("danger-soft", surface), 4.5],
    ["info badge", c("info"), c("info-soft", surface), 4.5],
  ];
  return pairs.map(([name, fg, back, min]) => ({ name, ratio: Math.round(ratio(fg, back) * 100) / 100, min }));
}

describe("colour contrast (WCAG AA) from the real design tokens", () => {
  for (const [label, t] of [["light", light], ["dark", dark]] as const) {
    it(`${label} theme: every text / background pair meets its minimum`, () => {
      const failing = checks(t).filter((x) => x.ratio < x.min);
      expect(failing, JSON.stringify(failing, null, 1)).toEqual([]);
    });
  }

  it("dark theme uses the approved palette for its main surfaces and highlights", () => {
    expect(dark["background"].toLowerCase()).toBe("#111511"); // Dark Tone Ink
    expect(dark["nav"].toLowerCase()).toBe("#000100"); // Vantablack
    expect(dark["accent"].toLowerCase()).toBe("#eec679"); // Almond Cookie
    expect(dark["success"].toLowerCase()).toBe("#60e06e"); // Lightish Green
    expect(dark["border-strong"].toLowerCase()).toBe("#40433b"); // November Storms
    expect(dark["secondary-accent"].toLowerCase()).toBe("#697c68"); // Cricket Green
    expect(dark["foreground"].toLowerCase()).not.toBe("#ffffff"); // soft off-white, not pure white
  });
});
