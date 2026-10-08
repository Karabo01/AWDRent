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
| D25 | Object storage — **open** | Open-source MinIO is archived and no longer receives security updates (dl.min.io, 2026). The code uses plain S3 calls, so any S3-compatible store works. Needs a decision before go-live; see the Phase 1 summary. Local testing used SeaweedFS. |
