/**
 * Server-side Gemini client (REST, no SDK). The key never reaches the browser:
 *   GEMINI_API_KEY  – required; without it the AI features degrade to the rule-based results.
 *   GEMINI_MODEL    – optional, default "gemini-3.8-flash".
 * Retries transient failures (429 / 5xx / network) with exponential back-off.
 */
export const geminiConfigured = () => !!process.env.GEMINI_API_KEY;

export type GeminiResult = { ok: true; text: string; model: string } | { ok: false; error: string; code: "not_configured" | "failed" };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function geminiGenerate(opts: {
  system: string;
  prompt: string;
  json?: boolean;
  temperature?: number;
  maxAttempts?: number;
  timeoutMs?: number;
}): Promise<GeminiResult> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return { ok: false, code: "not_configured", error: "Gemini is not configured (set GEMINI_API_KEY)." };
  // Alternate between the primary and a fallback model so one overloaded model does not fail the request.
  const models = [...new Set([process.env.GEMINI_MODEL || "gemini-3.8-flash", "gemini-flash-latest"])];
  const attempts = opts.maxAttempts ?? 4;
  let lastError = "Unknown error";
  let model = models[0];
  for (let i = 1; i <= attempts; i++) {
    model = models[(i - 1) % models.length];
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: opts.system }] },
          contents: [{ role: "user", parts: [{ text: opts.prompt }] }],
          generationConfig: {
            temperature: opts.temperature ?? 0.3,
            ...(opts.json ? { responseMimeType: "application/json" } : {}),
          },
        }),
        signal: AbortSignal.timeout(opts.timeoutMs ?? 40_000),
      });
      if (res.ok) {
        const body = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
        const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("").trim();
        if (text) return { ok: true, text, model };
        lastError = "Gemini returned an empty response";
      } else {
        lastError = `Gemini returned HTTP ${res.status}`;
        if (res.status !== 429 && res.status < 500 && res.status !== 404) break; // not retryable (bad key, bad request…)
      }
    } catch (e) {
      lastError = `Could not reach Gemini: ${(e as Error).message}`;
    }
    if (i < attempts) await sleep(800 * 2 ** (i - 1));
  }
  console.error("[bdm gemini]", lastError);
  return { ok: false, code: "failed", error: lastError };
}

export const GROUNDING_RULES = `You are the AI Business Development Manager inside NAFA Business OS, the CRM of NAFA Events & Activations (Mumbai, India; services: corporate events, brand activations, BTL, experiential marketing, brand promotions, exhibitions, mall & retail activations, roadshows, wedding & social events, event production, staffing/fabrication/logistics).
Strict rules:
- Use ONLY the CRM data supplied in the prompt. Never invent companies, people, dates, amounts, past conversations or results.
- If the data does not contain the answer, say so plainly and say what is missing.
- Rule-based scores and tiers in the data are estimates from CRM signals, not guarantees. Never state that a deal "will" close.
- Amounts are Indian Rupees; dates are Indian Standard Time.
- You never send anything to clients and never change CRM records; you only recommend and draft for human approval.
- Be concise and action-oriented.`;
