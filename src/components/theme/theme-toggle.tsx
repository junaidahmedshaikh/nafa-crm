"use client";

import { useEffect, useSyncExternalStore, useTransition } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { toast } from "sonner";
import { saveThemePreference } from "@/lib/actions/theme";
import { THEME_LABELS, THEME_PREFERENCES, applyTheme, persistThemeCookie, type ThemePreference } from "@/lib/theme";
import { cn } from "@/lib/utils";

const ICONS = { light: Sun, dark: Moon, system: Monitor } as const;

// The preference the user has chosen in this tab. The server-rendered value (from their profile) is the starting point;
// once they pick something here it takes over, so every toggle on the page and the device-change listener stay in step.
let chosen: ThemePreference | null = null;
const listeners = new Set<() => void>();
const setChosen = (p: ThemePreference) => {
  chosen = p;
  listeners.forEach((fn) => fn());
};
function useThemePreference(fromServer: ThemePreference): ThemePreference {
  return useSyncExternalStore(
    (fn) => { listeners.add(fn); return () => { listeners.delete(fn); }; },
    () => chosen ?? fromServer,
    () => fromServer,
  );
}

/** Keeps the page in step with the saved preference: after sign-in on a new device, and when the device's appearance changes (System default). */
export function ThemeSync({ preference }: { preference: ThemePreference }) {
  const pref = useThemePreference(preference);
  useEffect(() => {
    persistThemeCookie(pref);
    applyTheme(pref);
    if (pref !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("system", { animate: true });
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [pref]);
  return null;
}

/** Light / Dark / System default. Applies instantly, then saves to the user's profile. */
export function ThemeToggle({ initial, compact = false }: { initial: ThemePreference; compact?: boolean }) {
  const pref = useThemePreference(initial);
  const [, startTransition] = useTransition();

  function choose(next: ThemePreference) {
    if (next === pref) return;
    setChosen(next);
    applyTheme(next, { animate: true });
    persistThemeCookie(next);
    startTransition(async () => {
      const r = await saveThemePreference(next);
      if (!r.ok) toast.error(r.error);
    });
  }

  return (
    <div role="radiogroup" aria-label="Colour theme" className={cn("inline-flex rounded-md border border-border-strong bg-surface-muted p-0.5", compact && "w-full")}>
      {THEME_PREFERENCES.map((t) => {
        const Icon = ICONS[t];
        const active = pref === t;
        return (
          <button
            key={t}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => choose(t)}
            title={THEME_LABELS[t]}
            className={cn(
              "inline-flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded px-2.5 py-1.5 text-xs font-medium transition-colors",
              active ? "bg-surface text-foreground shadow-xs ring-1 ring-border-strong" : "text-muted hover:text-foreground",
            )}
          >
            <Icon className={cn("h-3.5 w-3.5", active && "text-accent")} aria-hidden />
            {compact ? THEME_LABELS[t].replace(" default", "") : THEME_LABELS[t]}
          </button>
        );
      })}
    </div>
  );
}
