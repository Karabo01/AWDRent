# Decisions

Decisions made on top of [spec.md](spec.md). Newest at the bottom. Each one is
binding until a later entry replaces it.

## 2026-10-08 — Phase 1 plan approved

| # | Topic | Decision |
|---|-------|----------|
| D1 | Lease PDFs and lease templates | Deferred to Phase 2. Phase 1 stores lease data only. |
| D2 | EFT reference format | `{PREFIX}-{sequence}`, sequence zero-padded to at least 4 digits, unique per agency, never reused. |
| D3 | EFT reference on renewal | A renewal keeps the lease's existing reference, so the tenant's bank beneficiary stays valid. |
| D4 | EFT reference on import | Existing references are kept on import if they are unique within the agency. The agency's sequence is then advanced past the highest imported number with the same prefix. |
| D5 | Support sessions | Read-only by default. Write access needs an explicit second confirmation and is recorded on the session. Sessions last 60 minutes, require a reason, and every action is written to the agency's audit log with the support session id. |
| D6 | Owner bank details | Only agency admins can see unmasked or edit owner bank details in Phase 1. Accounts sees them masked (last 4 digits). Revisit in Phase 3 for payouts. |
| D7 | Staff email uniqueness | A staff email is unique across the whole platform, so one email is a staff login at one agency only. |
| D8 | Portfolio limits | Agency isolation is enforced by Postgres RLS. Agent portfolio limits are enforced by one server-side policy module called from every server action and route handler, and covered by tests. |
| D9 | CI | GitHub Actions workflow in the repo. No remote yet. |
| D10 | Domains | `{agency}.awdrent.co.za` for agencies, `admin.awdrent.co.za` for the platform console; `{agency}.localhost:3000` and `admin.localhost:3000` locally. DNS is hosted at Afrihost. Wildcard TLS needs a DNS-01 challenge; see README for the recommended `_acme-challenge` CNAME delegation so renewals are automatic. |
| D11 | Percentages | Stored as integer basis points (10.5% = 1050). Money is integer cents (ZAR). |

## 2026-10-08 — Database foundation (step 2)

| # | Topic | Decision |
|---|-------|----------|
| D12 | Login tables | Better Auth's session, account, verification and two-factor tables have no `agency_id` (staff `auth_sessions` does carry one). They are readable only by the `awdrent_auth` role; the app role has no grants on them and RLS is on with no app policy. The platform admin TOTP secret lives in `platform_two_factors` (encrypted by Better Auth), not in a `platform_admins.totp_secret` column. |
| D13 | Cross-agency references | Every foreign key between agency-scoped tables is composite on `(agency_id, id)`. Postgres checks foreign keys without RLS, so a plain `owner_id` reference could point at another agency's row. |

## 2026-10-08 — Owners, properties and portfolios (step 7)

| # | Topic | Decision |
|---|-------|----------|
| D14 | What agents see | Properties assigned to them; units of those properties; owners who have one of those properties or whom the agent created. A property an agent creates is put in their own portfolio automatically. Only admins assign portfolios. |
| D15 | Deleting records | Owners, properties and units are archived, never deleted, so audit history and future ledgers stay intact. The app role has no DELETE on them. |
| D16 | Owner identity numbers | SA ID numbers are validated (date and Luhn check digit). Passports and company/trust registration numbers are accepted as 5–20 letters, digits or slashes. Stored encrypted with a per-agency blind index for duplicate checks. |

## 2026-10-08 — Tenants and leases (step 8)

| # | Topic | Decision |
|---|-------|----------|
| D17 | Lease terms | A lease is one row for the whole tenancy. Renewal, escalation and amendments update it and append a `lease_events` row with before/after, so the EFT reference (D3) and the Phase 2 balance continue across terms. Events are append-only. |
| D18 | Due day 29–31 | Stored as given (1–31). In shorter months rent is due on the month's last day. Applies when charges are raised in Phase 2. |
| D19 | Overlapping leases | A unit cannot have two active/notice-given leases with overlapping dates (database exclusion constraint). Drafts may overlap, e.g. preparing the next tenant's lease during a notice period. |
| D20 | Escalation | Applied by a staff action in Phase 1 (automatic from Phase 2): rent × (1 + %) rounded half-up to the cent with integer maths; the next escalation date moves on one year. |
| D21 | Imported EFT references | Any bank-safe reference is accepted on import: uppercase letters, digits and dashes, 3–20 characters. Generated ones are always `PREFIX-NNNN`. |

## 2026-10-08 — Documents (step 9)

| # | Topic | Decision |
|---|-------|----------|
| D22 | What a document belongs to | One nullable column per subject (owner, property, unit, tenant, lease) with a check that exactly one is set, instead of the spec's polymorphic `owner_type`/`owner_id`. Each is a composite `(agency_id, id)` foreign key, so a document cannot be attached across agencies. Phase 3 adds maintenance requests and applications the same way. |
| D23 | Upload pipeline | Type is detected from the file's bytes (PDF, JPEG, PNG only), 10 MB limit. Files land in `agencies/{id}/quarantine/`, are scanned by ClamAV in the worker (5 attempts, then marked "could not be checked"), and move to `agencies/{id}/files/` when clean. Infected files are deleted. A sweep every 5 minutes re-queues scans that were never queued (e.g. Redis was down). |
| D24 | Downloads | Only clean files, through `/documents/{id}/download`, which checks access, writes an audit entry and redirects to a 5-minute signed link. Read-only support sessions cannot download (the audit entry is a write). Only admins delete documents. |
| D25 | Object storage | Open-source MinIO is archived and no longer receives security updates (dl.min.io, 2026). Replaced by self-hosted SeaweedFS; see "Answers before Phase 2" below. |

