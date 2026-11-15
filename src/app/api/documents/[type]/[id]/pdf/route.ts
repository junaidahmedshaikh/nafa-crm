import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { getMember } from "@/lib/auth";
import { pdfFileName, renderPdf } from "@/lib/documents/render";
import { loadInvoiceRender, loadProposalRender, loadQuotationRender } from "@/lib/documents/repo";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

// Private to this browser and re-checked on every request (the session is verified before a 304 is ever returned).
const CACHE = "private, no-cache, must-revalidate";
// A new deployment may change the templates, so the build is part of the fingerprint.
const BUILD = process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.VERCEL_DEPLOYMENT_ID ?? "local";

/** GET /api/documents/{quotation|invoice|proposal}/{id}/pdf[?download=1] — authenticated, RLS-scoped. */
export async function GET(request: Request, { params }: RouteContext<"/api/documents/[type]/[id]/pdf">) {
  const member = await getMember();
  if ("reason" in member) {
    const anon = member.reason === "anonymous";
    return NextResponse.json({ error: anon ? "Not signed in" : "Not authorised" }, { status: anon ? 401 : 403 });
  }
  const { type, id } = await params;
  const { supabase } = member.ctx;

  let doc;
  try {
    if (type === "quotation") doc = await loadQuotationRender(supabase, id);
    else if (type === "invoice") doc = await loadInvoiceRender(supabase, id);
    else if (type === "proposal") doc = await loadProposalRender(supabase, id);
    else return NextResponse.json({ error: "Unknown document type" }, { status: 404 });
  } catch (e) {
    console.error("[pdf load]", e);
    return NextResponse.json({ error: "Could not load the document" }, { status: 500 });
  }
  if (!doc) return NextResponse.json({ error: "Document not found" }, { status: 404 });

  // The render input fully determines the PDF. If the browser already has this exact version, answer 304 and skip
  // the 1-2 second Chromium render (the detail pages embed this PDF on every visit).
  const etag = `"${createHash("sha256").update(BUILD).update(JSON.stringify(doc)).digest("base64url").slice(0, 32)}"`;
  if (request.headers.get("if-none-match") === etag) return new NextResponse(null, { status: 304, headers: { ETag: etag, "Cache-Control": CACHE } });

  try {
    const { pdf } = await renderPdf(doc);
    const download = new URL(request.url).searchParams.get("download") === "1";
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${pdfFileName(doc)}"`,
        "Cache-Control": CACHE,
        ETag: etag,
      },
    });
  } catch (e) {
    console.error("[pdf render]", e);
    return NextResponse.json({ error: (e as Error).message.startsWith("PDF engine unavailable") ? (e as Error).message : "PDF generation failed" }, { status: 500 });
  }
}
