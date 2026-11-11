import { NextResponse } from "next/server";
import { z } from "zod";
import { getMember } from "@/lib/auth";
import { geminiGenerate, GROUNDING_RULES } from "@/lib/bdm/gemini";
import { buildBriefingData } from "@/lib/bdm/snapshot";
import { loadBdmInput } from "@/lib/bdm/snapshot";
import { NAFA_SERVICES } from "@/lib/bdm/services";
import { OPEN_STATUSES } from "@/lib/constants";
import { limitUser } from "@/lib/rate-limit";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  question: z.string().trim().min(2).max(500),
  history: z.array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().max(2000) })).max(6).optional(),
});

/**
 * Answers questions about business development using live CRM data read with the signed-in user's own
 * Supabase session (so their permissions/RLS apply). The model only ever sees the data packed below.
 */
export async function POST(request: Request) {
  const member = await getMember();
  if ("reason" in member) return NextResponse.json({ ok: false, error: "Please sign in again." }, { status: 401 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "Ask a question of 2–500 characters." }, { status: 400 });
  const { supabase } = member.ctx;
  if (!(await limitUser(member.ctx.user.id, "chat"))) return NextResponse.json({ ok: false, error: "You are asking too quickly. Please wait a few minutes." }, { status: 429 });

  try {
    const now = new Date();
    const { data: d, settings } = await buildBriefingData(supabase, now);
    const input = await loadBdmInput(supabase, settings, now);
    const openLeads = input.leads.filter((l) => OPEN_STATUSES.includes(l.status));
    const LIMIT = 250;
    const ctx = {
      today: d.istDate,
      note: "All dates are IST. Scores are rule-based estimates from CRM data, not guarantees.",
      nafaServices: NAFA_SERVICES,
      metrics: d.metrics,
      todaysActionPlan: d.actionPlan,
      topProspects: d.prospects,
      proposals: d.proposals,
      deals: d.deals.slice(0, 40),
      repliedButNotAnswered: d.awaitingResponse,
      overdueFollowUps: d.overdueFollowUps,
      followUpsToday: d.followUpsToday,
      meetings: d.meetings,
      inactiveLeads: d.inactive,
      industries: d.industries,
      dataNotes: d.dataNotes,
      openLeads: openLeads.slice(0, LIMIT).map((l) => ({
        lead: `L-${String(l.number).padStart(4, "0")}`, company: l.companyName, industry: l.industry, contact: l.contactName, city: l.city,
        status: l.status, priority: l.priority, source: l.source, service: l.serviceCategory, value: l.expectedRevenue ?? l.budget,
        lastContact: l.lastContactAt?.slice(0, 10) ?? null, created: l.createdAt.slice(0, 10), eventDate: l.eventDate, assignedTo: l.assignedName,
      })),
      openLeadsTruncated: openLeads.length > LIMIT ? `Showing ${LIMIT} of ${openLeads.length} open leads` : null,
    };
    const hist = (parsed.data.history ?? []).map((h) => `${h.role === "user" ? "User" : "Assistant"}: ${h.text}`).join("\n");
    const r = await geminiGenerate({
      system: `${GROUNDING_RULES}\nAnswer in clear markdown-free text; use short numbered or dashed lines for lists, naming real companies and lead numbers from the data. When listing, include the reason. If a filter (e.g. a city) matches nothing in the data, say that none were found.`,
      prompt: `${hist ? `Conversation so far:\n${hist}\n\n` : ""}CRM data (JSON):\n${JSON.stringify(ctx)}\n\nQuestion: ${parsed.data.question}`,
      temperature: 0.2,
    });
    if (!r.ok) {
      const msg = r.code === "not_configured" ? "The AI assistant is not configured yet. An administrator needs to set GEMINI_API_KEY." : "The AI service is unavailable right now. Please try again in a moment.";
      return NextResponse.json({ ok: false, error: msg }, { status: r.code === "not_configured" ? 503 : 502 });
    }
    return NextResponse.json({ ok: true, answer: r.text });
  } catch (e) {
    console.error("[bdm chat]", e);
    return NextResponse.json({ ok: false, error: "Could not read CRM data. Please try again." }, { status: 500 });
  }
}
