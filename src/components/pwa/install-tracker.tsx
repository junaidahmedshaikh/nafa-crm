"use client";

import { useEffect } from "react";
import { detectDevice, isStandalone, type InstallEvent, type InstallReport } from "@/lib/pwa/device";
import { setDeferredPrompt, type DeferredPrompt } from "@/lib/pwa/install-prompt";

const DEVICE_KEY = "nafa_device_id";
const HEARTBEAT_MS = 6 * 60 * 60 * 1000;

const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode: tracking simply degrades */ } };

/** Random per-browser identifier; carries no information about the person or the hardware. */
function deviceId(): string {
  let id = read(DEVICE_KEY);
  if (!id || id.length < 16) {
    id = (globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`).slice(0, 64);
    write(DEVICE_KEY, id);
  }
  return id;
}

async function report(event: InstallEvent): Promise<boolean> {
  const { platform, browser } = detectDevice(navigator.userAgent, { maxTouchPoints: navigator.maxTouchPoints });
  const body: InstallReport = { device_id: deviceId(), platform, browser, source: platform === "ios" ? "home_screen" : "pwa", event };
  try {
    const res = await fetch("/api/app-install", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), keepalive: true });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Invisible. Registers the service worker, keeps the install prompt for the Install button (never shows a pop-up),
 * reports `appinstalled`, and, when the app is running as an installed app, reports the first launch and a throttled heartbeat.
 * A normal browser visit reports nothing.
 */
export function InstallTracker({ userId }: { userId: string }) {
  useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});

    const onPrompt = (e: Event) => { e.preventDefault(); setDeferredPrompt(e as DeferredPrompt); };
    const onInstalled = () => { setDeferredPrompt(null); void report("installed"); };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);

    if (isStandalone()) {
      const launchedKey = `nafa_launched_${userId}`;
      const beatKey = `nafa_beat_${userId}`;
      if (!read(launchedKey)) {
        // First time this user opens the installed app on this device (also how iOS home-screen installs are detected).
        void report("launched").then((ok) => { if (ok) write(launchedKey, String(Date.now())); });
      } else if (Date.now() - Number(read(beatKey) ?? 0) > HEARTBEAT_MS) {
        write(beatKey, String(Date.now()));
        void report("active");
      }
    }
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, [userId]);
  return null;
}
