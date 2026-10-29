import { dmy, esc, escMultiline, htmlDocument, logoDataUri, money, qtyText, RUPEE } from "./base";
import type { QuotationRender, RenderOptions } from "../types";

/**
 * Quotation template — a close reproduction of NAFA_Quotation_Template.pdf (A4, Quattrocento Sans).
 * Geometry is taken from the reference: content box x 38→567.4 pt, logo 180×90 pt at the top-left,
 * letter-spaced title top-right, label/value meta block, two-column party block, ruled item table,
 * summary at x 356→567.4 with a heavy rule above the grand total, milestone table and terms.
 * Coordinates below are page coordinates minus the page margin (38 pt left, 38 pt top).
 */
const CSS = `
@page{size:A4;margin:38pt 27.6pt 28pt 38pt}
.sheet{width:529.4pt;position:relative;font-size:8.7pt;line-height:1.103;letter-spacing:-.02em}
.abs{position:absolute;white-space:nowrap}
.lbl{letter-spacing:0;font-size:6.8pt;color:#6e6e6e;text-transform:uppercase}
.lblb{letter-spacing:0;font-size:6.8pt;color:#6e6e6e;font-weight:700;text-transform:uppercase}
.hdr{position:relative;height:118.6pt}
.hdr img{position:absolute;left:0.8pt;top:0;width:180.4pt;height:90.2pt}
.title{right:2.9pt;top:7.5pt;font-size:23.3pt;letter-spacing:5.5pt;margin-right:-5.5pt;color:#111}
.mrow{position:absolute;right:2.9pt;height:9.6pt;width:200pt}
.mrow .l{position:absolute;right:116.4pt;top:-0.1pt;font-size:6.8pt;color:#6e6e6e;text-transform:uppercase}
.mrow .v{position:absolute;right:0;top:0;font-size:8.7pt;color:#111}
.parties{position:relative;display:flex;min-height:88.7pt}
.parties .col{width:271.4pt;padding-left:3pt;padding-right:6pt}
.parties .col+.col{width:auto;flex:1}
.pl{margin-bottom:7.6pt}
.pr{letter-spacing:.02em;font-weight:700;font-size:9.7pt;color:#111;min-height:10.7pt;margin-bottom:7.2pt;overflow-wrap:anywhere}
.pr.sm{font-size:8.7pt;white-space:pre-wrap;padding-top:1.4pt}
.pe{font-size:8.7pt;color:#111;margin-bottom:2.4pt;overflow-wrap:anywhere}
.pe.g{color:#6e6e6e}
.itemlbl{height:6pt}
table{border-collapse:collapse;width:529.4pt;table-layout:fixed}
thead{display:table-header-group}
tr{break-inside:avoid}
.th{letter-spacing:0;text-align:left;font-size:6.8pt;font-weight:700;color:#6e6e6e;text-transform:uppercase;padding:0 3pt 7.2pt;height:15pt;vertical-align:top;border-bottom:2px solid #111;line-height:1.103;white-space:nowrap}
.r{text-align:right}
.items td{font-size:8.7pt;padding:3.4pt 3pt 3.4pt;border-bottom:.75pt solid #d9d9d9;vertical-align:top;line-height:1.2}
.items td.num{white-space:nowrap}
.items .note{font-size:7.2pt;color:#6e6e6e;margin-top:1.5pt;line-height:1.25}
.items .dnote{font-size:7.2pt;color:#6e6e6e;white-space:nowrap}
.items-space{min-height:var(--item-space,255.5pt)}
.tail{break-inside:avoid}
.sum{width:211.4pt;margin-left:318pt;padding-top:5.6pt}
.sum .row{position:relative;height:15.7pt;font-size:8.7pt}
.sum .row .a{position:absolute;left:3pt;top:0;color:#6e6e6e}
.sum .row .b{position:absolute;right:3pt;top:0;color:#111}
.grand{border-top:2px solid #111;margin-top:4.4pt;position:relative;height:17.4pt}
.grand .a{position:absolute;left:3pt;top:6pt;font-size:6.8pt;font-weight:700;color:#111;text-transform:uppercase}
.grand .b{position:absolute;right:3pt;top:2.4pt;font-size:12.6pt;font-weight:700;color:#111;line-height:1.103}
.ptlbl{height:16.4pt;margin-top:9.3pt}
.pt .th2{letter-spacing:0;text-align:left;font-size:6.8pt;font-weight:700;color:#6e6e6e;text-transform:uppercase;padding:0 3pt 5.7pt;vertical-align:top;border-bottom:2px solid #111;white-space:nowrap;line-height:1.103}
.pt td{font-size:8.7pt;padding:4.1pt 3pt 0;height:16.4pt;border-bottom:.75pt solid #d9d9d9;vertical-align:top;line-height:1.103}
.pt td.due{color:#6e6e6e}
.termslbl{margin-top:9.5pt;height:12.7pt}
.terms p{letter-spacing:0;font-size:7.8pt;color:#6e6e6e;line-height:8.6pt;margin-bottom:4.8pt;padding-left:3pt;padding-right:3pt;white-space:pre-wrap}
.endrule{border-top:.75pt solid #d9d9d9;margin-top:12pt}
.foot{letter-spacing:0;display:flex;justify-content:space-between;font-size:7.8pt;color:#6e6e6e;padding:4pt 3pt 0;line-height:1.103;white-space:nowrap}
`;

