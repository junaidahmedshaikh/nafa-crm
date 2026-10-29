import { dmy, esc, escMultiline, htmlDocument, logoDataUri, money, qtyText, RUPEE } from "./base";
import type { ProposalRender, ProposalSectionRender, RenderOptions } from "../types";

/**
 * Proposal template. There is no supplied reference for proposals, so this reuses the visual language of the
 * quotation/invoice templates — same logo placement, letter-spaced title, grey small-cap labels, hairline rules,
 * Quattrocento Sans and #111/#6e6e6e — but flows over as many A4 pages as the content needs.
 */
const CSS = `
@page{size:A4;margin:38pt 38pt 36pt 38pt}
.sheet{width:519pt;font-size:8.9pt;line-height:1.55;color:#111}
.hdr{position:relative;height:104pt}
.hdr img{position:absolute;left:.8pt;top:0;width:150pt;height:75pt}
.abs{position:absolute;white-space:nowrap}
.ptitle{right:0;top:2pt;font-size:21pt;letter-spacing:5pt;margin-right:-5pt;line-height:1.1}
.mrow{position:absolute;right:0;height:10pt;width:220pt;font-size:8pt}
.mrow .l{position:absolute;right:62pt;top:.6pt;font-size:6.5pt;color:#6e6e6e;text-transform:uppercase}
.mrow .v{position:absolute;right:0;top:0}
.lbl{font-size:6.8pt;color:#6e6e6e;font-weight:700;text-transform:uppercase;letter-spacing:.02em}
.rule{border-top:1.5px solid #111;margin:6pt 0 0}
.cover{padding:18pt 0 16pt;border-bottom:.75pt solid #d9d9d9}
.cover h1{font-size:21pt;font-weight:400;line-height:1.2;margin:8pt 0 12pt;letter-spacing:-.005em}
.cover .intro{color:#444;font-size:9.4pt;max-width:430pt;white-space:pre-line}
.client{display:flex;gap:30pt;margin-top:16pt}
.client div{font-size:8.7pt}
.client .n{font-weight:700;font-size:9.6pt}
.client .g{color:#6e6e6e}
.sec{margin-top:18pt}
.sec h2{font-size:10.6pt;font-weight:700;margin:3pt 0 7pt;padding-bottom:5pt;border-bottom:.75pt solid #d9d9d9;break-after:avoid}
.sec .num{color:#6e6e6e;font-weight:400;margin-right:6pt}
.sec p{margin:0 0 6pt}
.sec h3{font-size:8.9pt;font-weight:700;margin:8pt 0 3pt}
.sec ul{margin:0 0 6pt 12pt}
.sec li{margin-bottom:2pt}
.imgs{display:flex;flex-wrap:wrap;gap:8pt;margin:8pt 0 4pt}
.imgs figure{flex:1 1 240pt;max-width:100%;break-inside:avoid}
.imgs img{display:block;max-width:100%;max-height:230pt;width:auto;height:auto;margin:0 auto;object-fit:contain;border:.75pt solid #e4e4e4}
.imgs figcaption{font-size:7pt;color:#6e6e6e;margin-top:2pt;text-align:center}
table{border-collapse:collapse;width:100%;table-layout:fixed}
thead{display:table-header-group}
tr{break-inside:avoid}
.ct th{font-size:6.8pt;font-weight:700;color:#6e6e6e;text-transform:uppercase;text-align:left;padding:0 3pt 5pt;border-bottom:2px solid #111}
.ct td{padding:4pt 3pt;border-bottom:.75pt solid #d9d9d9;vertical-align:top;font-size:8.7pt}
.r{text-align:right}
.sum{width:211pt;margin:8pt 0 0 auto;break-inside:avoid}
.sum .row{display:flex;justify-content:space-between;padding:2.5pt 3pt;font-size:8.7pt}
.sum .row span:first-child{color:#6e6e6e}
.sum .grand{border-top:2px solid #111;margin-top:4pt;padding-top:6pt;font-weight:700}
.sum .grand span:first-child{color:#111;font-size:6.8pt;text-transform:uppercase;padding-top:5pt}
.sum .grand span:last-child{font-size:12.6pt}
.accept{display:flex;gap:30pt;margin-top:10pt;break-inside:avoid}
.accept>div{flex:1}
.accept .line{border-bottom:.75pt solid #111;height:26pt}
.accept .cap{font-size:7pt;color:#6e6e6e;margin-top:3pt}
.accept .who{font-weight:700;font-size:8.7pt;margin-bottom:6pt}
.endrule{border-top:.75pt solid #d9d9d9;margin-top:26pt;break-inside:avoid}
.foot{display:flex;justify-content:space-between;font-size:7.8pt;color:#6e6e6e;padding:4pt 3pt 0;white-space:nowrap}
`;

