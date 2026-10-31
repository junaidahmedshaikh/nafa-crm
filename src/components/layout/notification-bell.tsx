"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { Bell, MonitorSmartphone } from "lucide-react";
import { createClient } from "@/lib/client";
import { markNotificationsRead } from "@/lib/actions/notifications";
import { formatDateTime } from "@/lib/datetime";
import { PLATFORM_LABELS, type Platform } from "@/lib/pwa/device";
import { cn } from "@/lib/utils";

type Item = { id: string; type: string; title: string; body: string; data: Record<string, unknown>; read_at: string | null; created_at: string };

/** Header bell: unread badge, latest notifications, live updates over Supabase Realtime with a 60 s polling fallback. */
export function NotificationBell({ userId, isAdmin }: { userId: string; isAdmin: boolean }) {
  const [items, setItems] = useState<Item[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const ref = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const sb = createClient();
    const [list, count] = await Promise.all([
      sb.from("notifications").select("id, type, title, body, data, read_at, created_at").order("created_at", { ascending: false }).limit(15),
      sb.from("notifications").select("id", { count: "exact", head: true }).is("read_at", null),
    ]);
    if (!list.error) setItems((list.data ?? []) as Item[]);
    if (!count.error) setUnread(count.count ?? 0);
  }, []);

  useEffect(() => {
    const first = setTimeout(() => void load(), 0);
    const sb = createClient();
    const channel = sb
      .channel(`notifications:${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` }, () => void load())
      .subscribe();
    const timer = setInterval(() => void load(), 60_000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
      void sb.removeChannel(channel);
    };
  }, [userId, load]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function readAll() {
    startTransition(async () => {
      await markNotificationsRead();
      await load();
    });
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="relative inline-flex h-8.5 w-8.5 items-center justify-center rounded-md text-foreground/80 hover:bg-surface-muted hover:text-foreground cursor-pointer"
        aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
        aria-expanded={open}
      >
        <Bell className="h-4.5 w-4.5" aria-hidden />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold leading-none text-white">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="fixed inset-x-3 top-14 z-50 rounded-lg border border-border bg-surface shadow-lg sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-1.5 sm:w-96">
          <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
            <p className="text-sm font-semibold">Notifications</p>
            {unread > 0 && (
              <button type="button" onClick={readAll} disabled={pending} className="text-xs font-medium text-accent hover:underline disabled:opacity-60">
                Mark all as read
              </button>
            )}
          </div>
          <ul className="max-h-96 divide-y divide-border overflow-y-auto">
            {items.length === 0 && <li className="px-4 py-8 text-center text-sm text-muted">You&apos;re all caught up.</li>}
            {items.map((n) => {
              const d = n.data as { platform?: Platform; browser?: string; user_email?: string; installed_at?: string; first_launch_at?: string | null };
              const isInstall = n.type === "app_install";
              const body = (
                <div className="flex gap-3">
                  <span className={cn("mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full", n.read_at ? "bg-black/5 text-muted" : "bg-accent-soft text-accent")}>
                    <MonitorSmartphone className="h-4 w-4" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className={cn("text-sm", !n.read_at && "font-semibold")}>{n.title}</p>
                    <p className="mt-0.5 text-xs text-foreground/80">{n.body}</p>
                    {isInstall ? (
                      <p className="mt-1 text-[11px] leading-relaxed text-muted">
                        {d.user_email ? `${d.user_email} · ` : ""}
                        {d.platform ? PLATFORM_LABELS[d.platform] : ""}
                        {d.browser ? ` · ${d.browser}` : ""}
                        <br />
                        Installed {formatDateTime(d.installed_at ?? n.created_at)} · {d.first_launch_at ? `first opened ${formatDateTime(d.first_launch_at)}` : "not opened yet"}
                      </p>
                    ) : (
                      <p className="mt-1 text-[11px] text-muted">{formatDateTime(n.created_at)}</p>
                    )}
                  </div>
                  {!n.read_at && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-accent" aria-label="Unread" />}
                </div>
              );
              return (
                <li key={n.id}>
                  {isInstall && isAdmin ? (
                    <Link href="/settings/app-installs" onClick={() => setOpen(false)} className="block px-4 py-3 hover:bg-surface-muted">
                      {body}
                    </Link>
                  ) : (
                    <div className="px-4 py-3">{body}</div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
