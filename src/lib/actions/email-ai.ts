"use server";

import { z } from "zod";
import { authorized } from "@/lib/auth";
import { fail } from "@/lib/actions/util";
import { geminiGenerate } from "@/lib/bdm/gemini";
import { WRITING_STYLES, type WritingStyle } from "@/lib/email/styles";
import { sanitizeEmailHtml } from "@/lib/email/sanitize";
import type { ActionResult } from "@/lib/types";
import { limitUser, TOO_MANY } from "@/lib/rate-limit";

const SYSTEM = `You write business emails for NAFA Events & Activations (Mumbai, India; website https://www.nafaevents.in/). Services: event management and production, brand activations, BTL and experiential marketing, decoration, fabrication, staffing and manpower, logistics, exhibitions, roadshows, weddings and social events.
Rules:
- Use ONLY facts in the instruction. Never invent clients, case studies, awards, years in business, statistics, prices or guarantees.
- Personalise with these placeholders exactly as written: {{first_name|there}}, {{company_name}}, {{city}}, {{industry}}. Use only placeholders that make sense; never leave other {{ }} text.
- Body is HTML limited to: <p>, <br>, <strong>, <em>, <ul>, <ol>, <li>, <a href="https://...">, <h2>. Do NOT include a signature, postal address or unsubscribe text (they are added automatically).
- Structure: greeting, short introduction, value proposition, collaboration opportunity, a clear call to action, a professional closing line.
- Sound human, not spammy: no ALL CAPS, no exclamation spam, no misleading subject lines.`;

const writeSchema = z.object({
  instruction: z.string().trim().min(10, "Describe the email you want (at least 10 characters).").max(1500),
  style: z.enum(Object.keys(WRITING_STYLES) as [WritingStyle, ...WritingStyle[]]),
  part: z.enum(["all", "subject", "intro", "closing"]).default("all"),
  current: z.object({ subject: z.string().max(300), bodyHtml: z.string().max(40000) }).optional(),
});
export type AiWriteInput = z.input<typeof writeSchema>;
export type AiSuggestion = { subject: string | null; bodyHtml: string | null };

async function runJson(prompt: string): Promise<ActionResult<{ raw: { subject?: string; body_html?: string } }>> {
  const r = await geminiGenerate({ system: SYSTEM, prompt, json: true, temperature: 0.7 });
  if (!r.ok) return fail(r.code === "not_configured" ? "Gemini is not configured (set GEMINI_API_KEY)." : "The AI service is busy or unavailable. Please try again in a moment.");
  try {
    return { ok: true, data: { raw: JSON.parse(r.text) } };
  } catch {
    return fail("The AI returned an unreadable response. Please try again.");
  }
}

/** Suggests content. Never saves or overwrites anything: the editor shows the suggestion and asks before applying it. */
export async function aiWriteEmail(input: AiWriteInput): Promise<ActionResult<AiSuggestion>> {
  return authorized(async ({ user }) => {
    if (!(await limitUser(user.id, "ai"))) return fail(TOO_MANY);
    const p = writeSchema.safeParse(input);
    if (!p.success) return fail(p.error.issues[0]?.message ?? "Invalid request.");
    const { instruction, style, part, current } = p.data;
    const what = {
      all: "Write the complete email (subject and body).",
      subject: "Write ONLY a new subject line (return body_html as null).",
      intro: "Rewrite ONLY the opening greeting and introduction paragraph of the current email, keeping the rest unchanged; return the full updated body_html.",
      closing: "Rewrite ONLY the closing paragraph and call to action of the current email, keeping the rest unchanged; return the full updated body_html.",
    }[part];
    const res = await runJson(`Style: ${WRITING_STYLES[style]}\nInstruction from the sender: ${instruction}\n\n${what}\n${current ? `\nCurrent email:\nSubject: ${current.subject}\n${current.bodyHtml}\n` : ""}\nReturn JSON: {"subject": string|null, "body_html": string|null}`);
    if (!res.ok) return res;
    const { subject, body_html } = res.data.raw;
    return { ok: true, data: { subject: subject ? String(subject).slice(0, 200) : null, bodyHtml: body_html ? sanitizeEmailHtml(String(body_html)) : null } };
  });
}

const ACTIONS = {
  improve: "Improve the writing: clearer, smoother, more natural. Keep the meaning and every placeholder.",
  shorter: "Make it noticeably shorter while keeping the key message and call to action.",
  professional: "Make the tone more professional and polished.",
  persuasive: "Make it more persuasive and benefit-led without exaggeration or false claims.",
  grammar: "Fix grammar, spelling and punctuation ONLY. Do not change wording or meaning otherwise.",
} as const;
const transformSchema = z.object({
  action: z.enum(Object.keys(ACTIONS) as [keyof typeof ACTIONS, ...(keyof typeof ACTIONS)[]]),
  subject: z.string().max(300),
  bodyHtml: z.string().min(1, "Write or generate some content first.").max(40000),
});

export async function aiTransformEmail(input: z.input<typeof transformSchema>): Promise<ActionResult<AiSuggestion>> {
  return authorized(async ({ user }) => {
    if (!(await limitUser(user.id, "ai"))) return fail(TOO_MANY);
    const p = transformSchema.safeParse(input);
    if (!p.success) return fail(p.error.issues[0]?.message ?? "Invalid request.");
    const res = await runJson(`${ACTIONS[p.data.action]}\nKeep all {{placeholders}} exactly as they are. Do not add a signature or unsubscribe text.\n\nSubject: ${p.data.subject}\n${p.data.bodyHtml}\n\nReturn JSON: {"subject": string, "body_html": string}`);
    if (!res.ok) return res;
    const { subject, body_html } = res.data.raw;
    return { ok: true, data: { subject: subject ? String(subject).slice(0, 200) : null, bodyHtml: body_html ? sanitizeEmailHtml(String(body_html)) : null } };
  });
}
