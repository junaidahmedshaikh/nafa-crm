"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/safe-redirect";
import { cookies } from "next/headers";
import { THEME_COOKIE } from "@/lib/theme";
import { getThemePreference } from "@/lib/theme-server";
import { headers } from "next/headers";
import { createHash } from "node:crypto";
import { LIMITS, rateLimit } from "@/lib/rate-limit";

const loginSchema = z.object({
  email: z.email("Enter a valid email address").max(254),
  password: z.string().min(1, "Enter your password").max(200),
});

export type LoginState = { error?: string; email?: string };

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = loginSchema.safeParse({ email: String(formData.get("email") ?? "").trim(), password: String(formData.get("password") ?? "") });
  const email = String(formData.get("email") ?? "");
  if (!parsed.success) return { error: parsed.error.issues[0].message, email };

  // Brute-force protection: per client address and per account (hashed, so the e-mail is never stored in the limiter).
  const h = await headers();
  const ip = (h.get("x-forwarded-for") ?? "unknown").split(",")[0].trim().slice(0, 64);
  const acct = createHash("sha256").update(parsed.data.email.toLowerCase()).digest("hex").slice(0, 32);
  const [okIp, okAcct] = await Promise.all([
    rateLimit(`login:ip:${ip}`, LIMITS.loginIp.max, LIMITS.loginIp.window),
    rateLimit(`login:acct:${acct}`, LIMITS.loginEmail.max, LIMITS.loginEmail.window),
  ]);
  if (!okIp || !okAcct) return { error: "Too many sign-in attempts. Please wait 15 minutes and try again.", email };

  const supabase = await createClient();
  const { data: signedIn, error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    console.error("[login]", error.code, error.status, error.message);
    // Credential failures stay generic (never reveal whether an account exists);
    // setup problems get an actionable message.
    let message: string;
    if (error.code === "invalid_credentials") message = "Incorrect email or password.";
    else if (error.code === "email_not_confirmed") message = "This email is not confirmed. In Supabase → Authentication → Users, confirm the user (or recreate it with “Auto Confirm User”).";
    else if (error.status === 429) message = "Too many attempts. Please wait a minute and try again.";
    else if (error.status === 401 || error.code === "bad_jwt" || /api key/i.test(error.message)) message = "Supabase rejected the API key. Check NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY in .env.local and restart the dev server.";
    else if (!error.status) message = "Could not reach Supabase. Check NEXT_PUBLIC_SUPABASE_URL in .env.local and your connection.";
    else message = `Sign-in failed (${error.code ?? error.status}).`;
    return { error: message, email };
  }
  if (signedIn?.user) {
    (await cookies()).set(THEME_COOKIE, await getThemePreference(supabase, signedIn.user.id), { path: "/", maxAge: 31536000, sameSite: "lax", httpOnly: false });
  }
  redirect(safeNextPath(String(formData.get("next") ?? "")));
}

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
