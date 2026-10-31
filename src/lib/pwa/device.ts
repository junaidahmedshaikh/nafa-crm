/**
 * Coarse device facts for installation tracking. Only a platform family and a browser name are derived;
 * the raw user-agent string is never sent to or stored by the server.
 */
export type Platform = "android" | "ios" | "windows" | "macos" | "linux" | "other";

export const PLATFORM_LABELS: Record<Platform, string> = {
  android: "Android", ios: "iOS", windows: "Windows", macos: "macOS", linux: "Linux", other: "Other",
};
export const DESKTOP_PLATFORMS: Platform[] = ["windows", "macos", "linux"];

export function detectDevice(ua: string, opts: { maxTouchPoints?: number } = {}): { platform: Platform; browser: string } {
  const u = ua || "";
  let platform: Platform = "other";
  if (/Android/i.test(u)) platform = "android";
  else if (/iPhone|iPad|iPod/i.test(u)) platform = "ios";
  else if (/Macintosh|Mac OS X/i.test(u)) platform = (opts.maxTouchPoints ?? 0) > 1 ? "ios" : "macos"; // iPadOS reports itself as a Mac
  else if (/Windows/i.test(u)) platform = "windows";
  else if (/CrOS|Linux|X11/i.test(u)) platform = "linux";

  let browser = "Other";
  if (/EdgiOS|EdgA|Edg\//.test(u)) browser = "Edge";
  else if (/OPR\/|OPiOS|Opera/.test(u)) browser = "Opera";
  else if (/SamsungBrowser/.test(u)) browser = "Samsung Internet";
  else if (/FxiOS|Firefox\//.test(u)) browser = "Firefox";
  else if (/CriOS|Chrome\//.test(u)) browser = "Chrome";
  else if (/Safari\//.test(u) && /Version\//.test(u)) browser = "Safari";
  return { platform, browser };
}

/** True when the page is running as an installed app (any platform), not as a normal browser tab. */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return (
    nav.standalone === true || // iOS home-screen apps
    window.matchMedia?.("(display-mode: standalone)").matches === true ||
    window.matchMedia?.("(display-mode: window-controls-overlay)").matches === true ||
    window.matchMedia?.("(display-mode: minimal-ui)").matches === true
  );
}

export type InstallEvent = "installed" | "launched" | "active";
export type InstallReport = { device_id: string; platform: Platform; browser: string; source: "pwa" | "home_screen"; event: InstallEvent };
