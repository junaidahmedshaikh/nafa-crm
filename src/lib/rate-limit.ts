import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Server-side throttling backed by the database (works across serverless instances).
 * Returns true when the request may proceed.
 *  - failClosed: true  -> if the limiter itself is unavailable, REFUSE (use for anything that sends email).
 *  - failClosed: false -> if the limiter is unavailable, allow (use for AI / login so an outage cannot lock everyone out).
 */
export async function rateLimit(key: string, max: number, windowSeconds: number, opts: { failClosed?: boolean } = {}): Promise<boolean> {
  try {
    const { data, error } = await createAdminClient().rpc("rate_limit_hit", { p_key: key.slice(0, 200), p_max: max, p_window_seconds: windowSeconds });
    if (error) {
      // PGRST202 = the function does not exist yet (security migration not applied): do not block the app, but say so loudly.
      if (error.code === "PGRST202") { console.error("[rate-limit] rate_limit_hit() is missing - apply migration 20261116000001_security_hardening.sql"); return true; }
      throw new Error(error.message);
    }
    return data === true;
  } catch (e) {
    console.error("[rate-limit unavailable]", (e as Error).message);
    return !opts.failClosed;
  }
}

export const TOO_MANY = "You are doing that too often. Please wait a few minutes and try again.";

/** Named policies so limits are consistent and easy to tune in one place. */
export const LIMITS = {
  ai: { max: 40, window: 600 },            // Gemini calls per user per 10 min
  chat: { max: 25, window: 600 },
  testEmail: { max: 10, window: 3600 },    // e-mail test sends per user per hour
  replyEmail: { max: 40, window: 3600 },
  import: { max: 10, window: 3600 },
  heavy: { max: 60, window: 3600 },        // recipient rebuilds / mailbox checks
  loginIp: { max: 30, window: 900 },
  loginEmail: { max: 8, window: 900 },
} as const;

export async function limitUser(userId: string, bucket: keyof typeof LIMITS, opts: { failClosed?: boolean } = {}): Promise<boolean> {
  const l = LIMITS[bucket];
  return rateLimit(`u:${userId}:${bucket}`, l.max, l.window, opts);
}