## 2026-10-08 — CSV import (step 10)

| # | Topic | Decision |
|---|-------|----------|
| D26 | Import design | Five CSV templates linked by the agency's own reference codes (see `docs/import-template.md`). "Check files" validates with the form rules and writes nothing; "Import" re-checks and imports in one transaction, all or nothing. Runs in the web request (up to 5,000 rows per file, 2 MB per file) rather than the worker: one-off, small, and the admin sees the result immediately. Every attempt is recorded in `import_jobs` (failures store file/row/column only, no cell values). |
| D27 | Money limits | Rent and deposit are capped at R10 million so no amount can overflow its column; checked by the form/import rules before the database. |

## 2026-10-08 — Answers before Phase 2

| # | Topic | Decision |
|---|-------|----------|
| D25 | Object storage (resolved) | Self-hosted SeaweedFS 4.48, single node, in the compose stack. Private bucket (anonymous requests refused), created by the migrate service. File contents encrypted at rest with `-s3.encryptVolumeData` and `-filer.encryptVolumeData`; without the S3 flag, S3 uploads were stored in plain text (checked). Backups take the whole `/data` volume, because the per-file keys are kept in SeaweedFS metadata. |
| D28 | Wildcard TLS | DNS stays at Afrihost. `_acme-challenge.awdrent.co.za` is delegated by CNAME to a zone with an API, which Traefik updates for DNS-01 renewals. Steps in the README. |
| D29 | Bank statement format | Parked until the agency confirms its bank and export format. |
| D30 | Late fees | Parked. Phase 2 raises no automatic late fees; staff can still add a late-fee charge by hand. |
| D31 | SMS provider | Clickatell. |
| D32 | POP inbox | IMAP polling of a dedicated mailbox. |
| D33 | Approving a POP | Approving a proof of payment means linking it to a matching trust-account bank line; that link is what creates the approved payment. A POP on its own never changes the balance (spec). |
| D34 | Payment allocation | A payment pays off the oldest unpaid charge first (by due date, then created time); any excess is a credit carried forward. |

## 2026-10-08 — Phase 2 plan approved

| # | Topic | Decision |
|---|-------|----------|
| D35 | Part months | A full month's rent is charged for every month a lease is live, including the first and last month. No pro-rata. |
| D36 | Bank statement import | A general CSV import; each agency saves which columns hold the date, amount, reference and description, and the date format. Bank-specific formats can be added once D29 is settled. |
| D37 | POP mailbox | One AWDRent mailbox read over IMAP. Each agency gets its own address on it, `pop+{subdomain}@awdrent.co.za`; agencies forward their own `pop@` address there. |
| D38 | Clickatell account | One AWDTECH account. Each agency's sender ID is registered under it; SMS cost is recharged through the per-agency usage counts. |
| D39 | SMS opt-out | An opt-out link in the SMS and in the tenant portal. No "reply STOP" for now (needs a two-way number). |
| D40 | Deposit interest | Recorded as the bank actually pays it, entered from the investment account statement, rather than calculated from a rate. (Proposed in the Phase 2 plan; not objected to.) |
| D41 | Tenant and owner logins | A third Better Auth instance with its own tables: one-time codes by email or SMS (10-minute expiry, 5 attempts), rate limited, valid only on the agency's own host, no passwords. (Proposed in the Phase 2 plan; not objected to.) |

## 2026-10-08 — Rent ledger (Phase 2, step 1)

| # | Topic | Decision |
|---|-------|----------|
| D42 | Charges are never edited | A charge cannot be changed or deleted. A mistake is voided with a reason (audited) and, if needed, a corrected charge is added. Voided charges stay visible on the statement. |
| D43 | Allocation is computed | Payments are not stored against charges. Which charges are paid is worked out oldest-first each time (D34), so voiding a charge or adding a payment can never leave stale allocations. The balance is always charges minus approved payments (spec). |
| D44 | When billing starts | Each lease has a "bill rent from" month, defaulting to its start month and editable while it is a draft. Rent is raised for every month from then until the lease ends, up to the current month, on the 1st of the month (due on the lease's due day, D18). Activating a lease raises any months already started. |
| D45 | Imported leases | Imported leases start billing in the month after the import unless the file says otherwise (`billing_starts`), so months already settled in the old system are not charged again. An `opening_balance` column brings over arrears (a charge) or credit (a payment marked "opening balance", the only payment not tied to a bank line). **To confirm with the agency during migration.** |
| D46 | Escalations | Applied automatically by the daily job on the escalation date, before that day's rent is raised (completes D20). |
