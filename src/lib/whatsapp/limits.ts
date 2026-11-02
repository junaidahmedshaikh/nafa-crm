/** Pure throttling and circuit-breaker rules for bulk sending. */

export type SendOutcome = { ok: boolean; code?: number };

/**
 * Meta error codes that mean "stop the whole campaign now", not "this one recipient failed".
 * They are about the account, the template, rate limits or the access token, so retrying only makes it worse.
 * Verify against Meta's current error-code reference when the live connection is set up.
 */
export const FATAL_CODES = new Set([
  130429, // rate limit hit
  131048, // spam rate limit hit (quality problem)
  131031, // account locked
  131042, // business payment issue
  132001, // template does not exist / not approved in that language
  132005, // translated text too long
  132007, // template format character policy violated
  132012, // parameter format mismatch
  132015, // template paused for low quality
  132016, // template disabled
  133010, // phone number not registered
  368, //    temporarily blocked for policy violations
  190, //    access token expired / invalid
]);

export function remainingToday(dailyLimit: number, sentLast24h: number): number {
  return Math.max(0, dailyLimit - sentLast24h);
}

/** How many to claim for the next batch. */
export function nextBatchSize(opts: { dailyLimit: number; sentLast24h: number; batchSize: number; queued: number }): number {
  return Math.max(0, Math.min(opts.batchSize, remainingToday(opts.dailyLimit, opts.sentLast24h), opts.queued));
}

export type BreakerVerdict = { trip: false } | { trip: true; reason: string };

/**
 * Looks at the results so far and decides whether to stop. Stops straight away on an account-level error,
 * after five failures in a row, or when more than 30% of at least ten attempts failed.
 */
export function circuitBreaker(results: SendOutcome[]): BreakerVerdict {
  const fatal = results.find((r) => !r.ok && r.code !== undefined && FATAL_CODES.has(r.code));
  if (fatal) return { trip: true, reason: `WhatsApp reported error ${fatal.code}, which affects the whole account or template. Sending was stopped to protect your number.` };
  let streak = 0;
  for (let i = results.length - 1; i >= 0 && !results[i].ok; i--) streak++;
  if (streak >= 5) return { trip: true, reason: "Five messages in a row failed. Sending was stopped so a problem does not damage your number's quality rating." };
  const failed = results.filter((r) => !r.ok).length;
  if (results.length >= 10 && failed / results.length > 0.3) {
    return { trip: true, reason: `${failed} of the last ${results.length} messages failed. Sending was stopped to protect your number.` };
  }
  return { trip: false };
}

export function estimateCost(count: number, perMessage: number | null): number | null {
  return perMessage == null ? null : Math.round(count * perMessage * 100) / 100;
}

/** Days needed to send `count` messages at `dailyLimit` per day, given what has already gone out today. */
export function daysToSend(count: number, dailyLimit: number, sentLast24h: number): number {
  const first = remainingToday(dailyLimit, sentLast24h);
  if (count <= first) return count === 0 ? 0 : 1;
  return 1 + Math.ceil((count - first) / dailyLimit);
}
