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

---

## Project Budget & Profit Management

Per-project budgets, expenses, vendor payments, reimbursements and profit. Routes: `/finance` (dashboard), `/projects`, `/projects/[id]`, `/finance/vendors`, `/finance/reimbursements`.

### Setup

1. Run `supabase/migrations/20261031000001_project_finance.sql` in the Supabase SQL editor (fresh projects: `supabase/setup-all.sql` already includes it).
2. **Grant finance access.** Existing team members get **no** access to financial data by default. Administrators (`profiles.role = 'admin'`) always have full access. For everyone else set a finance role:

```sql
update public.profiles set finance_role = 'accounts'   -- none | operations | project_manager | accounts | management
where id = (select id from auth.users where email = 'person@example.com');
```

| Role | Can do |
|---|---|
| admin (Super Admin) | everything, including restoring deleted records and reading the audit log |
| management | everything except restoring deleted records; reads the audit log |
| accounts | create/edit projects, expenses, payments, budgets, reimbursements; approve; soft-delete |
| project_manager | on **assigned** projects only: see budget and expenses, add expenses (need approval). Never sees revenue or profit |
| operations | on **assigned** projects only: submit expenses and reimbursements for themselves |

"Assigned" means ticked under *Team access* on the project.

### How the money is counted
* Revenue and cost are **GST-exclusive**. GST collected and recoverable input GST are shown separately and never enter profit. GST on a bill counts as a cost only if you untick "recoverable".
* Revenue = approved project value + approved additional charges + approved change orders.
* Every expense has a short **Title** (required) and optional **Details**. The project's Overview lists each expense by title under its category inside the Profit & Loss ("Expense details"), with the category's share of total expenses, its budget, recoverable GST shown but not counted, and reimbursements marked as such. Needs migration `20261103000001_expense_title.sql` (existing expenses get their old description as the title).
* Cost = approved, non-deleted expenses + approved/reimbursed reimbursements that are **not linked to an expense** (so nothing is counted twice).
* Expenses entered by project managers/operations are *submitted* and do not count (and cannot be paid) until accounts approve them.
* Client payments are not duplicated: link an issued invoice to a project and its payments are read from the existing invoice payments.
* Payments are never deleted, only voided; an identical payment (same bill, date, amount, reference) is rejected as a duplicate; payments cannot exceed the bill.
* Deleting is a soft delete (kept in the audit log); only an administrator can restore.
* Dashboard period: a project belongs to the period of its **start date** (created date if none). "This year" is the Indian financial year (Apr–Mar). Weeks start on Monday.

### Not built yet
Excel import of expenses; PDF/Excel/CSV report exports; bill/receipt file attachments (needs a Supabase Storage bucket and policies); email/push notifications for budget alerts (alerts currently show on the dashboard and project budget tab); a screen for assigning finance roles (use the SQL above); a vendor edit screen (vendors are created from the expense form).

---

## App installation tracking (PWA)

The CRM is an installable web app (manifest, icons, service worker). When someone installs it or opens it from their home screen, an alert appears in the notification bell of every administrator (plus anyone chosen in the preferences).

### Setup
1. Run `supabase/migrations/20261101000001_app_installs.sql` in the Supabase SQL editor (fresh projects: `setup-all.sql` already includes it).
2. Optional email alerts: set `RESEND_API_KEY` and `EMAIL_FROM` (same variables as quotation emails), then tick *Also send an email* and add addresses under **Settings → App installations**.
3. Live bell updates use Supabase Realtime. The migration adds the `notifications` table to the `supabase_realtime` publication; without it the bell still refreshes every minute.

### How installs are detected
| Platform | Detection |
|---|---|
| Android / desktop Chrome and Edge | the browser `appinstalled` event, then the first launch in standalone mode |
| iPhone / iPad | no install event exists, so the **first launch in standalone (home-screen) mode** is treated as the install |
| Any browser tab | never counted |

Each browser gets a random device id (stored in `localStorage`); one row per user and device, so one person can have several devices and an alert is raised once per device. Only platform family, browser name and timestamps are stored: no contacts, files, location, IP address or user-agent string.

### Where to look
* **Settings → App installations** (administrators only): totals, Android / iOS / desktop counts, installs today, filters by period, user, device and status, device-wise records, user-wise history, and notification preferences.
* **Settings** (everyone): an *Install app* button, or Add-to-Home-Screen steps on iPhone/iPad.

### Limits
* Clearing site data creates a new device id, so that device can be counted again.
* Uninstalling cannot be detected by any browser, so there is no "uninstalled" status.
* Web push notifications are not built. In-app (live) and email alerts are.
* "Assigned team administrator" has no equivalent in this CRM (there are no teams); pick extra recipients individually instead.

---

## Dark mode and theming

Each user can choose **Light**, **Dark** or **System default** (follows the device) from the account menu (top-right avatar → Appearance) or **Settings → Appearance**. It applies instantly, is saved to their profile, and is applied again on every sign-in and device. Until someone chooses, everyone keeps the existing light look.

