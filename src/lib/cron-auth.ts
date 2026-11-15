import { timingSafeEqual } from "node:crypto";

/**
 * Scheduled routes are called without a session, so each one must present `Authorization: Bearer $CRON_SECRET`.
 * Compared in constant time; with no secret configured every call is refused.
 */
export function cronAuthorised(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  return given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}
