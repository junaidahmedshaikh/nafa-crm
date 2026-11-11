"use client";

import { useEffect, useState, useTransition } from "react";
import { Bell, BellOff } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { removePushSubscription, savePushSubscription, sendTestPush } from "@/lib/actions/push";
import { detectDevice } from "@/lib/pwa/device";
import { urlBase64ToUint8Array } from "@/lib/pwa/push-client";

type State = "loading" | "unsupported" | "needs-install" | "denied" | "off" | "on";

/** Turns push notifications on/off for THIS device. Nothing is requested until the button is pressed. */
export function PushToggle({ publicKey }: { publicKey: string | null }) {
  const [state, setState] = useState<State>("loading");
  const [pending, start] = useTransition();

  useEffect(() => {
    (async () => {
      if (!publicKey || !("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        // iPhone/iPad only expose push to an app added to the Home Screen.
        const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
        setState(ios && !window.matchMedia("(display-mode: standalone)").matches ? "needs-install" : "unsupported");
        return;
      }
      if (Notification.permission === "denied") return setState("denied");
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      setState(sub && Notification.permission === "granted" ? "on" : "off");
    })().catch(() => setState("unsupported"));
  }, [publicKey]);

  function enable() {
    start(async () => {
      try {
        const perm = await Notification.requestPermission();
        if (perm !== "granted") {
          setState(perm === "denied" ? "denied" : "off");
          toast.error("Notifications were not allowed.");
          return;
        }
        const reg = (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register("/sw.js"));
        await navigator.serviceWorker.ready;
        const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey!) as BufferSource }));
        const j = sub.toJSON();
        const res = await savePushSubscription({
          endpoint: sub.endpoint, p256dh: j.keys?.p256dh ?? "", auth: j.keys?.auth ?? "",
          platform: detectDevice(navigator.userAgent, { maxTouchPoints: navigator.maxTouchPoints }).platform,
        });
        if (!res.ok) {
          await sub.unsubscribe();
          toast.error(res.error);
          return;
        }
        setState("on");
        toast.success("Notifications turned on for this device");
      } catch (e) {
        toast.error(`Could not turn on notifications: ${(e as Error).message}`);
      }
    });
  }

  function disable() {
    start(async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await removePushSubscription(sub.endpoint);
        await sub.unsubscribe();
      }
      setState("off");
      toast.success("Notifications turned off for this device");
    });
  }

  const msg: Record<State, string> = {
    loading: "Checking…",
    unsupported: "This browser does not support push notifications. Try Chrome, Edge, or Safari (installed app).",
    "needs-install": "On iPhone/iPad, first add NAFA CRM to your Home Screen (Share → Add to Home Screen), open it from there, then turn notifications on.",
    denied: "Notifications are blocked for this site. Allow them in your browser or phone site settings, then come back.",
    off: "Get alerts for new replies, your morning briefing and finished campaigns, even when the app is closed.",
    on: "Notifications are on for this device.",
  };
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <p className="text-sm font-semibold">Push notifications</p>
      <p className="mb-3 mt-0.5 text-xs text-muted">{msg[state]}</p>
      <div className="flex flex-wrap gap-2">
        {state === "off" && <Button variant="primary" loading={pending} onClick={enable}><Bell className="h-4 w-4" aria-hidden />Turn on notifications</Button>}
        {state === "on" && (
          <>
            <Button loading={pending} onClick={() => start(async () => { const r = await sendTestPush(); if (r.ok) toast.success("Test sent — check your notifications"); else toast.error(r.error); })}>Send test</Button>
            <Button variant="outline" disabled={pending} onClick={disable}><BellOff className="h-4 w-4" aria-hidden />Turn off</Button>
          </>
        )}
      </div>
    </div>
  );
}
