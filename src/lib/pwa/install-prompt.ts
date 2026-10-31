import { useSyncExternalStore } from "react";

/** Holds Chrome/Edge's deferred `beforeinstallprompt` event so an "Install app" button can use it later (no automatic pop-up). */
export type DeferredPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

let deferred: DeferredPrompt | null = null;
const subscribers = new Set<() => void>();
const emit = () => subscribers.forEach((fn) => fn());

export function setDeferredPrompt(e: DeferredPrompt | null) {
  deferred = e;
  emit();
}
export function useDeferredPrompt(): DeferredPrompt | null {
  return useSyncExternalStore(
    (fn) => { subscribers.add(fn); return () => { subscribers.delete(fn); }; },
    () => deferred,
    () => null,
  );
}