/** Minimal formatting: blank line = paragraph, "- " = bullet, "## " = sub-heading. Everything is escaped. */
function formatBody(body: string): string {
  const out: string[] = [];
  let list: string[] = [];
  const flush = () => {
    if (list.length) {
      out.push(`<ul>${list.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>`);
      list = [];
    }
  };
  let para: string[] = [];
  const flushPara = () => {
    if (para.length) {
      out.push(`<p>${para.map(esc).join("<br>")}</p>`);
      para = [];
    }
  };
  for (const raw of body.replace(/\r/g, "").split("\n")) {
    const line = raw.trimEnd();
    if (!line.trim()) { flush(); flushPara(); continue; }
    const bullet = /^\s*[-•*]\s+(.*)$/.exec(line);
    const h = /^##\s+(.*)$/.exec(line);
    if (h) { flush(); flushPara(); out.push(`<h3>${esc(h[1])}</h3>`); }
    else if (bullet) { flushPara(); list.push(bullet[1]); }
    else { flush(); para.push(line); }
  }
  flush(); flushPara();
  return out.join("");
}

function commercialHtml(d: ProposalRender): string {
  const c = d.commercial;
  if (!c) return "";
  const rows = c.items
    .map((it) => `<tr><td>${escMultiline(it.description)}</td><td class="r">${esc(qtyText(it.qty))}</td><td class="r">${money(it.rate)}</td><td class="r">${money(it.amount)}</td></tr>`)
    .join("");
  const table = c.items.length
    ? `<table class="ct"><colgroup><col style="width:52%"><col style="width:12%"><col style="width:18%"><col style="width:18%"></colgroup>
<thead><tr><th>Description</th><th class="r">Qty</th><th class="r">Unit Price (${RUPEE})</th><th class="r">Amount (${RUPEE})</th></tr></thead><tbody>${rows}</tbody></table>`
    : "";
  let summary = "";
  if (c.calc) {
    const k = c.calc;
    const lines: [string, string][] = [["Subtotal", money(k.subtotal)]];
    if (k.discount > 0) lines.push(["Discount", `− ${money(k.discount)}`]);
    if (k.agency_fee > 0) lines.push(["Agency / management fee", money(k.agency_fee)]);
    if (k.other_charges !== 0) lines.push(["Other charges", money(k.other_charges)]);
    if (k.cgst + k.sgst > 0) lines.push(["GST (CGST + SGST)", money(k.cgst + k.sgst)]);
    if (k.igst > 0) lines.push(["IGST", money(k.igst)]);
    if (k.round_off !== 0) lines.push(["Round off", money(k.round_off)]);
    summary = `<div class="sum">${lines.map(([a, b]) => `<div class="row"><span>${esc(a)}</span><span>${b}</span></div>`).join("")}
<div class="row grand"><span>Total (${RUPEE})</span><span>${money(k.grand_total)}</span></div></div>`;
  }
  return `${table}${summary}${c.manual_note.trim() ? `<div style="margin-top:8pt">${formatBody(c.manual_note)}</div>` : ""}`;
}

