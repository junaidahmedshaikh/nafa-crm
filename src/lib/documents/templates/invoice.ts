import { dmy, esc, escMultiline, htmlDocument, logoDataUri, money, qtyText, RUPEE, signatureDataUri } from "./base";
import type { InvoiceRender, RenderOptions } from "../types";

/**
 * Invoice template — a close reproduction of NAFA_Invoice_Template.pdf.
 * The reference is a scaled spreadsheet export: printable area x 25.2→501.2 pt, content starting at
 * x = 38 pt with the Sr. No. column hanging into the left margin, 5.8–7.5 pt type, 21.8 pt ruled rows.
 * Page coordinates minus the margin (25.2 pt) are used for absolute positions.
 */
const CSS = `
@page{size:A4;margin:25.2pt 93.8pt 24.6pt 25.2pt}
.sheet{width:476pt;position:relative;font-size:6.7pt;line-height:1.103;display:flex;flex-direction:column;min-height:790.2pt;letter-spacing:-.008em}
.sheet>*{flex:none}
.abs{position:absolute;white-space:nowrap}
.hdr{position:relative;height:91.1pt;border-bottom:1px solid #111;margin-bottom:0}
.hdr img{position:absolute;left:13.5pt;top:6.4pt;width:89.8pt;height:44.9pt}
.title{right:2.5pt;top:10.3pt;font-size:18.3pt;letter-spacing:5.4pt;margin-right:-5.4pt;color:#111}
.mrow{position:absolute;right:2.5pt;height:8.3pt;width:240pt}
.mrow .l{letter-spacing:0;position:absolute;right:161.7pt;top:.7pt;font-size:5.8pt;color:#6e6e6e;text-transform:uppercase}
.mrow .v{position:absolute;right:0;top:0;font-size:7.5pt;color:#111}
.addr{white-space:pre;left:15.4pt;font-size:6.7pt;color:#6e6e6e}
.lblb{letter-spacing:0;font-size:5.8pt;color:#6e6e6e;font-weight:700;text-transform:uppercase;line-height:1.103}
.parties{display:flex;padding-top:3.6pt;min-height:90.2pt}
.parties .c1{width:239.9pt;padding-left:15.4pt;padding-right:8pt}
.parties .c2{flex:1;padding-right:8pt}
.parties .lblb{margin-bottom:8.3pt}
.prow{min-height:16.45pt;white-space:pre-wrap;overflow-wrap:anywhere}
.n{font-size:8.3pt;font-weight:700;color:#111}
.t7{font-size:7.5pt;color:#6e6e6e}
.t7.k{color:#111}
.t6{font-size:6.7pt;color:#6e6e6e}
.t6.k{color:#111}
.billlbl{padding-left:15.4pt;height:6.5pt}
table{border-collapse:collapse;table-layout:fixed;width:476pt}
thead{display:table-header-group}
tr{break-inside:avoid}
.items th{font-size:5.8pt;font-weight:700;color:#6e6e6e;text-transform:uppercase;padding:0 2.6pt 5.4pt;vertical-align:bottom;height:21.8pt;line-height:1.103;white-space:nowrap;text-align:left;letter-spacing:0;border-bottom:1px solid #111}
.items th.r{text-align:right}
.items th.c{text-align:center}
.items td{font-size:6.7pt;padding:6.7pt 2.6pt 0;height:21.93pt;border-bottom:1px solid #d8d8d8;vertical-align:top;color:#111;line-height:1.103}
.items td.sr{color:#6e6e6e;text-align:center;padding-left:0;padding-right:0}
.items td.hsn{text-align:center;color:#6e6e6e;font-size:5.8pt;padding-top:7.4pt}
.items td.d{padding-bottom:5pt}
.items th.sr{text-align:center;padding-left:0;padding-right:0;padding-bottom:5.4pt;white-space:normal}
.srs{height:6.4pt;position:relative;top:-3.9pt;line-height:6.45pt}
.r{text-align:right}
.c{text-align:center}
.items .note{font-size:5.8pt;color:#6e6e6e;margin-top:1.2pt}
.cols{display:flex;padding-top:20.2pt}
.cols .L{width:236.8pt;padding-left:15.4pt;padding-right:4pt}
.cols .R{width:239.2pt}
.lrow{min-height:16.05pt;padding-bottom:6pt;color:#6e6e6e;font-size:6.7pt}
.rrow{position:relative;height:16.05pt}
.rrow .a{position:absolute;right:87.9pt;top:0;color:#6e6e6e;font-size:6.7pt;white-space:nowrap}
.rrow .b{position:absolute;right:2.6pt;top:-.2pt;font-size:7.5pt;color:#111;white-space:nowrap}
.grand{position:relative;height:12.1pt;border-bottom:1px solid #111;margin-top:0}
.grand .a{position:absolute;right:87.9pt;top:0;font-weight:700;font-size:6.7pt;color:#111;white-space:nowrap}
.grand .b{position:absolute;right:2.6pt;top:-1.7pt;font-weight:700;font-size:10pt;color:#111;line-height:1.103;white-space:nowrap}
.sec{padding-left:15.4pt}
.pd{margin-top:10.6pt;break-inside:avoid}
.pd .line{white-space:pre-wrap;margin-top:9.6pt;font-size:6.7pt;color:#111}
.pd .line+.line{margin-top:8.65pt}
.pd .it{font-style:italic;color:#6e6e6e}
.nt{margin-top:24.7pt;break-inside:avoid}
.nt p{margin-top:5.7pt;font-size:6.7pt;line-height:7.4pt;color:#6e6e6e;width:449pt}
.sig{position:relative;height:50pt;margin-top:.6pt;break-inside:avoid}
.sig img{position:absolute;left:424.5pt;top:0;width:17pt;height:21.8pt}
.sig .f{letter-spacing:.02em;position:absolute;right:2.5pt;top:25.7pt;font-weight:700;font-size:7.5pt;color:#111;white-space:nowrap}
.sig .s{position:absolute;right:2.5pt;top:42.3pt;font-size:6.7pt;color:#6e6e6e;white-space:nowrap}
.foot{text-align:center;margin-top:auto;padding-top:24.1pt;padding-left:12.8pt;break-inside:avoid}
.foot .ty{font-size:7.5pt;color:#6e6e6e;line-height:1.103}
.foot .co{white-space:pre;font-size:6.7pt;color:#6e6e6e;margin-top:8.2pt;line-height:1.103}
`;

