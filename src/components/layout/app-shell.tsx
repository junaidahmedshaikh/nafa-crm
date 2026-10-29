"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Building2, CalendarClock, FileText, LayoutDashboard, LogOut, Menu, Package, Plus, Presentation, ReceiptText, Settings, Target, UserRound, Wallet, X } from "lucide-react";
import { logout } from "@/lib/actions/auth";
import { initials } from "@/lib/format";
import { cn } from "@/lib/utils";

type NavItem = { href: string; label: string; icon: React.ComponentType<{ className?: string }>; exact?: boolean } | { section: string };
const NAV: NavItem[] = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { href: "/leads", label: "Leads", icon: Target },
  { href: "/companies", label: "Companies", icon: Building2 },
  { href: "/contacts", label: "Contacts", icon: UserRound },
  { href: "/followups", label: "Follow-ups", icon: CalendarClock },
  { section: "Documents" },
  { href: "/quotations", label: "Quotations", icon: FileText },
  { href: "/proposals", label: "Proposals", icon: Presentation },
  { href: "/invoices", label: "Invoices", icon: ReceiptText },
  { href: "/payments", label: "Payments", icon: Wallet },
  { href: "/products-services", label: "Products & Services", icon: Package },
  { section: "Admin" },
  { href: "/settings", label: "Settings", icon: Settings },
];

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="flex flex-col gap-0.5 px-3">
      {NAV.map((item) => {
        if ("section" in item) return <p key={item.section} className="mt-4 px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-nav-muted/70">{item.section}</p>;
        const { href, label, icon: Icon, exact } = item;
        const active = exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex h-9 items-center gap-3 rounded-md px-3 text-sm text-nav-muted transition-colors hover:bg-nav-hover hover:text-nav-foreground",
              active && "bg-nav-active text-nav-foreground",
            )}
          >
            <Icon className="h-4 w-4 shrink-0" aria-hidden />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

function Brand({ name }: { name: string }) {
  return (
    <Link href="/" className="flex items-center gap-2.5 px-6 py-5 text-nav-foreground">
      <span className="flex h-7 w-7 items-center justify-center rounded bg-accent text-sm font-bold text-white" aria-hidden>N</span>
      <span className="leading-tight">
        <span className="block text-sm font-semibold tracking-wide">NAFA Business OS</span>
        <span className="block max-w-[11rem] truncate text-[11px] text-nav-muted">{name}</span>
      </span>
    </Link>
  );
}

export function AppShell({
  userName, userEmail, businessName, children,
}: {
  userName: string;
  userEmail: string;
  businessName: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex min-h-screen">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col bg-nav lg:flex">
        <Brand name={businessName} />
        <NavLinks />
        <p className="mt-auto px-6 py-4 text-[11px] text-nav-muted">Phase 1 · Internal use only</p>
      </aside>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-64 flex-col bg-nav">
            <button className="absolute right-3 top-4 rounded p-1 text-nav-muted hover:text-nav-foreground" onClick={() => setOpen(false)} aria-label="Close menu">
              <X className="h-5 w-5" />
            </button>
            <Brand name={businessName} />
            <NavLinks onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-surface/95 px-4 backdrop-blur sm:px-6">
          <button className="rounded p-1.5 hover:bg-black/5 lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu">
            <Menu className="h-5 w-5" />
          </button>
          <div className="flex-1" />
          <Link
            href="/leads/new"
            className="inline-flex h-9 items-center gap-2 rounded-md bg-nav px-4 text-sm font-medium text-nav-foreground hover:bg-nav-active"
          >
            <Plus className="h-4 w-4" aria-hidden />
            <span className="hidden sm:inline">New lead</span>
            <span className="sr-only sm:hidden">New lead</span>
          </Link>
          <details className="relative">
            <summary
              className="flex h-9 w-9 cursor-pointer list-none items-center justify-center rounded-full bg-nav text-xs font-semibold text-nav-foreground [&::-webkit-details-marker]:hidden"
              aria-label="Account menu"
            >
              {initials(userName)}
            </summary>
            <div className="absolute right-0 mt-2 w-60 rounded-md border border-border bg-surface p-1 shadow-lg">
              <div className="border-b border-border px-3 py-2">
                <p className="truncate text-sm font-medium">{userName}</p>
                <p className="truncate text-xs text-muted">{userEmail}</p>
              </div>
              <Link href="/settings" className="flex h-9 items-center gap-2 rounded px-3 text-sm hover:bg-black/5">
                <Settings className="h-4 w-4" aria-hidden /> Settings
              </Link>
              <form action={logout}>
                <button type="submit" className="flex h-9 w-full cursor-pointer items-center gap-2 rounded px-3 text-sm hover:bg-black/5">
                  <LogOut className="h-4 w-4" aria-hidden /> Sign out
                </button>
              </form>
            </div>
          </details>
        </header>
        <main id="main" className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 sm:px-6">{children}</main>
      </div>
    </div>
  );
}
