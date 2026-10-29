import { redirect } from "next/navigation";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getMember } from "@/lib/auth";
import { logout } from "@/lib/actions/auth";

export const metadata = { title: "No access" };
export const dynamic = "force-dynamic";

export default async function NoAccessPage() {
  const result = await getMember();
  if ("ctx" in result) redirect("/");
  if (result.reason === "anonymous") redirect("/login");
  return (
    <div className="flex min-h-screen items-center justify-center bg-nav px-4">
      <div className="w-full max-w-md rounded-lg bg-surface p-8 text-center shadow-xl">
        <ShieldAlert className="mx-auto mb-3 h-8 w-8 text-warning" aria-hidden />
        <h1 className="text-lg font-semibold">Access not granted</h1>
        <p className="mt-2 text-sm text-muted">
          You are signed in, but this account has not been authorised for NAFA Business OS. Ask the administrator to enable it,
          then sign in again.
        </p>
        <form action={logout} className="mt-6">
          <Button type="submit" variant="primary">Sign out</Button>
        </form>
      </div>
    </div>
  );
}