function partyLines(d: QuotationRender) {
  const c = d.client;
  const left: string[] = [];
  if (c.email) left.push(`Email: ${c.email}`);
  if (c.gstin) left.push(`GSTIN: ${c.gstin}`);
  const right: string[] = [];
  if (d.event.name) right.push(`Event / project: ${d.event.name}`);
  if (d.event.reference) right.push(`Reference: ${d.event.reference}`);
  return { left, right };
}

export function renderQuotationHtml(d: QuotationRender, opts: RenderOptions = {}): string {
  void opts;
  const { left, right } = partyLines(d);
  const extra = Math.max(left.length, right.length);
  // Keep the reference's single-page rhythm: extra party lines eat into the blank item space.
  const itemSpace = Math.max(60, 255.5 - extra * 11.5);
  const calc = d.calc;
  const cfg = d.config;

  const summaryRows: [string, string][] = [["Subtotal", money(calc.subtotal)]];
  if (calc.discount > 0) summaryRows.push(["Discount", `− ${money(calc.discount)}`]);
  if (cfg.agency_fee.enabled) summaryRows.push([`Agency fee (${Number(cfg.agency_fee.rate)}%)`, money(calc.agency_fee)]);
  for (const oc of cfg.other_charges) {
    if (Number(oc.amount) !== 0) summaryRows.push([oc.label || "Other charges", money(oc.amount)]);
  }
  const showTaxable = calc.discount > 0 || (cfg.agency_fee.enabled && calc.agency_fee > 0) || calc.other_charges_taxable > 0;
  if (showTaxable && cfg.tax.mode !== "none") summaryRows.push(["Taxable value", money(calc.taxable_value)]);
  const rate = Number(cfg.tax.rate);
  if (cfg.tax.mode === "cgst_sgst") {
    // Same as the supplied template: one "GST (18%)" line. The CGST/SGST split is itemised on the invoice.
    summaryRows.push([`GST (${rate}%)`, money(calc.cgst + calc.sgst)]);
  } else if (cfg.tax.mode === "igst") {
    summaryRows.push([`IGST (${rate}%)`, money(calc.igst)]);
  }
  if (calc.round_off !== 0) summaryRows.push(["Round off", (calc.round_off > 0 ? "+ " : "− ") + money(Math.abs(calc.round_off))]);

  const itemsHtml = d.items
    .map((it, i) => {
      const line = calc.lines[i];
      const disc = line && line.discount > 0 ? `<div class="dnote">Less discount ${money(line.discount)}</div>` : "";
      return `<tr><td>${escMultiline(it.description)}${it.notes ? `<div class="note">${escMultiline(it.notes)}</div>` : ""}</td>
<td class="r num">${esc(qtyText(it.qty))}</td><td class="r num">${money(it.rate)}</td>
<td class="r num">${money(line?.amount ?? 0)}${disc}</td></tr>`;
    })
    .join("");

  const milestoneRows = d.milestones
    .map(
      (m) => `<tr><td>${esc(m.label)}</td><td class="due">${esc(m.due_text)}</td><td class="r">${money(m.amount)}</td></tr>`,
    )
    .join("");

  const terms = d.terms.filter((t) => t.trim()).map((t, i) => `<p>${i + 1}.   ${esc(t)}</p>`).join("");
  const co = d.company;
  const phoneLine = co.phone;

  const body = `<div class="sheet" style="--item-space:${itemSpace}pt">
<div class="hdr">
  <img src="${logoDataUri()}" alt="NAFA Events &amp; Activations">
  <div class="abs title">QUOTATION</div>
  <div class="mrow" style="top:45pt"><span class="l">Quotation No.</span><span class="v">${d.number ? esc(d.number) : "DRAFT"}</span></div>
  <div class="mrow" style="top:61.4pt"><span class="l">Date</span><span class="v">${dmy(d.date)}</span></div>
  ${d.valid_until ? `<div class="mrow" style="top:77.8pt"><span class="l">Valid until</span><span class="v">${dmy(d.valid_until)}</span></div>` : ""}
</div>
<div class="parties" style="padding-bottom:${extra ? 10 : 0}pt">
  <div class="col">
    <div class="lblb pl">Prepared for</div>
    <div class="pr">Client Name: ${esc(d.client.client_name)}</div>
    <div class="pr">Company: ${esc(d.client.company)}</div>
    <div class="pr">Address: ${esc(d.client.address)}</div>
    <div class="pr">Contact Number: ${esc(d.client.phone)}</div>
    ${left.map((l) => `<div class="pe g">${esc(l)}</div>`).join("")}
  </div>
  <div class="col">
    <div class="lblb pl">Event details</div>
    <div class="pr">Event Type: ${esc(d.event.type)}</div>
    <div class="pr sm">Event date:  ${esc(d.event.date_text)}</div>
    <div class="pr">Location: ${esc(d.event.location)}</div>
    ${right.map((l) => `<div class="pe g">${esc(l)}</div>`).join("")}
  </div>
</div>
<div class="itemlbl"></div>
<div class="items-space">
<table class="items">
  <colgroup><col style="width:262pt"><col style="width:57.3pt"><col style="width:93.8pt"><col style="width:116.3pt"></colgroup>
  <thead><tr><th class="th">Description</th><th class="th r">Qty</th><th class="th r">Unit Price (${RUPEE})</th><th class="th r">Amount (${RUPEE})</th></tr></thead>
  <tbody>${itemsHtml}</tbody>
</table>
</div>
<div class="tail">
  <div class="sum">
    ${summaryRows.map(([a, b]) => `<div class="row"><span class="a">${esc(a)}</span><span class="b">${b}</span></div>`).join("")}
    <div class="grand"><span class="a">Grand Total (${RUPEE})</span><span class="b">${money(calc.grand_total)}</span></div>
  </div>
  ${
    d.milestones.length
      ? `<div class="lblb ptlbl" style="padding:0 3pt">Payment terms</div>
  <table class="pt"><colgroup><col style="width:271.4pt"><col style="width:217.6pt"><col style="width:40.4pt"></colgroup>
  <thead><tr><th class="th2">Milestone</th><th class="th2">Due</th><th class="th2 r">Amount (${RUPEE})</th></tr></thead>
  <tbody>${milestoneRows}</tbody></table>`
      : ""
  }
  ${terms ? `<div class="lblb termslbl" style="padding:0 3pt">Terms &amp; Conditions</div><div class="terms">${terms}</div>` : ""}
  <div class="endrule"></div>
  <div class="foot"><span>Thank you for considering ${esc(co.name.replace(/ Events & Activations$/i, " Events"))}&nbsp;&nbsp;&nbsp;&nbsp;|&nbsp;&nbsp;&nbsp;&nbsp;Email: ${esc(co.email)}</span><span>Phone: ${esc(phoneLine)}</span><span>Website: ${esc(co.website.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, ""))}</span></div>
</div>
</div>`;
  return htmlDocument({ title: `Quotation ${d.number ?? "DRAFT"}`, css: CSS, body });
}
