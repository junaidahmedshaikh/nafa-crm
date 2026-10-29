# NAFA Business OS — Phase 1

Private internal CRM for **NAFA Events & Activations**: leads, companies, contacts, follow-ups, a live dashboard,
CSV import/export — built on Next.js (App Router) + Supabase (Postgres, Auth, Row Level Security).

> Phase 1 is single-owner (one admin) but the data model, RLS helpers and `profiles.role` are ready for team members,
> roles and the later modules (AI qualification, Gmail, WhatsApp, quotations, vendors, projects, finance, analytics).

## Contents
1. [Features](#features) · 2. [Tech stack](#tech-stack) · 3. [Local setup](#local-setup) · 4. [Create the admin](#create-the-initial-admin) ·
5. [Scripts & tests](#scripts--tests) · 6. [Deployment](#deployment-vercel) · 7. [Security model](#security-model) ·
8. [Project structure](#project-structure) · 9. [Verification status](#verification-status) · 10. [Known limitations](#known-limitations) · 11. [Next steps](#next-steps)

## Features

| Area | What works |
|---|---|
| **Auth** | Email/password login (Supabase Auth, cookie sessions via `@supabase/ssr`), protected routes (proxy + server-side checks), logout, session-expired and "access not granted" states, no public sign-up |
| **Dashboard** | Active leads, new this month, qualified opportunities, proposals pending, won this month, overdue and due-today follow-ups, pipeline by status (with expected revenue), recent leads, upcoming follow-ups. Every metric links to the underlying records. Empty state for a new business. All figures are live database queries — nothing is hard-coded |
| **Leads** | Create / view / edit / archive / restore. Search (title, company, contact, email, phone, event), filter (status, source, service, priority, owner, created-date range), sort (created, follow-up, priority, revenue), pagination, detail page with quick actions (edit, change status, add note, schedule follow-up, mark won, mark lost with reason, archive) and an activity timeline |
| **Companies & contacts** | Normalised records; many contacts and leads per company; duplicate detection (normalised company name / website domain, email, phone) that **warns and lets you choose** instead of silently merging; archive/restore |
| **Follow-ups** | Today / Overdue / Upcoming / Completed views, complete, reschedule, cancel, jump to the lead. Completed tasks can never be pending (DB constraint). Closing a lead (won/lost) cancels its pending tasks |
| **CSV** | Import with per-row validation, duplicate detection (vs. the CRM and within the file), downloadable error report, template download; nothing is dropped silently. Export of leads (respecting current filters), companies, contacts, follow-ups. Formula-injection-safe |
| **Settings** | Business name/website/email, default country code, INR currency, default follow-up preferences, your profile |

Times are handled in **IST** (Asia/Kolkata); amounts are `numeric(14,2)` INR.

## Tech stack
Next.js 16 (App Router, Server Components + Server Actions) · TypeScript (strict) · Tailwind CSS v4 · React Hook Form + Zod ·
Supabase (Postgres, Auth, RLS) · Lucide icons · Sonner toasts · PapaParse · Vitest (+ PGlite for database tests).
UI primitives are small hand-written shadcn-style components in `src/components/ui` (no Radix dependency; the modal uses the native `<dialog>`).
Recharts was intentionally not added — the pipeline view is simple bars and does not need a chart library.

## Local setup

**Prerequisites:** Node.js 20.9+ (22 LTS recommended — `supabase-js` is dropping Node 20), npm, a Supabase project (free tier is fine).

1. **Install**
   ```bash
   npm install
   cp .env.example .env.local     # Windows PowerShell: Copy-Item .env.example .env.local
   ```
2. **Create a Supabase project** at <https://supabase.com/dashboard>. In *Project Settings → API* copy the **Project URL** and the
   **publishable key** (formerly "anon" key) into `.env.local`. Do **not** use the `service_role` key — this app never needs it.
3. **Apply the database migrations** (pick one):
   - *SQL editor:* run, in order, the files in `supabase/migrations/` —
     `…_schema.sql`, `…_rls.sql`, `…_list_views.sql`.
   - *Supabase CLI:* `npx supabase login && npx supabase link --project-ref <ref> && npx supabase db push`.
4. **Lock down sign-ups:** *Authentication → Sign In / Providers → Email* → turn **off** "Allow new users to sign up" (defence in depth —
   even if left on, accounts without a profile row cannot read or write anything).
5. **Create the initial admin** — see below.
6. **(Optional) demo data** for a *development* project only: run `supabase/seed.sql`. Every record is prefixed `[DEMO]`; the clean-up SQL is at the bottom of the file.
7. **Run:** `npm run dev` → <http://localhost:3000>

### Create the initial admin
There is no registration page. The owner is created by someone with database access (you), once:

1. Supabase Dashboard → **Authentication → Users → Add user → Create new user**: owner's email + strong password, tick **Auto Confirm User**.
2. Open `supabase/admin-setup.sql`, replace `owner@example.com` with that email, and run it in the **SQL Editor**.
   This inserts the `profiles` row (`role = 'admin'`) that RLS requires. It cannot be done from the browser/anon key.
3. Sign in at `/login`.

To add a team member later: create the auth user, then insert a `profiles` row with `role = 'member'` (or deactivate someone with `is_active = false`).
Members get the same data access in Phase 1; only admins can change business settings or hard-delete rows (the app only archives).

## Scripts & tests

| Command | Purpose |
|---|---|
| `npm run dev` / `build` / `start` | Next.js |
| `npm run typecheck` | `tsc --noEmit` (strict) |
| `npm run lint` | ESLint |
| `npm test` | Vitest: unit tests + database tests |
| `npm run check` | typecheck + lint + tests |

The **database tests** (`tests/db`) boot an in-process Postgres (PGlite), stub Supabase's `auth` schema and the `anon`/`authenticated` roles, apply
the **real migration files**, and then assert RLS (anon, authenticated-without-profile, deactivated member, admin; profile-escalation attempts;
append-only activity log), the lifecycle/follow-up triggers, the generated normalisation columns (including parity with the TypeScript normaliser),
the read views, and the seed file. The **unit tests** (`tests/unit`) cover validation, phone/date/INR handling, filters/search sanitising,
redirect safety, CSV export safety and the CSV import validator.

## Deployment (Vercel)
1. Push the repo to GitHub and import it in Vercel (framework: Next.js; Node 20.9+ or 22).
2. Set environment variables for *Production* (and Preview if used): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
3. In Supabase → *Authentication → URL Configuration* set the Site URL to your production domain.
4. Apply the migrations to the **production** project and run `admin-setup.sql` there. **Never** run `seed.sql` in production.
5. Optionally restrict the deployment (Vercel password protection / IP allow-list) as an additional layer.

## Security model
- **Authentication:** Supabase Auth; the session lives in HTTP-only cookies managed by `@supabase/ssr`. The proxy (`src/proxy.ts`) refreshes the session and redirects anonymous visitors to `/login`.
- **Authorisation, three layers:** (1) proxy redirect; (2) every page/route handler calls `requireMember()` and every Server Action runs inside `authorized()`, which re-validates the user *and* that an active `profiles` row exists; (3) **RLS** on every table, so even a leaked anon key can read nothing.
- **RLS:** all tables enabled; `anon` has no grants; `authenticated` access requires `is_team_member()` (active profile). `profiles` has no INSERT policy and its `role`/`is_active` columns are not client-writable; `lead_activities` is append-only; settings are admin-writable; hard deletes are admin-only.
- **No secrets in the browser:** only the public URL and anon key are used (and only server-side). There is no service-role key anywhere. The built client bundle was scanned for the URL, key and `service_role`.
- **Input handling:** Zod validation on the client for UX *and* again on the server for every mutation; PostgREST `or(...)` search strings are sanitised; redirects after login are restricted to same-site paths; CSV exports neutralise spreadsheet formulas; security headers (X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy) are set.
- Audit fields (`created_at`, `updated_at`, `created_by`, `closed_at`, activity log) are generated by the database, not the client.

## Project structure
```
supabase/
  migrations/           schema, RLS + views, list views
  admin-setup.sql       one-time admin bootstrap (no credentials)
  seed.sql              development-only demo data ([DEMO] prefixed)
src/
  proxy.ts              session refresh + route protection
  app/(auth)/login      sign-in
  app/(app)/…           dashboard, leads, companies, contacts, followups, settings
  app/api/export/…      authenticated CSV downloads
  lib/
    actions/            Server Actions (leads, directory, followups, import, settings, auth)
    data/               server-side queries (leads, directory, followups, dashboard, duplicate lookup)
    validation/         Zod schemas shared by forms and actions
    csv.ts normalize.ts datetime.ts lead-filters.ts …   pure, unit-tested logic
    supabase/           server client + proxy session helper
  components/           ui primitives, layout shell, feature components
tests/                  unit + database (PGlite) tests
```
Adding a future module (e.g. quotations) means: a new migration, a new `lib/data` + `lib/actions` pair, a new route folder, and one entry in `app-shell.tsx` navigation.

## Verification status
Executed in the development environment: TypeScript (strict) ✔, ESLint ✔, 51 automated tests ✔ (unit + database/RLS), production `next build` ✔,
runtime smoke test of the built server (all protected routes redirect anonymous users to `/login`; stale-cookie path shows "session expired"; security headers present) ✔,
client-bundle scan for credentials ✔.

**Not yet verified against a live Supabase project** (no project/credentials were available): the real GoTrue login round-trip, PostgREST query behaviour
(filters, views, embedded `author:profiles(full_name)` on activities), and click-through of the authenticated screens in a browser. The SQL itself *is* tested
(real migrations on real Postgres). Before relying on it, do a first-run pass: log in, create a lead, schedule/complete a follow-up, import
`nafa-lead-import-template.csv`, export, and confirm a second (profile-less) auth user sees nothing.

## Known limitations
- Single business owner in practice; no team-management UI yet (members are added via SQL). Roles exist in the schema but all active members have equal access.
- Duplicate handling is **warn-and-choose** (reuse existing, create new, or save anyway); there is no merge tool for existing duplicates yet.
- Editing a lead updates its linked contact in place (so fixing a typo propagates); changing the company on a lead re-links or creates a company — it never renames a shared company record.
- CSV import is limited to 300 rows per file and is atomic per step (companies → contacts → leads); if the lead insert fails nothing is added to leads, though companies/contacts created in the earlier steps remain.
- Search is `ILIKE`-based (fine for thousands of leads); add `pg_trgm` indexes if data grows large.
- Reminders are shown in the app only; no email/WhatsApp notifications (Phase 2+).
- Node 20 works but `supabase-js` prints a deprecation notice; use Node 22.

## Next steps (not built, by design)
AI lead qualification & sales assistant · Gmail/email sync · WhatsApp Business Platform · automated follow-up sequences · quotation/proposal generation ·
vendor & manpower management · event project management · expenses, payments & profitability · analytics · team invitations and role-based permissions · merge tool for duplicates · generated Supabase types (`supabase gen types`).


---

# Phase 2 — Quotations, Proposals & Invoices

Extends the Phase 1 CRM (same Next.js app, same Supabase project, same auth/RLS). Nothing from Phase 1 was removed; the sidebar gained a **Documents** group and the lead page gained “+ Quotation / + Proposal / + Invoice” shortcuts.

## What was added

| Module | Route(s) | Highlights |
|---|---|---|
| Quotations | `/quotations`, `/new`, `/[id]`, `/[id]/edit` | Builder with live totals + preview; line items (add/edit/delete/reorder, decimals, item notes, item discounts); configurable agency fee / document discount / tax (none · CGST+SGST · IGST) / other charges / round-off; editable payment milestones that must reconcile to the total; per-document terms. Draft → issue → sent → accepted / rejected / expired → revise · duplicate · convert to invoice; activity history |
| Proposals | `/proposals`, `/new`, `/[id]`, `/[id]/edit` | 15 standard, reorderable, switch-off-able sections + custom sections; images with preserved aspect ratio; commercial summary linked to a quotation or written manually; “missing section” warnings; revisions; multi-page PDF |
| Invoices | `/invoices`, `/new`, `/[id]`, `/[id]/edit` | Same builder plus HSN/SAC, place of supply, due date; issue (number + immutable snapshot), cancel with reason, “create corrected draft”; payment status is derived (Draft · Issued · Partially paid · Paid · Overdue · Cancelled) |
| Payments | `/payments` (+ panel on each invoice) | Multiple payments per invoice (advance/partial), method, reference, notes; void with reason; never more than the balance; an advance is a payment, not a discount |
| Products & Services | `/products-services` | Catalogue with unit, default rate, HSN/SAC, GST %, active flag. Catalogue edits never change issued documents |
| Document settings | `/settings/documents` | Company details, **bank/UPI details (admin-only edit)**, tax/fee/validity defaults, default terms and milestones, invoice wording, conditional “GST not charged” declaration, numbering prefix/padding/next number |
| PDF | `/api/documents/{quotation,invoice,proposal}/{id}/pdf` | Chromium-rendered A4 PDFs, real selectable text, embedded fonts |
| Email | modal on each issued document | Recipient, subject, message and PDF are reviewed before an explicit confirmation; recorded as *sent* only when the provider confirms |

## Apply the database migration

Phase 2 adds one migration: `supabase/migrations/20261029000001_documents.sql`.

* **You already set up Phase 1:** open the Supabase **SQL Editor**, paste the contents of that single file and run it once.
* **Fresh project:** run `supabase/setup-all.sql` (all migrations), then `supabase/admin-setup.sql`.
* *(Optional)* `supabase/document-settings-from-template.sql` fills the bank/UPI fields with the values printed on the original invoice template. Review before running, or type them in **Settings → Documents** (admins only).

## New requirements & configuration

| Need | Detail |
|---|---|
| **Chromium for PDFs** | Run `npx playwright-core install chromium` once per machine (about 150 MB). On a server or Docker image set `PDF_CHROMIUM_PATH` to an installed Chrome/Chromium, and `PDF_CHROMIUM_NO_SANDBOX=1` if it runs as root in a container. |
| **Vercel / serverless** | Vercel functions have no Chromium. Use a long-running Node host (Render, Railway, Fly, a VPS, Docker), or swap `launch()` in `src/lib/documents/pdf.ts` for `@sparticuz/chromium` (not implemented or tested here). |
| **Email (optional)** | `RESEND_API_KEY` and `EMAIL_FROM` (verified sender), server-side only. Without them the Email dialog explains that sending is switched off and nothing can be sent. Resend is the only provider implemented; WhatsApp is intentionally not included. |
| **Fonts / logo** | Bundled in `src/assets` (Quattrocento Sans + Arimo under the SIL OFL; the logo and signature were extracted from your PDFs). No network access is needed at render time. |

New environment variables are listed in `.env.example`. No service-role key is used anywhere.

## How the financial engine works (`src/lib/documents/calc.ts`)

Decimal arithmetic (`decimal.js`), no floating point for money. The order of operations, also shown in the builder:

1. line amount = qty × rate → item discount (never more than the line) → **subtotal**
2. document discount (percent or fixed, capped at the subtotal)
3. **agency fee** = rate × (subtotal after discount, or the gross subtotal — selectable)
4. **taxable value** = after-discount subtotal + agency fee + *taxable* other charges
5. **tax** on the taxable value: CGST + SGST (rate/2 each) · IGST (full rate) · none — chosen by the user, never inferred from the client's address
6. non-taxable other charges are added after tax; an optional round-off to the nearest rupee is shown as its own line

Every component is rounded half-up to 2 dp and the total is the sum of the rounded parts, so printed lines always add up. Percentage milestones are shares of the grand total; when they sum to exactly 100% the last one absorbs the rounding remainder; any other mismatch blocks issuing. The server recomputes all totals on save — client-side numbers are only for live display.

## Document lifecycle, numbering and snapshots

* **Drafts have no number** and show “DRAFT”. The number is allocated **when you issue** (`next_document_number`: one row-locked `UPDATE`, so simultaneous requests queue and cannot collide). Numbers are never reused and the counter can only go up. Formats are configurable (`NAFA-Q-001`, `NAFA-P-001`, `NAFA-INV-001` by default).
* **Issuing** stores an immutable JSON **snapshot** (rates, descriptions, fees, tax settings, bank details, wording). Issued documents render from the snapshot, so later catalogue or settings edits never alter them.
* **Locked after issue:** triggers reject edits to an issued document and to its items/sections/milestone structure, changes to its number, and out-of-order status changes. Quotations: revise (a new draft that supersedes the old one when issued) or duplicate. Invoices: cancel with a reason (only when no live payments exist — void them first) and create a corrected draft.
* **Convert quotation → invoice** (`convert_quotation_to_invoice`): only accepted quotations; copies client, project, items, prices and tax/discount settings; keeps the link and quotation number; creates a *draft* you can adjust before issuing. A second conversion needs explicit confirmation (cancelled invoices don't count).
* An accepted quotation is never treated as an invoice or a payment.

## Security notes for Phase 2

All new tables have RLS (team members only, no anon access). Bank details live in `document_settings`: readable by signed-in team members, writable by admins only, and never returned by any unauthenticated route. The PDF route authenticates the caller and relies on RLS. Document numbers can only be written by the SQL functions (guard trigger); payments cannot exceed the balance (row-locked); activity and email logs are append-only; save/issue/convert run as SQL functions so multi-row changes are atomic. Server actions re-validate everything with Zod and never trust client totals.

## PDF fidelity: how the templates were reproduced and checked

The two supplied PDFs (`template/`) were inspected with PyMuPDF: page size (A4), every text span's position, size, colour and font, the rules and their weights, and the embedded logo/signature images (extracted and reused). The templates (`src/lib/documents/templates/quotation.ts` and `invoice.ts`) are HTML/CSS positioned from those measurements and rendered by Chromium.

**Comparison workflow** (QA tooling; needs `pip install pymupdf pillow`):

```bash
npm run render:samples        # writes generated/*.pdf (reference layout, realistic data, 40-line stress, proposal)
python scripts/compare_pdfs.py template/NAFA_Quotation_Template.pdf generated/reference-quotation.pdf out/quotation
python scripts/compare_pdfs.py template/NAFA_Invoice_Template.pdf   generated/reference-invoice.pdf   out/invoice
```

It renders both PDFs at 150 dpi, writes a side-by-side image and a red/cyan overlay, and prints the x/y/width offset of every matching text span. Results are committed in `docs/comparison/`; the generated PDFs are in `docs/samples/`.

**Measured result (same placeholder data as the templates):** the quotation's text elements are within about ±1.5 pt (0.5 mm) vertically and ±2–3 pt horizontally of the original, and the invoice's within about ±1 pt, with identical page size, logo size and position, rule weights, column edges and footer placement. This is a close visual reproduction, **not** a pixel-identical one.

### Remaining differences

1. **Font rendering:** the originals were exported from Google Sheets with an older Quattrocento Sans build; the bundled OFL version measures about 4 % wider (regular) / narrower (bold). Small letter-spacing compensation brings widths within about 1 pt, but glyph shapes and hinting differ slightly. ₹ uses Arimo (Arial-metric), as the original uses Arial.
2. **Title and meta widths:** “QUOTATION” / “INVOICE” use CSS letter-spacing instead of literal spaces, so they select and copy as one word; right edges align to within about 1 pt.
3. **Quotation page 2:** the original spills its footer onto a second page (a spreadsheet pagination artifact). Here the footer sits under the terms rule on the same page.
4. **Terms line 2:** the original wraps “…and expenses incurred” because of stray spaces in its source cell; ours does not. Terms are numbered `1.   text` with consistent spacing.
5. **Quotation tax line:** one “GST (18%)” row like the original (the CGST/SGST split is itemised on the invoice). Agency-fee/GST rows print amounts; the template leaves them blank.
6. **Item rows:** the original quotation has no row rules in its empty item area; filled rows use the same hairline as its milestone table. The invoice pads to 10 ruled rows like the original but omits the printed numbers 2–10 on empty rows.
7. **Invoice horizontal extent:** the original is a scaled sheet whose content ends at x = 501 pt (about 94 pt right margin). That geometry is reproduced as-is. The HSN/SAC column is centred (the original header and placeholder are centred on different x positions).
8. **Dynamic invoice rows:** the original prints seven summary rows with placeholders; real invoices show only the applicable rows (no zero tax rows) and the “GST has not been charged” sentence only when no GST is charged. A QA-only `referenceLayout` option prints all placeholder rows for geometry comparison.
9. **Added content the templates lack (required by the brief):** address / GSTIN / contact lines, discount lines, “Page x of y” on multi-page documents, repeated table headers on continuation pages.

## Tests

`npm test` runs **116 tests**: the financial engine; template and validation unit tests; database tests on real Postgres (PGlite) covering numbering, locking, snapshots, conversion, payments, derived status and RLS; and **real PDF generation tests** (Chromium + pdf.js text extraction: single-page quotation/invoice, 45-line multi-page documents with repeated headers, page numbers and no lost rows, long names, a multi-page proposal, image sizing). PDF tests skip themselves if no Chromium is installed.

**Not covered by automated tests** (needs a live Supabase project and a browser): the Next.js server actions end-to-end against Supabase Auth/PostgREST (the SQL they call is tested), the interactive builder forms, and real email delivery. First-run checklist: create a quotation from a lead → issue → mark accepted → convert → adjust → issue the invoice → record an advance and a final payment → download/open all three PDFs → confirm a second (profile-less) user sees nothing.

## Known limitations (Phase 2)

* Concurrency safety comes from Postgres row locks. The automated test fires simultaneous requests at an in-process Postgres (one connection), so it proves the uniqueness/sequence logic rather than multi-connection contention.
* Proposal images are stored inline in Postgres (≤ 2 MB each, ≤ 30 per proposal) to avoid extra storage setup; move to Supabase Storage if proposals get image-heavy. Images attach only to *saved* sections.
* One currency (INR); no credit notes, recurring invoices or partial invoicing against a quotation (use “additional invoice” and edit it).
* Tax treatment and place of supply are chosen by the user and never inferred; no GST-return or e-invoice (IRN) integration.
* Email: Resend only; no bounce/delivery webhooks, so a message is recorded as “sent” when the provider accepts it, not when it is delivered.
* PDF generation needs a Chromium-capable host (see above) and takes roughly 1–2 s per document.