const STATUS_LABEL: Record<string, string> = {
  draft: "DRAFT", issued: "ISSUED", partially_paid: "PARTIALLY PAID", paid: "PAID", overdue: "OVERDUE", cancelled: "CANCELLED",
};

const rupees = (v: number | string) => `<span class="rs">${RUPEE}</span>${money(v)}`;
const rupeesSp = (v: number | string) => `${RUPEE} ${money(v)}`;

export function renderInvoiceHtml(d: InvoiceRender, opts: RenderOptions = {}): string {
  const { calc, config: cfg, company: co, client, project } = d;
  const rate = Number(cfg.tax.rate);

  const sumRows: [string, string][] = [["Subtotal", rupees(calc.subtotal)]];
  if (calc.discount > 0) sumRows.push([`Discount (${RUPEE})`, `−${rupees(calc.discount)}`]);
  if (cfg.agency_fee.enabled && calc.agency_fee > 0) sumRows.push([`Agency fee ${Number(cfg.agency_fee.rate)}% (${RUPEE})`, rupees(calc.agency_fee)]);
  const taxPresent = cfg.tax.mode !== "none";
  if (taxPresent || calc.discount > 0 || calc.agency_fee > 0 || calc.other_charges_taxable > 0) sumRows.push([`Taxable Value (${RUPEE})`, rupees(calc.taxable_value)]);
  if (cfg.tax.mode === "cgst_sgst") {
    sumRows.push([`CGST ${rate / 2}% (${RUPEE})`, rupees(calc.cgst)], [`SGST ${rate / 2}% (${RUPEE})`, rupees(calc.sgst)]);
  } else if (cfg.tax.mode === "igst") {
    sumRows.push([`IGST ${rate}% (${RUPEE})`, rupees(calc.igst)]);
  }
  if (calc.other_charges !== 0) sumRows.push([`Other Charges (${RUPEE})`, rupees(calc.other_charges)]);
  if (calc.round_off !== 0) sumRows.push([`Round off (${RUPEE})`, (calc.round_off > 0 ? "+" : "−") + rupees(Math.abs(calc.round_off))]);

  const ph = (t: string) => `<span style="font-size:6.7pt">${t}</span>`;
  const REF = !!opts.referenceLayout;
  if (REF) {
    // QA-only: the exact row set and placeholder values printed in the supplied template, used to compare geometry.
    sumRows.length = 0;
    sumRows.push(
      ["Subtotal", rupees(calc.subtotal)], [`Discount (${RUPEE})`, ph("[Enter discount or 0]")], [`Taxable Value (${RUPEE})`, rupees(calc.taxable_value)],
      [`CGST (${RUPEE})`, ph("[If applicable]")], [`SGST (${RUPEE})`, ph("[If applicable]")], [`IGST (${RUPEE})`, ph("[If applicable]")], [`Other Charges (${RUPEE})`, ph("[If applicable]")],
    );
  }
  const MIN_ROWS = 10;
  const rows = d.items
    .map((it, i) => {
      const line = calc.lines[i];
      return `<tr><td class="sr">${i + 1}</td><td class="d">${escMultiline(it.description)}${it.notes ? `<div class="note">${escMultiline(it.notes)}</div>` : ""}</td>
<td class="hsn">${esc(it.hsn_sac ?? "")}</td><td class="r">${esc(qtyText(it.qty))}</td><td class="r">${rupees(it.rate)}</td>
<td class="r">${rupees(line?.amount ?? 0)}${line && line.discount > 0 ? `<div class="note">less ${money(line.discount)}</div>` : ""}</td></tr>`;
    })
    .concat(Array.from({ length: Math.max(0, MIN_ROWS - d.items.length) }, (_u, k) => `<tr><td class="sr">${REF ? d.items.length + k + 1 : ""}</td><td></td><td></td><td></td><td></td><td></td></tr>`))
    .join("");

  const addrLine = (v: string, cls: string) => (v ? `<div class="prow ${cls}">${esc(v)}</div>` : "");
  const contactLine = [client.contact_person ? `Contact: ${client.contact_person}` : "", client.phone].filter(Boolean).join("  |  ");
  const emailLine = [client.email ? `Email: ${client.email}` : "", client.gstin ? `GSTIN: ${client.gstin}` : ""].filter(Boolean).join("  |  ");
  const projLine3 = [project.quotation_number ? `Ref. Quotation: ${project.quotation_number}` : "", project.place_of_supply ? `Place of Supply: ${project.place_of_supply}` : ""]
    .filter(Boolean).join("  |  ");

  const bank = d.bank;
  const bankLine1 = [bank.account_holder && `Account Holder: ${bank.account_holder}`, bank.bank_name && `Bank: ${bank.bank_name}`].filter(Boolean).join("  |  ");
  const bankLine2 = [bank.account_number && `Account No.: ${bank.account_number}`, bank.ifsc && `IFSC: ${bank.ifsc}`, bank.upi_id && `UPI: ${bank.upi_id}`]
    .filter(Boolean).join("  |  ");

  const notes = [d.notes_text.trim(), d.gst_declaration?.trim()].filter(Boolean).join(" ");
  const site = co.website.replace(/^https?:\/\//, "").replace(/\/$/, "");

  const body = `<div class="sheet">
<div class="hdr">
  <img src="${logoDataUri()}" alt="NAFA Events &amp; Activations">
  <div class="abs title">INVOICE</div>
  <div class="mrow" style="top:39.1pt"><span class="l">Invoice No.</span><span class="v">${d.number ? esc(d.number) : "DRAFT"}</span></div>
  <div class="mrow" style="top:55.2pt"><span class="l">Invoice Date</span><span class="v">${dmy(d.date)}</span></div>
  <div class="mrow" style="top:71.2pt"><span class="l">Due Date</span><span class="v">${dmy(d.due_date)}</span></div>
  <div class="abs addr" style="top:55.8pt">${esc(co.location)}</div>
  <div class="abs addr" style="top:71.8pt">${esc(co.email)}&nbsp;&nbsp;|&nbsp;&nbsp;${esc(co.phone)}&nbsp;&nbsp;|&nbsp;&nbsp;${esc(site ? `www.${site.replace(/^www\./, "")}` : "")}</div>
</div>
<div class="parties">
  <div class="c1">
    <div class="lblb">Bill To</div>
    <div class="prow n">${esc(client.company || client.client_name)}</div>
    ${addrLine(client.address, "t7")}
    ${addrLine(contactLine, "t6")}
    ${addrLine(emailLine, "t6")}
  </div>
  <div class="c2">
    <div class="lblb">Project Details</div>
    <div class="prow n">${esc(project.name)}</div>
    ${project.location ? `<div class="prow t7 k">Location: ${esc(project.location)}</div>` : ""}
    ${project.date_text ? `<div class="prow t7 k">Date / Period: ${esc(project.date_text)}</div>` : ""}
    ${addrLine(projLine3, "t6")}
  </div>
</div>
<div class="lblb billlbl">Itemised Billing</div>
<table class="items">
  <colgroup><col style="width:12.8pt"><col style="width:154pt"><col style="width:56pt"><col style="width:91.6pt"><col style="width:76.3pt"><col style="width:85.3pt"></colgroup>
  <thead><tr><th class="sr"><div class="srs">SR.<br>NO</div></th><th>Description of Services</th><th class="c">HSN/SAC</th><th class="r">Qty.</th><th class="r">Rate (${RUPEE})</th><th class="r">Amount (${RUPEE})</th></tr></thead>
  <tbody>${rows}</tbody>
</table>
<div class="cols">
  <div class="L">
    <div class="lrow">Amount in words: ${esc(d.amount_in_words)}</div>
    <div class="lrow">Payment terms: ${esc(d.payment_terms_text)}</div>
    <div class="lrow">Payment status: ${REF ? "[PAID / PARTIALLY PAID / UNPAID]" : esc(STATUS_LABEL[d.payment_status] ?? d.payment_status)}</div>
    <div class="lrow">Amount received: ${REF ? `${RUPEE} [Amount]` : rupeesSp(d.amount_received)}</div>
    <div class="lrow">Balance due: ${REF ? `${RUPEE} [Balance]` : rupeesSp(d.balance_due)}</div>
  </div>
  <div class="R">
    ${sumRows.map(([a, b]) => `<div class="rrow"><span class="a">${a}</span><span class="b">${b}</span></div>`).join("")}
    <div class="grand"><span class="a">GRAND TOTAL PAYABLE (${RUPEE})</span><span class="b">${rupees(calc.grand_total)}</span></div>
  </div>
</div>
<div class="sec pd">
  <div class="lblb">Payment Details</div>
  ${bankLine1 ? `<div class="line">${esc(bankLine1)}</div>` : ""}
  ${bankLine2 ? `<div class="line">${esc(bankLine2)}</div>` : ""}
  <div class="line it">Please use the invoice number as the payment reference.</div>
</div>
<div class="sec nt"><div class="lblb">Notes / Declaration</div><p>${escMultiline(notes)}</p></div>
<div class="sig"><img src="${signatureDataUri()}" alt=""><div class="f">${esc(co.signatory_label)}</div><div class="s">Authorised Signatory</div></div>
<div class="foot"><div class="ty">Thank you for your business.</div>
<div class="co">${esc(co.name)}&nbsp;&nbsp;|&nbsp;&nbsp;${esc(co.email)}&nbsp;&nbsp;|&nbsp;&nbsp;${esc(co.phone)}&nbsp;&nbsp;|&nbsp;&nbsp;${esc(site ? `www.${site.replace(/^www\./, "")}` : "")}</div></div>
</div>`;
  return htmlDocument({ title: `Invoice ${d.number ?? "DRAFT"}`, css: CSS, body });
}