function sectionHtml(d: ProposalRender, s: ProposalSectionRender, n: number): string {
  let inner = s.body.trim() ? formatBody(s.body) : "";
  if (s.type === "prepared_for") {
    const c = d.client;
    inner =
      `<div class="client"><div><div class="n">${esc(c.company || c.client_name)}</div>${c.client_name && c.company ? `<div>${esc(c.client_name)}</div>` : ""}` +
      `${c.address ? `<div class="g">${escMultiline(c.address)}</div>` : ""}${c.email ? `<div class="g">${esc(c.email)}</div>` : ""}${c.phone ? `<div class="g">${esc(c.phone)}</div>` : ""}${c.gstin ? `<div class="g">GSTIN: ${esc(c.gstin)}</div>` : ""}</div></div>` + inner;
  }
  if (s.type === "commercial") inner = commercialHtml(d) + inner;
  if (s.type === "acceptance") {
    inner += `<div class="accept"><div><div class="who">For ${esc(d.client.company || d.client.client_name || "the client")}</div><div class="line"></div><div class="cap">Name &amp; designation</div><div class="line"></div><div class="cap">Signature &amp; date</div></div>
<div><div class="who">${esc(d.company.signatory_label)}</div><div class="line"></div><div class="cap">Name &amp; designation</div><div class="line"></div><div class="cap">Signature &amp; date</div></div></div>`;
  }
  if (s.images.length) {
    inner += `<div class="imgs">${s.images.map((im) => `<figure><img src="${im.data_uri}" alt="${esc(im.caption)}">${im.caption ? `<figcaption>${esc(im.caption)}</figcaption>` : ""}</figure>`).join("")}</div>`;
  }
  if (!inner) return "";
  return `<section class="sec"><h2><span class="num">${String(n).padStart(2, "0")}</span>${esc(s.title)}</h2>${inner}</section>`;
}

export function renderProposalHtml(d: ProposalRender, opts: RenderOptions = {}): string {
  void opts;
  const co = d.company;
  const cover = d.sections.find((s) => s.type === "cover");
  const rest = d.sections.filter((s) => s.type !== "cover");
  let n = 0;
  const sections = rest
    .map((s) => {
      const html = sectionHtml(d, s, n + 1);
      if (html) n += 1;
      return html;
    })
    .join("");
  const site = co.website.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");

  const body = `<div class="sheet">
<div class="hdr">
  <img src="${logoDataUri()}" alt="NAFA Events &amp; Activations">
  <div class="abs ptitle">PROPOSAL</div>
  <div class="mrow" style="top:44pt"><span class="l">Proposal No.</span><span class="v">${d.number ? esc(d.number) : "DRAFT"}</span></div>
  <div class="mrow" style="top:58pt"><span class="l">Date</span><span class="v">${dmy(d.date)}</span></div>
</div>
<div class="cover">
  <div class="lbl">Prepared for ${esc(d.client.company || d.client.client_name)}</div>
  <h1>${esc(d.title)}</h1>
  ${cover?.body.trim() ? `<div class="intro">${esc(cover.body)}</div>` : ""}
  ${cover?.images.length ? `<div class="imgs">${cover.images.map((im) => `<figure><img src="${im.data_uri}" alt="${esc(im.caption)}">${im.caption ? `<figcaption>${esc(im.caption)}</figcaption>` : ""}</figure>`).join("")}</div>` : ""}
</div>
${sections}
<div class="endrule"></div>
<div class="foot"><span>Thank you for considering ${esc(co.name.replace(/ Events & Activations$/i, " Events"))}&nbsp;&nbsp;|&nbsp;&nbsp;Email: ${esc(co.email)}</span><span>Phone: ${esc(co.phone)}</span><span>Website: ${esc(site)}</span></div>
</div>`;
  return htmlDocument({ title: `Proposal ${d.number ?? "DRAFT"}`, css: CSS, body });
}
