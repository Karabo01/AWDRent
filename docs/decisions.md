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
| D40 | Deposit interest | Recorded as the bank actually pays it, entered from the investment account statement, rather than calculated from a rate. Confirmed. |
| D41 | Tenant and owner logins | A third Better Auth instance with its own tables: one-time codes by email or SMS (10-minute expiry, 5 attempts), rate limited, valid only on the agency's own host, no passwords. Confirmed. |

## 2026-10-08 — Rent ledger (Phase 2, step 1)

| # | Topic | Decision |
|---|-------|----------|
| D42 | Charges are never edited | A charge cannot be changed or deleted. A mistake is voided with a reason (audited) and, if needed, a corrected charge is added. Voided charges stay visible on the statement. |
| D43 | Allocation is computed | Payments are not stored against charges. Which charges are paid is worked out oldest-first each time (D34), so voiding a charge or adding a payment can never leave stale allocations. The balance is always charges minus approved payments (spec). |
| D44 | When billing starts | Each lease has a "bill rent from" month, defaulting to its start month and editable while it is a draft. Rent is raised for every month from then until the lease ends, up to the current month, on the 1st of the month (due on the lease's due day, D18). Activating a lease raises any months already started. |
| D45 | Imported leases | Imported leases start billing in the month after the import unless the file says otherwise (`billing_starts`), so months already settled in the old system are not charged again. An `opening_balance` column brings over arrears (a charge) or credit (a payment marked "opening balance", the only payment not tied to a bank line). Confirmed. |
| D46 | Escalations | Applied automatically by the daily job on the escalation date, before that day's rent is raised (completes D20). |

## 2026-10-08 — Lease generation and e-signing

| # | Topic | Decision |
|---|-------|----------|
| D47 | E-signing | Leases are generated from the agency's template and signed on the platform: built in, no third-party signing service. Each signer gets a personal link, confirms with a one-time code, and signs; the final PDF gets a certificate page (signers, times, device/IP, document fingerprint) and is filed with the lease. Added to Phase 2 after messaging and the tenant portal; Phase 3 onboarding feeds approved applications into it. |
| D48 | Landlord signatory | Per lease: either the owner signs personally, or the agent signs on the owner's behalf under the agency's mandate. |
| D49 | Signing order | Tenant (and co-tenants), then owner (when the owner signs), then agent. Each is invited only after the previous signer has signed. |
| D50 | Agency branding | Everything tenants, owners and applicants see carries the agency's branding: portal, emails, PDFs, signing pages. The agency uploads its logo and sets its colour in Settings. |
| D51 | Lease template | The document the agency supplied was a lease confirmation letter, not a lease agreement. AWDRent therefore ships a standard South African residential lease (written to the Rental Housing Act's required content), which each agency can adapt as its own template. To be reviewed by the agency's attorney before use; not legal advice. |
| D54 | Lease confirmation letter | A second generated document: a branded "to whom it may concern" letter confirming address, agent, agency, lease dates and tenants, e-signed by the agent and an authorised representative of the agency. |

## 2026-10-08 — Deposits (Phase 2, step 2)

| # | Topic | Decision |
|---|-------|----------|
| D52 | Reversing a payment | An approved payment is never edited; it can only be reversed, with a reason (bounced EFT, wrong match, voided deposit deduction). Reversed payments stay on the statement and no longer count. Enforced by a database trigger. |
| D53 | Deposit entries | Received, interest (D40), deductions and refund entries; held = received + interest − deductions − refunds, always computed. Deductions only once notice is given or the lease has closed; refunds only after it has closed; never more than is held. A deduction for unpaid rent also posts a "paid from deposit" payment to the rent ledger; voiding that deduction reverses the payment. Admins and accounts manage deposits; agents can see them. Deposit receipts will be linked to bank lines in step 3. |

## 2026-10-08 — Bank statements (Phase 2, step 3)

| # | Topic | Decision |
|---|-------|----------|
| D55 | What is imported | Only money in (credits) from the trust-account CSV; money out is counted and skipped. Each line gets a fingerprint (date, amount, reference, description, and its order among identical lines), so a re-imported or overlapping statement never creates a second payment. The exact same file is refused. Nothing is imported if any row cannot be read. |
| D56 | Automatic matching | A line whose reference or description contains exactly one lease's EFT reference (spaces, dashes and dots tolerated; a longer number does not match) becomes an approved rent payment for the line's full amount. Lines naming no lease, or more than one, wait for accounts. Deposits are allocated by hand. |
| D57 | Manual resolution | Accounts and admins allocate a waiting line to a lease's rent (active leases) or deposit (any lease), or ignore it with a reason. Any of these can be undone with a reason: the payment is reversed (D52) or the deposit entry voided. A bank line pays for one thing at a time (database unique index); its date, amount and reference never change. Splitting one line across leases is not supported yet. |

## 2026-10-08 — Proofs of payment (Phase 2, step 4)

| # | Topic | Decision |
|---|-------|----------|
| D58 | Reviewing a POP | A POP stores what the tenant claims (amount, date, reference) and its file (a virus-scanned lease document). Accounts approve it by choosing a bank line (D33): a waiting line is allocated to the POP's lease as rent there and then; a line already matched to that lease is just linked, so nothing is paid twice. If the bank shows less than claimed the POP is "part paid"; the bank amount is what counts. One bank line proves one POP. Rejection needs a reason (it will be sent to the tenant in step 6). Undoing a bank line returns its POP to the queue. Suggested lines are ranked by same amount, EFT reference, already paid to this lease, and date. |
| D59 | Who handles POPs | Admins, agents (their portfolio) and accounts can upload a POP on a tenant's behalf; only admins and accounts approve or reject. Tenants upload their own from the portal (step 8) and by email (step 10). |

## 2026-10-08 — Receipts and statements (Phase 2, step 5)

| # | Topic | Decision |
|---|-------|----------|
| D60 | Agency business details | Agencies record their registered name, company registration number, PPRA Fidelity Fund Certificate number, VAT number, office address, phone and email in Settings. They appear on every generated document (header contact block, legal footer). |
| D61 | Receipts | The worker issues a receipt every minute for each approved payment received (bank import, POP, manual); opening balances and payments from the deposit get none. Numbered per agency (`{PREFIX}-R000001`), stored as a lease document, never deleted. Each receipt shows what the payment paid for, oldest charge first (D34), with any credit carried and the balance afterwards, which meets the Rental Housing Act's receipt content (date, dwelling, purpose, period). If the payment is later reversed, the receipt is marked cancelled with the reason. Receipts reflect the account when issued; they are not re-issued if earlier entries change. |
| D62 | Statements | Generated on request from the lease account as a branded PDF (not stored); each generation is audited. Read-only support sessions cannot generate one, because the audit entry is a write. |
| D63 | PDF generation | `@react-pdf/renderer` (pure JavaScript, no headless browser in the containers), built-in Helvetica. Generated files go straight to the agency's `files/` area without a virus scan, since the platform created them. |

## 2026-10-08 — Messaging (Phase 2, step 6)

| # | Topic | Decision |
|---|-------|----------|
| D64 | Wording and the log | The spec's catalogue (17 messages) is built in, with email wording for every message so an SMS can always fall back to email. Admins can reword each message per channel in Settings → Message wording, and reset it; unknown `{variables}` are refused and every change is audited. Each send logs one row per channel with the exact text sent; rows are never edited except for their delivery state, and messages that cannot go (no address, not opted in, opted out) are logged as "Not sent" with the reason. Opt-ins apply to every message, payment confirmations included (spec: channels come from the tenant's opt-ins). |
| D65 | Who receives lease messages | The lease's primary tenant. A POP confirmation or rejection goes to the tenant who sent the POP, when known. Co-tenants are not messaged for now (each SMS costs money); easy to change. |
| D66 | "Contact {agent_name} on {agent_phone}" | The agent whose portfolio holds the property, if they have a phone number on their staff profile; otherwise the agency's name and office phone (or email). |
| D67 | SMS length | SMS text is converted to the GSM alphabet (curly quotes, dashes and accents that would force 70-character messages are replaced), links drop `https://`, and long names, unit names and reasons are shortened so the message stays within 160 characters; amounts, references and links are never cut. Edited SMS wording is checked against typical values when saved. |
| D68 | Opt-out link (completes D39) | Each tenant gets a short code; the link is `{agency host}/o/{code}`. Opening it changes nothing (mail systems open links to scan them): the tenant presses a button to stop SMS and/or email. Audited; staff can turn messages back on in the tenant's details. Always in email footers; in an SMS only when it still fits in 160 characters, rather than paying for two. |
| D69 | Delivery | The worker sends due messages every 20 seconds. Each message gets 3 attempts (then after 1 and 5 minutes); a refusal the provider says is permanent (invalid number or address) is not retried. Quiet hours (agency setting, default 20:00–07:00) hold every channel until morning, retries included. An SMS that fails, after its retries or by a later delivery report, is sent by email if the tenant has email and is not already getting that message by email. Usage counters count a message when the provider accepts it. Emails come from "{Agency} via AWDRent" with replies to the agency's contact email, and carry its logo, colour and business details (D50, D60). |
| D70 | Delivery reports | Webhooks at `admin.{domain}/api/webhooks/resend` and `/clickatell`, answered on the admin host only. Resend events are checked against their Svix signature (5-minute replay window). Clickatell does not sign callbacks, so its integration sends basic-auth credentials we set; over HTTPS. A platform-only lookup table maps provider message ids to agencies, so a report updates its message inside that agency's RLS context. Reports never move a message backwards (e.g. "sent" after "delivered"). |
| D71 | Links in messages | No link shortener: links are short paths on the agency's host that carry no secrets. `/r/{receipt number}` takes staff to the lease account and tenants to the portal (sign-in, step 8); `/p` is the portal. Until the portal ships, `/p` says it opens soon. |

## 2026-10-09 — Reminders and overdue escalation (Phase 2, step 7)

| # | Topic | Decision |
|---|-------|----------|
| D72 | The daily run | The worker works out each live lease's notices at 07:30, with a 12:30 catch-up. Every notice is recorded once per lease (e.g. the reminder for November's rent), so repeated runs never send it twice, and a run after downtime sends what is still relevant (only the most advanced stage, not every missed one). The rent reminder goes within 5 days before the due date for what will be owed then (arrears plus the month's rent, less any credit), and not at all if credit covers it; "due today" goes on the due date if unpaid. |
| D73 | Overdue escalation | Measured from the due date of the oldest unpaid charge (oldest-first, D34): 1, 7 and 14 days. Sent once per unpaid charge and stage, so a tenant months behind gets a new round when the oldest unpaid month changes. Stops by itself when the arrears are paid; holds while a proof of payment waits for review; any amount counts (no minimum). Only live leases are chased by message. Staff (admin, agent for their portfolio, accounts) can pause it with a reason and an optional end date, audited; a pause affects overdue messages only, not rent reminders. |
| D74 | Who gets what | Day 7: the tenant, and the portfolio agent gets a copy. Day 14: the portfolio agents and every admin (internal alert). Lease expiry: tenant, owner and agent. Escalation notice: tenant and owner. Without a portfolio agent, the admins stand in. Owners and staff are emailed only, without an opt-out link. |
| D75 | Expiry and escalation notices | Lease expiry at 60 and 30 days before a fixed end date, for active leases only (not once notice is given). Escalation notice within 60 days before the escalation date, with the new rent, unless the lease ends first. "Bank details" and portal links point to `/p/pay` and `/p`, which the tenant portal (step 8) will serve. |

## 2026-10-09 — Tenant portal (Phase 2, step 8)

| # | Topic | Decision |
|---|-------|----------|
| D76 | Portal sign-in (completes D41) | A third Better Auth instance with its own tables and secret (`PORTAL_AUTH_SECRET`), at `/api/portal-auth` on agency hosts only. Sign-in uses our own one-time-code endpoints rather than Better Auth's email-OTP and phone plugins, because those identify people by a globally unique email or number and the same person can rent through two agencies. The tenant gives the email or mobile number the agency holds and is found within the host's agency only; they must not be archived and must be on a lease past draft (current or past). If several tenant records share the address, no code is sent and they are asked to contact their agent, so a code can never open someone else's account. Codes: 6 digits, 10 minutes, 5 tries, single use, only a keyed hash stored; at most 3 per address per 15 minutes, plus per-IP limits. The reply is the same whether or not the address is known. Sessions last 7 days, renewed daily while in use, cookies host-only; the tenant is re-checked on every request. Tenant actions are audited under their portal user (new `audit_log.portal_user_id`, set from the session like the staff user). |
| D77 | Payment details | The trust account is shown in full on the portal's "How to pay" page, only after sign-in. Settings gain the account holder name and branch code. |
| D78 | One set of rules | Staff and portal share the same upload (virus scan, 10 MB), proof-of-payment, ledger and statement code; only the access check differs (staff: role and portfolio; portal: tenant on the lease). |
| D79 | Sign-in codes | Sent at once, outside quiet hours too, by the route the tenant signed in with and regardless of their message opt-ins, since they asked for it. Logged in the notification log without the code, and counted for billing. |
| D80 | What the portal does now | Leases (current first, past ones too), balance and arrears, statement and PDF, receipts, sending a proof of payment and seeing its status, payment details, and choosing email/SMS messages. Maintenance requests arrive with the maintenance module; the owner portal (also D41) comes later. End-to-end tests read codes from `DEV_OUTBOX_FILE`, which the app refuses in production unless the domain is `localhost`. |

## 2026-10-09 — Lease documents and e-signing (Phase 2, step 9)

| # | Topic | Decision |
|---|-------|----------|
| D81 | What is signed | Preparing a document freezes its content (clauses filled in, signers) in a signing envelope, renders the PDF every signer sees, and records that PDF's SHA-256 fingerprint. The unsigned and the signed PDF are both filed with the lease. The signed original is built from the same frozen content plus the drawn signatures and a certificate page (signers, code sent to, times in SAST, IP address, device, fingerprint). Signatures and finished envelopes cannot be changed (database triggers). One document of each kind can be out for signing per lease at a time. |
| D82 | Lease template (completes D51) | The standard lease has 17 clauses covering the Rental Housing Act's required content (parties, dwelling, rent and escalation, deposit in an interest-bearing account with refund periods, joint inspections, receipts) and the Consumer Protection Act's fixed-term rules (expiry notice, 20 business days' cancellation, reasonable penalty), with PIE Act, POPIA and ECTA wording. Admins edit, add, remove and reorder clauses in Settings; unknown `{fields}` are refused; documents already sent keep their wording. Marked for attorney review. |
| D83 | Filling in the lease | Fields come from the lease, its tenants, the owner and the agency's settings. Tenant ID and passport numbers appear masked ("identity number ending 9086"), as elsewhere in AWDRent. Agency details not yet set appear as "(not set)", and staff are warned before sending. |
| D84 | Signing links and codes | Each signer gets a personal link (192-bit token, only its hash stored, valid 14 days; sending a new link cancels the old one) and confirms a one-time code sent to their email, or mobile if they have no email (10 minutes, 5 tries, at most one a minute). They then have 30 minutes to sign: typed full name, drawn signature, and agreement to sign electronically. Signing requests and signed copies are sent whatever the signer's message opt-ins, since they are needed to conclude the lease. The link appears in the messages log, but cannot be used to sign without the code. |
| D85 | Order and roles (completes D48, D49, D54) | Lease agreement: all tenants together, then the owner (when the owner signs), then the agent; when the agent signs under mandate, the owner does not sign and the agent's block says so. Confirmation letter: the agent, then an admin as authorised representative (a different person), and only for a lease that has started. Owners and staff need an email address; tenants an email or mobile number. A signer who declines withdraws the document and the sender is emailed the reason; staff can cancel with a reason, or send a signer a new link. |
| D86 | Who does what | Admins and agents (their portfolio) prepare and send documents; accounts see progress and the files. Tenants download their signed documents from the portal. |
