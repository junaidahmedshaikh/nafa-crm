/**
 * Theme handling shared by the server (initial class), the inline pre-paint script and the toggle.
 * The saved preference lives in profiles.theme_preference (so it follows the user to any device) and is mirrored in a
 * cookie so the very first paint is already correct, with no flash of the wrong theme.
 */
export const THEME_COOKIE = "nafa_theme";
export const THEME_PREFERENCES = ["light", "dark", "system"] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];
export type ResolvedTheme = "light" | "dark";

/** Nobody's existing look changes: until someone chooses otherwise the theme stays light. */
export const DEFAULT_THEME: ThemePreference = "light";

export const THEME_LABELS: Record<ThemePreference, string> = { light: "Light", dark: "Dark", system: "System default" };

export const isThemePreference = (v: unknown): v is ThemePreference => typeof v === "string" && (THEME_PREFERENCES as readonly string[]).includes(v);

export const resolveTheme = (pref: ThemePreference, systemPrefersDark: boolean): ResolvedTheme =>
  pref === "dark" || (pref === "system" && systemPrefersDark) ? "dark" : "light";

export function readThemeCookie(cookieHeader: string): ThemePreference {
  const m = new RegExp(`(?:^|;\\s*)${THEME_COOKIE}=([^;]*)`).exec(cookieHeader);
  return m && isThemePreference(m[1]) ? m[1] : DEFAULT_THEME;
}

/** Runs in <head> before the first paint. Keep in step with resolveTheme / readThemeCookie above. */
export const THEME_INIT_SCRIPT = `(function(){try{var m=document.cookie.match(/(?:^|;\\s*)${THEME_COOKIE}=(light|dark|system)/);var p=m?m[1]:"${DEFAULT_THEME}";var d=p==="dark"||(p==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches);var e=document.documentElement;e.classList.toggle("dark",d);e.style.colorScheme=d?"dark":"light";}catch(_){}})();`;

// ---------------------------------------------------------------------------
// Browser only
// ---------------------------------------------------------------------------
export function persistThemeCookie(pref: ThemePreference) {
  document.cookie = `${THEME_COOKIE}=${pref}; path=/; max-age=31536000; samesite=lax${location.protocol === "https:" ? "; secure" : ""}`;
}

export function applyTheme(pref: ThemePreference, opts: { animate?: boolean } = {}) {
  const root = document.documentElement;
  const dark = resolveTheme(pref, window.matchMedia("(prefers-color-scheme: dark)").matches) === "dark";
  if (root.classList.contains("dark") === dark) return;
  if (opts.animate) {
    root.classList.add("theme-transition");
    window.setTimeout(() => root.classList.remove("theme-transition"), 250);
  }
  root.classList.toggle("dark", dark);
  root.style.colorScheme = dark ? "dark" : "light";
}
