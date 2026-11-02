"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Building2,
  CalendarClock,
  ChevronDown,
  FileText,
  LayoutDashboard,
  LogOut,
  Menu,
  Package,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Presentation,
  ReceiptText,
  Settings,
  Target,
  UserRound,
  Wallet,
  X,
  FolderKanban,
  HandCoins,
  Store,
  TrendingUp,
} from "lucide-react";
import { logout } from "@/lib/actions/auth";
import { NotificationBell } from "@/components/layout/notification-bell";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import type { ThemePreference } from "@/lib/theme";
import { initials } from "@/lib/format";
import { cn } from "@/lib/utils";

type NavItem = { href: string; label: string; icon: React.ComponentType<{ className?: string }>; exact?: boolean } | { section: string };

const NAV: NavItem[] = [
  { section: "Overview" },
  { href: "/", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { section: "CRM" },
  { href: "/leads", label: "Leads", icon: Target },
  { href: "/companies", label: "Companies", icon: Building2 },
  { href: "/contacts", label: "Contacts", icon: UserRound },
  { href: "/followups", label: "Follow-ups", icon: CalendarClock },
  { section: "Documents" },
  { href: "/quotations", label: "Quotations", icon: FileText },
  { href: "/proposals", label: "Proposals", icon: Presentation },
  { href: "/invoices", label: "Invoices", icon: ReceiptText },
  { section: "Project Finance" },
  { href: "/finance", label: "Finance Dashboard", icon: TrendingUp },
  { href: "/projects", label: "Projects", icon: FolderKanban },
  { href: "/finance/vendors", label: "Vendor Payments", icon: Store },
  { href: "/finance/reimbursements", label: "Reimbursements", icon: HandCoins },
  { section: "Operations" },
  { href: "/products-services", label: "Products & Services", icon: Package },
  { href: "/payments", label: "Payments", icon: Wallet },
  { section: "Administration" },
  { href: "/settings", label: "Settings", icon: Settings },
];

function NavLinks({ onNavigate, collapsed }: { onNavigate?: () => void; collapsed?: boolean }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="flex flex-col gap-0.5 px-2.5">
      {NAV.map((item, idx) => {
        if ("section" in item) {
          if (collapsed) return <div key={item.section} className="my-2 border-t border-nav-hover/60" />;
          return (
            <p
              key={item.section}
              className={cn(
                "px-2.5 pb-1 text-[11px] font-semibold uppercase tracking-wider text-nav-muted/80",
                idx === 0 ? "pt-2" : "pt-4",
              )}
            >
              {item.section}
            </p>
          );
        }
        const { href, label, icon: Icon, exact } = item;
        const active = exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            title={collapsed ? label : undefined}
            aria-current={active ? "page" : undefined}
            className={cn(
              "group relative flex h-9 items-center gap-3 rounded-md text-sm font-medium text-nav-muted transition-colors hover:bg-nav-hover hover:text-nav-foreground",
              collapsed ? "justify-center px-0" : "px-3",
              active && "bg-nav-active text-nav-foreground font-semibold shadow-xs",
            )}
          >
            <Icon className={cn("h-4 w-4 shrink-0 transition-transform group-hover:scale-105", active ? "text-accent" : "text-nav-muted")} aria-hidden />
            {!collapsed && <span className="truncate">{label}</span>}
            {active && (
              <span className="absolute left-0 top-1.5 bottom-1.5 w-1 rounded-r-full bg-accent" aria-hidden />
            )}
          </Link>
        );
      })}
    </nav>
  );
}

function Brand({ name, collapsed }: { name: string; collapsed?: boolean }) {
  return (
    <Link href="/" className={cn("flex items-center gap-3 py-4 text-nav-foreground group transition-colors", collapsed ? "justify-center px-2" : "px-5")}>
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-accent text-sm font-bold text-accent-foreground shadow-xs group-hover:brightness-110" aria-hidden>
        N
      </span>
      {!collapsed && (
        <span className="leading-tight overflow-hidden min-w-0">
          <span className="block text-sm font-semibold tracking-tight text-nav-foreground">NAFA Business OS</span>
          <span className="block max-w-[11.5rem] truncate text-[11px] text-nav-muted font-normal">{name}</span>
        </span>
      )}
    </Link>
  );
}