### Setup
Run `supabase/migrations/20261102000001_theme_preference.sql` in the Supabase SQL editor (fresh projects: `setup-all.sql` already includes it). Until it is run the app keeps working in light mode and the choice is remembered on that device only.

### How it works
* **Design tokens**: all colours live in `src/app/globals.css`. `:root` is the light theme; `.dark` overrides the same tokens. Components use token classes (`bg-surface`, `text-muted`, `border-border`, `bg-accent`...) and never hardcode theme colours. A new module gets both themes for free as long as it does the same.
* **Palette** (raw values are available as `--brand-*`):

| Colour | Hex | Used for (dark) |
|---|---|---|
| Dark Tone Ink | `#111511` | page background (also the light theme's sidebar) |
| Vantablack | `#000100` | sidebar and login background |
| November Storms | `#40433B` | borders, active navigation item, inputs |
| Almond Cookie | `#EEC679` | the main highlight: primary buttons, links, focus ring, active items |
| Lightish Green | `#60E06E` | success and positive figures |
| Cricket Green | `#697C68` | secondary button outline and hover |

* **Light theme** is unchanged apart from the palette showing up in the sidebar and a soft Almond tint, and three text colours (accent, success, warning) darkened a shade so badges meet WCAG AA.
* **No flash on load**: a tiny inline script in `<head>` reads the `nafa_theme` cookie and sets the `dark` class before first paint; the sign-in action sets that cookie from the saved preference.
* **Contrast**: `tests/unit/theme.test.ts` computes WCAG contrast from the real tokens for both themes (body text 7:1, secondary text, badges, buttons 4.5:1 or better).
* Printed documents (quotation, invoice and proposal PDFs and their previews) are paper and stay white in both themes.
* Adding a colour: add it to both `:root` and `.dark`, expose it under `@theme inline`, and the contrast test will tell you if a text/background pair is too weak.

## Invoice terms & conditions

Every invoice prints **common terms** (payment due date, pay only to the account/UPI on the invoice, GST, payment reference, 7-day discrepancy window, cheques, advances adjusted, Mumbai jurisdiction) plus the **terms for the invoice's event type**: weddings & social celebrations, corporate events, BTL activations & brand campaigns, exhibition stalls & fabrication, or manpower & staffing. Choose it on the invoice form (**Terms & conditions for**). Leave it on "Common terms only" for anything else. Quotation terms (cancellation, scope, venue rules) are separate and unchanged.

### Setup
Run `supabase/migrations/20261105000001_invoice_terms.sql` in the Supabase SQL editor (fresh projects: `setup-all.sql` already includes it). Until it is run the invoice form's choice is not saved, the settings editor is hidden, and invoices print without a terms section.

### Editing the wording
**Settings → Documents → Invoice terms & conditions** (admin): one clause per line for the common block and for each event type. Leave a block untouched to use the built-in wording (`src/lib/documents/invoice-terms.ts`).
* **Udyam number**: enter it in the same section. It fills the MSME clause in the corporate and BTL terms. With no Udyam number those MSME clauses are left out of invoices (so a blank "Udyam No. [___]" never prints).
* **Frozen when issued**: the terms are saved onto the invoice when it is issued, so editing the wording later never changes an invoice already issued. Drafts always use the current wording. Invoices issued before this feature print no terms section.
* **Layout**: terms follow the notes. An invoice with terms normally runs to two pages; headings never sit alone at the bottom of a page.
* **Review**: the supplied wording is a template. Have your CA review the GST, TDS and MSME wording and a lawyer review the jurisdiction and damages clauses once. Keep your bank/UPI details current in Settings → Documents and tell clients directly before ever changing them.

## Send by Email (invoices, quotations, proposals)

**Send by Email** is on each issued document's page and as a mail icon in the Invoices and Quotations lists. It opens a composer with:

* **To** filled from the client email saved on the document, else the linked contact, else a contact of the linked company. If none exists a warning is shown and the address is typed in by hand (the client record is not changed).
* Optional **CC / BCC** (comma-separated, up to 10 each), an editable **subject** and **message** (templates in `src/lib/documents/email-template.ts`).
* The document's PDF attached automatically, with an inline **Preview PDF**.
* A final confirmation tick box — nothing is sent without it. The send button shows a loading state and each opened composer carries an idempotency key, so a double click cannot deliver twice.

**View Email History** on the document page lists every attempt: recipient, CC/BCC, subject, date and time, Sent / Failed (with the provider's error), body, attachment name and the CRM user who sent it. An email is recorded as *Sent* only when Resend accepts it and returns a message id; a PDF or provider failure is recorded as *Failed*.

### Setup
Run `supabase/migrations/20261117000001_document_email_history.sql` in the Supabase SQL editor (fresh projects: `setup-all.sql` already includes it). It only adds three columns to `document_emails`. Until it is run, sending and the history still work, but CC/BCC and the attachment name are not saved in the history.

Sending uses the existing Resend configuration (`RESEND_API_KEY`, `EMAIL_FROM`); there is no second email system.

## Payment notifications, scheduled follow-ups, finance reports and the expandable sidebar

### What was added
| Area | Where | Notes |
| --- | --- | --- |
| Scheduled emails / follow-ups | `/scheduled-emails`, plus a **Schedule follow-up** button on contacts, leads, quotations, invoices and projects | Send now, schedule for later (date, time, time zone; default Asia/Kolkata) or save as draft. Edit, reschedule, cancel or send immediately from the list. Optional quotation / invoice PDF attachment. |
| Payment reminders | `/payment-reminders`, plus **Payment reminder** on an issued invoice | Outstanding invoices, one-off reminders (now or scheduled), per-invoice automatic switch, reminder history with delivery status, and the automatic rules (7 / 3 / 1 days before, on the due date, 3 / 7 / 15 days after). Automatic reminders are **off** until an admin / accounts / management user switches them on. |
| Notification centre | bell in the top bar, `/notifications` | Payment received (full / partial), invoice due soon / due today / overdue, scheduled email sent / failed, follow-up due today, expense recorded, budget exceeded, profitability warning. Unread count, mark one / all as read, filter by type, per-user preferences. |
| Finance reports | `/finance/reports` | Project-wise value, invoiced, received, outstanding, estimated and actual expenses, unpaid vendor bills, gross profit and margin, plus the expense register. Filters: project, client, date range, category, payment status. Export to CSV (opens in Excel) and Print / Save PDF. |
| Dashboard | `/` | Pending payments card: client, invoice, project, pending amount, due date. |
| Sidebar | everywhere | Expandable sections with a chevron, active section and page highlighted, state remembered per device. In the collapsed (icon) sidebar a section opens as a fly-out on hover or click. All existing routes are unchanged. |

### Setup
1. Run `supabase/migrations/20261117000001_document_email_history.sql` and then `supabase/migrations/20261118000001_scheduled_emails_reminders.sql` in the Supabase SQL editor (fresh projects: `setup-all.sql` already includes both). Both are additive: new tables and columns only, no existing row is changed. Take a database backup (Supabase Dashboard → Database → Backups) before running them.
2. Environment (same variables the CRM already uses): `RESEND_API_KEY`, `EMAIL_FROM`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`. Without the service-role key the scheduler cannot run and notifications are not created; sending now from the screen still works.
3. Scheduler. `vercel.json` calls `/api/cron/scheduled` once a day at 10:00 IST. That is enough for automatic payment reminders and the due / overdue alerts. For a scheduled email to leave at the minute it was scheduled for, the route must also be called every 5–10 minutes with `Authorization: Bearer $CRON_SECRET`: use Vercel Cron on a paid plan (`*/10 * * * *`), an external pinger, or Supabase pg_cron + pg_net:

```sql
select cron.schedule('nafa-scheduled-emails', '*/10 * * * *', $$
  select net.http_get(url := 'https://nafa-crm.vercel.app/api/cron/scheduled',
                      headers := jsonb_build_object('Authorization', 'Bearer <CRON_SECRET>'));
$$);
```

### How sending is kept safe
* Nothing is sent unless a person chose Send now or Schedule, or a manager switched automatic reminders on.
* The scheduler claims each email with a conditional update, so two overlapping runs cannot both send it. Every send carries a provider idempotency key (email id + revision), so a retry cannot deliver twice.
* An email is marked **Sent** only when Resend returns a message id. Temporary failures (rate limit, outage, network) are retried after 5, 30 and 120 minutes, then marked **Failed** and the person who scheduled it is notified.
* A payment reminder is cancelled instead of sent when the invoice has been paid in full or cancelled; recording the final payment or cancelling the invoice also cancels its waiting reminders. Each automatic rule creates at most one reminder per invoice, ever.
* A follow-up is cancelled when a reply from that address has been recorded in Replies & Engagement (Gmail reply monitoring) after it was scheduled.
* A sent email can never be edited or re-queued (database trigger), and scheduled emails cannot be deleted, only cancelled.

### Roles
Existing roles are reused. Invoices, payments, scheduled emails and reminders are available to every team member, as invoices already were. Automatic reminder settings can be changed by admin / accounts / management only. Project finance, revenue, profit and the finance exports follow the existing finance roles (RLS in the database, re-checked in the export route). Money notifications go to administrators and the accounts / management roles.

### Not built in this round
* Bill / receipt file attachments on expenses (needs a Supabase Storage bucket and policies).
* Separate Deals, Project Tasks, Team / Staffing and Event Operations modules: the CRM has no such modules yet, so the sidebar lists only pages that exist (leads are the pipeline; follow-ups are the task list).
* A user-management / roles screen (finance roles are still assigned with the SQL shown above).
* Native .xlsx and server-generated report PDFs: exports are CSV (opens in Excel) and the browser's Save as PDF.
* Project profit keeps the existing rule: approved expenses count as cost whether or not the vendor has been paid; paid and unpaid amounts are shown beside it.
