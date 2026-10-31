"use client";

import { useEffect, useState } from "react";
import { Download, MonitorSmartphone, Share } from "lucide-react";
import { Button } from "@/components/ui/button";
import { detectDevice, isStandalone } from "@/lib/pwa/device";
import { setDeferredPrompt, useDeferredPrompt } from "@/lib/pwa/install-prompt";

/** Settings card: an Install button where the browser supports it, and Add-to-Home-Screen steps for iPhone/iPad. No pop-ups. */
export function InstallCard() {
  const prompt = useDeferredPrompt();
  const [state, setState] = useState<"unknown" | "installed" | "ios" | "other">("unknown");

  useEffect(() => {
    const { platform } = detectDevice(navigator.userAgent, { maxTouchPoints: navigator.maxTouchPoints });
    // Runs once on mount: the environment is only known in the browser.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState(isStandalone() ? "installed" : platform === "ios" ? "ios" : "other");
  }, []);

  if (state === "unknown") return null;
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent"><MonitorSmartphone className="h-4.5 w-4.5" aria-hidden /></span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Install the NAFA CRM app</p>
          {state === "installed" && <p className="mt-0.5 text-xs text-muted">You are using the installed app on this device.</p>}
          {state === "ios" && (
            <p className="mt-0.5 text-xs text-muted">
              On iPhone or iPad, open this page in Safari, tap <Share className="mx-0.5 inline h-3.5 w-3.5" aria-label="Share" />, then choose <strong>Add to Home Screen</strong>. Open the app once from your home screen to finish.
            </p>
          )}
          {state === "other" && prompt && (
            <>
              <p className="mt-0.5 text-xs text-muted">Opens in its own window with an app icon. Your administrators are notified when you install it.</p>
              <Button
                className="mt-3"
                variant="primary"
                size="sm"
                onClick={async () => {
                  await prompt.prompt();
                  await prompt.userChoice.catch(() => null);
                  setDeferredPrompt(null);
                }}
              >
                <Download className="h-4 w-4" aria-hidden />
                Install app
              </Button>
            </>
          )}
          {state === "other" && !prompt && (
            <p className="mt-0.5 text-xs text-muted">
              Use your browser&apos;s menu: <strong>Install app</strong> (Chrome / Edge on desktop and Android), or open the site in Chrome or Edge if you do not see it.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