const ROUTE_LABELS: Record<string, string> = {
  "/": "Dashboard",
  "/leads": "Leads",
  "/leads/new": "New Lead",
  "/leads/import": "Import Leads",
  "/companies": "Companies",
  "/companies/new": "New Company",
  "/contacts": "Contacts",
  "/contacts/new": "New Contact",
  "/followups": "Follow-ups",
  "/quotations": "Quotations",
  "/quotations/new": "New Quotation",
  "/proposals": "Proposals",
  "/proposals/new": "New Proposal",
  "/invoices": "Invoices",
  "/invoices/new": "New Invoice",
  "/payments": "Payments",
  "/finance": "Finance Dashboard",
  "/finance/vendors": "Vendor Payments",
  "/finance/reimbursements": "Reimbursements",
  "/projects": "Projects",
  "/projects/new": "New Project",
  "/products-services": "Products & Services",
  "/settings": "Settings",
  "/settings/documents": "Document Settings",
  "/settings/app-installs": "App Installations",
};

function Breadcrumb() {
  const pathname = usePathname();
  const current = ROUTE_LABELS[pathname] || (pathname.startsWith("/projects/") ? "Project" : pathname.includes("/quotations/") ? "Quotation Details" : pathname.includes("/invoices/") ? "Invoice Details" : pathname.includes("/proposals/") ? "Proposal Details" : pathname.includes("/leads/") ? "Lead Details" : pathname.includes("/companies/") ? "Company Details" : pathname.includes("/contacts/") ? "Contact Details" : "NAFA Business OS");
  return (
    <div className="flex items-center gap-2 text-xs text-muted font-medium">
      <span className="hidden sm:inline text-muted/70">NAFA</span>
      <span className="hidden sm:inline text-muted/40" aria-hidden>/</span>
      <span className="text-foreground font-semibold">{current}</span>
    </div>
  );
}

