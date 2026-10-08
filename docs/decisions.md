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
