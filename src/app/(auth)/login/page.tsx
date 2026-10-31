import type { Metadata } from "next";
import { safeNextPath } from "@/lib/safe-redirect";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const notice = one(sp.reason) === "expired" ? "Your session has expired. Please sign in again." : undefined;

  return (
    <div className="flex min-h-screen items-center justify-center bg-nav px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center text-nav-foreground">
          <span className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded bg-accent text-lg font-bold text-accent-foreground" aria-hidden>N</span>
          <h1 className="text-lg font-semibold tracking-wide">NAFA Business OS</h1>
          <p className="text-sm text-nav-muted">NAFA Events &amp; Activations · Internal access only</p>
        </div>
        <div className="rounded-lg bg-surface p-6 shadow-xl">
          <h2 className="mb-4 text-base font-semibold">Sign in</h2>
          <LoginForm next={safeNextPath(one(sp.next))} notice={notice} />
        </div>
        <p className="mt-4 text-center text-xs text-nav-muted">Accounts are created by the administrator. There is no public sign-up.</p>
      </div>
    </div>
  );
}