export function AppShell({
  userName, userEmail, businessName, userId, isAdmin, theme, children,
}: {
  userName: string;
  userEmail: string;
  businessName: string;
  userId: string;
  isAdmin: boolean;
  theme: ThemePreference;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const createRef = useRef<HTMLDivElement>(null);
  const userRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (createRef.current && !createRef.current.contains(e.target as Node)) {
        setCreateOpen(false);
      }
      if (userRef.current && !userRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className="flex min-h-screen bg-background">
      {/* Desktop sidebar */}
      <aside
        className={cn(
          "sticky top-0 hidden h-screen shrink-0 flex-col bg-nav transition-[width] duration-200 ease-in-out lg:flex border-r border-nav-hover/60",
          collapsed ? "w-16" : "w-60",
        )}
      >
        <Brand name={businessName} collapsed={collapsed} />
        <div className="flex-1 overflow-y-auto overflow-x-hidden py-1">
          <NavLinks collapsed={collapsed} />
        </div>
        <div className="mt-auto border-t border-nav-hover/60 p-3">
          <button
            type="button"
            onClick={() => setCollapsed(!collapsed)}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className={cn(
              "flex h-8 w-full items-center rounded-md text-xs font-medium text-nav-muted hover:bg-nav-hover hover:text-nav-foreground transition-colors cursor-pointer",
              collapsed ? "justify-center px-0" : "justify-between px-2.5",
            )}
          >
            {!collapsed && <span>Collapse sidebar</span>}
            {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </button>
          {!collapsed && (
            <p className="mt-2 text-center text-[10px] text-nav-muted/60 font-medium">
              NAFA Events &amp; Activations
            </p>
          )}
        </div>
      </aside>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-xs" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-64 flex-col bg-nav shadow-2xl">
            <button
              className="absolute right-3 top-4 rounded-md p-1.5 text-nav-muted hover:bg-nav-hover hover:text-nav-foreground transition-colors cursor-pointer"
              onClick={() => setOpen(false)}
              aria-label="Close menu"
            >
              <X className="h-5 w-5" />
            </button>
            <Brand name={businessName} />
            <div className="flex-1 overflow-y-auto py-2">
              <NavLinks onNavigate={() => setOpen(false)} />
            </div>
            <div className="border-t border-nav-hover/60 p-4">
              <p className="text-center text-[11px] text-nav-muted font-medium">NAFA Events &amp; Activations</p>
            </div>
          </aside>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-border bg-surface/90 px-4 backdrop-blur-md sm:px-6">
          <div className="flex items-center gap-3">
            <button
              className="rounded-md p-1.5 text-foreground/80 hover:bg-surface-muted hover:text-foreground lg:hidden cursor-pointer"
              onClick={() => setOpen(true)}
              aria-label="Open menu"
            >
              <Menu className="h-5 w-5" />
            </button>
            <Breadcrumb />
          </div>

          <div className="flex items-center gap-2.5">
            <NotificationBell userId={userId} isAdmin={isAdmin} />
            {/* Quick Action Dropdown */}
            <div className="relative" ref={createRef}>
              <button
                type="button"
                onClick={() => setCreateOpen(!createOpen)}
                className="inline-flex h-8.5 items-center gap-1.5 rounded-md bg-btn-primary px-3 text-xs font-semibold text-btn-primary-foreground shadow-xs hover:bg-btn-primary-hover transition-colors cursor-pointer"
                aria-expanded={createOpen}
              >
                <Plus className="h-3.5 w-3.5" aria-hidden />
                <span>Create</span>
                <ChevronDown className={cn("h-3 w-3 text-nav-muted transition-transform", createOpen && "rotate-180")} aria-hidden />
              </button>

              {createOpen && (
                <div className="absolute right-0 mt-1.5 w-48 rounded-lg border border-border bg-surface p-1.5 shadow-lg z-40">
                  <p className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted">Quick Actions</p>
                  <Link
                    href="/leads/new"
                    onClick={() => setCreateOpen(false)}
                    className="flex h-8.5 items-center gap-2 rounded-md px-2.5 text-xs font-medium text-foreground hover:bg-surface-muted transition-colors"
                  >
                    <Target className="h-3.5 w-3.5 text-accent" />
                    <span>New Lead</span>
                  </Link>
                  <Link
                    href="/quotations/new"
                    onClick={() => setCreateOpen(false)}
                    className="flex h-8.5 items-center gap-2 rounded-md px-2.5 text-xs font-medium text-foreground hover:bg-surface-muted transition-colors"
                  >
                    <FileText className="h-3.5 w-3.5 text-accent" />
                    <span>New Quotation</span>
                  </Link>
                  <Link
                    href="/proposals/new"
                    onClick={() => setCreateOpen(false)}
                    className="flex h-8.5 items-center gap-2 rounded-md px-2.5 text-xs font-medium text-foreground hover:bg-surface-muted transition-colors"
                  >
                    <Presentation className="h-3.5 w-3.5 text-accent" />
                    <span>New Proposal</span>
                  </Link>
                  <Link
                    href="/invoices/new"
                    onClick={() => setCreateOpen(false)}
                    className="flex h-8.5 items-center gap-2 rounded-md px-2.5 text-xs font-medium text-foreground hover:bg-surface-muted transition-colors"
                  >
                    <ReceiptText className="h-3.5 w-3.5 text-accent" />
                    <span>New Invoice</span>
                  </Link>
                </div>
              )}
            </div>

            {/* User Profile Menu */}
            <div className="relative" ref={userRef}>
              <button
                type="button"
                onClick={() => setUserMenuOpen(!userMenuOpen)}
                className="flex h-8.5 w-8.5 cursor-pointer items-center justify-center rounded-full bg-nav text-xs font-semibold text-nav-foreground ring-1 ring-border-strong hover:ring-accent transition-all"
                aria-label="User account menu"
                aria-expanded={userMenuOpen}
              >
                {initials(userName)}
              </button>

              {userMenuOpen && (
                <div className="absolute right-0 mt-1.5 w-60 rounded-lg border border-border bg-surface p-1 shadow-xl z-40">
                  <div className="border-b border-border px-3 py-2.5">
                    <p className="truncate text-sm font-semibold text-foreground">{userName}</p>
                    <p className="truncate text-xs text-muted font-normal">{userEmail}</p>
                  </div>
                  <div className="py-1">
                    <Link
                      href="/settings"
                      onClick={() => setUserMenuOpen(false)}
                      className="flex h-8.5 items-center gap-2.5 rounded-md px-2.5 text-xs font-medium text-foreground hover:bg-surface-muted transition-colors"
                    >
                      <Settings className="h-3.5 w-3.5 text-muted" aria-hidden />
                      <span>Settings &amp; Business Info</span>
                    </Link>
                    <Link
                      href="/settings/documents"
                      onClick={() => setUserMenuOpen(false)}
                      className="flex h-8.5 items-center gap-2.5 rounded-md px-2.5 text-xs font-medium text-foreground hover:bg-surface-muted transition-colors"
                    >
                      <ReceiptText className="h-3.5 w-3.5 text-muted" aria-hidden />
                      <span>Document &amp; Bank Settings</span>
                    </Link>
                  </div>
                  <div className="border-t border-border px-2.5 py-2">
                    <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted">Appearance</p>
                    <ThemeToggle initial={theme} compact />
                  </div>
                  <div className="border-t border-border pt-1">
                    <form action={logout}>
                      <button
                        type="submit"
                        className="flex h-8.5 w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 text-xs font-medium text-danger hover:bg-danger-soft transition-colors"
                      >
                        <LogOut className="h-3.5 w-3.5" aria-hidden />
                        <span>Sign out</span>
                      </button>
                    </form>
                  </div>
                </div>
              )}
            </div>
          </div>
        </header>

        <main id="main" className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 sm:px-6 lg:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}