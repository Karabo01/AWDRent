Rental Management System — Specification
Oct 6, 2026 · @Karabo
Overview
A multi-tenant, web-based rental management platform for property agencies that manage rentals on behalf of multiple owners. AWDTECH owns and hosts the platform; each agency subscribes and is fully isolated from the others. Tenants pay rent by EFT and submit proof of payment (POP); agency staff verify it, and the system issues receipts, reminders and owner statements automatically.
In scope: owners, properties, units, tenants, leases, rent ledger, POP upload and verification, bank statement matching, automated notifications (email + SMS at launch, WhatsApp in phase 2), owner statements, maintenance requests, tenant onboarding with document upload, tenant portal.
Out of scope: online card payments or a payment gateway, debit orders, accounting system replacement (the system exports to the agency's accounting package instead), listings and marketing of vacant units.
Key design choices:
• Every lease gets a unique EFT reference (e.g. KL-0042) so bank lines can be matched to tenants reliably.
• All notifications go through one messaging service with pluggable channels, so WhatsApp is switched on later without a rebuild.
• Multi-tenant from day one: one shared app and database serves every agency, isolated by Postgres row-level security, with its own subdomain, branding and settings. Hosted on AWDTECH's Coolify infrastructure, keeping tenant data under POPIA control.
Users and roles
Seven roles. Every user except the platform admin belongs to exactly one agency. Staff permissions are role-based, and agents can be limited to the properties assigned to them.
Role
Who
Can do
Admin
Agency principal / office manager
Everything: users, settings, bank details, templates, all properties, reports
Rental agent
Agency staff managing a portfolio
Owners, properties, tenants and leases in their portfolio; maintenance; view ledger
Accounts
Agency bookkeeper
Verify POP, import bank statements, allocate payments, issue receipts, run owner statements and exports
Tenant
Renter (portal login via email or SMS one-time code)
View lease, balance, statements, receipts; upload POP; log maintenance; manage notification consent
Owner
Landlord (optional portal, read-only)
View their properties, monthly statements, arrears and maintenance
Platform admin
AWDTECH
Create, configure and suspend agencies; view usage per agency for billing; support access to an agency's data only through a logged support session
Applicant
Prospective tenant (no login; secure link sent by an agent)
Give consent, fill in the application and upload the required documents until the link expires
Every action that changes money or a lease (payment approved, charge added, lease amended) is written to an audit log with user and timestamp.
Core workflows
The monthly rent cycle runs itself; staff only step in to verify payments and handle arrears.
Proof of payment verification
A POP alone never clears arrears: Accounts approves it only when the matching line appears on the trust account statement (manually or via CSV import).
Monthly rent cycle
1. On the 1st (or the lease due day) the system raises each lease's rent charge.
2. Five days before due, the tenant gets a reminder with the amount, bank details and EFT reference.
3. On the due day, unpaid tenants get a second reminder with the upload link.
4. Payments are verified as above; receipts go out automatically.
5. At month end, owner statements are generated and the payout list is produced.
Overdue escalation
1. Day 1 after due: overdue notice to tenant.
2. Day 7: arrears notice to tenant, copy to the agent.
3. Day 14: internal alert to agent and admin to issue a letter of demand.
4. Escalation stops when the balance is cleared, or when an agent pauses it for a payment arrangement.
Lease lifecycle
1. Agent creates the lease; the system generates the EFT reference and lease PDF.
2. Deposit recorded; ingoing inspection completed.
3. Escalation notice 60 days before the escalation date; expiry alerts at 60 and 30 days.
4. Renewal creates a new lease term; termination triggers outgoing inspection and deposit refund.
Tenant onboarding
1. Agent creates an application for a unit and sends the secure link by email and SMS.
2. Applicant opens the link (no account needed), gives POPIA consent, fills in their details and uploads each document on the agency's checklist. They can save and come back until the link expires (default 14 days).
3. Agent reviews each document: accept it, or reject it with a reason, which asks the applicant for a replacement.
4. Agent approves or declines the application. Approval creates the tenant record and a draft lease with the documents attached.
5. Documents from declined or expired applications are deleted automatically after the agency's retention period (default 90 days).
Functional requirements
1. Owners and properties
• Owner record: name, ID/company reg, contact details, payout bank details, commission rate, VAT status.
• Property → units (one property can hold many units, e.g. a block of flats).
• Unit status: vacant, occupied, notice given, under maintenance.
• Documents per property: title deed, inspection reports, photos.
2. Tenants and leases
• Tenant record: name, ID number, phone, email, employer, emergency contact, co-tenants.
• Lease: unit, tenants, start and end date, monthly rent, due day, deposit, escalation % and date, notice period, generated EFT reference.
• Lease templates with merge fields, generated as PDF.
• Lease events: renewal, escalation, amendment, notice given, termination — each kept in history.
• Ingoing and outgoing inspection checklists with photos.
3. Rent ledger
• Monthly rent charges raised automatically on the 1st (or the lease's due day).
• Other charges: utilities recharges, late fees (configurable), damages, admin fees.
• Running balance per lease; credits carried forward.
• Deposit held separately, with interest tracking and refund on lease end.
• Tenant statement on demand (PDF).
4. Payments and proof of payment
• Tenant uploads POP (PDF, JPG, PNG) in the portal, or emails it to a dedicated inbox (e.g. pop@agency.co.za) which the system reads and attaches by sender or reference.
• POP queue for Accounts: preview, amount, reference, date; approve, reject with reason, or partial.
• Bank statement CSV import from the trust account; auto-match lines to leases by EFT reference and amount; unmatched lines left for manual allocation.
• A payment is only final when matched to a bank line, so a POP alone never clears arrears.
• Receipt PDF generated and sent on approval.
5. Owner statements and disbursements
• Monthly statement per owner: rent collected, less commission, less expenses (maintenance, levies), equals amount payable.
• Payout batch list for the agency to load as EFTs (CSV for bank bulk-payment import).
• Statements emailed to owners and visible in the owner portal.
6. Maintenance
• Tenant logs a request with photos; agent assigns a contractor, sets priority and status.
• Contractor invoice can be charged to the owner statement.
• Tenant notified on status changes.
7. Reports and dashboard
• Arrears ageing (current, 30, 60, 90+ days).
• Occupancy and vacancies; leases expiring in 30/60/90 days.
• Collections this month vs expected.
• Notification log: what was sent, to whom, on which channel, delivered or failed.
• Exports to CSV for the accounting package.
8. Tenant onboarding
• Agency-defined document checklist per applicant type (employed, self-employed, company). Typical items: ID or passport, latest 3 payslips, 3 months' bank statements, employer letter, proof of current address; for companies, registration documents and director IDs.
• Application link: single-use, unguessable token; expires after 14 days (configurable); agents can resend or revoke it.
• Mobile-friendly upload page: a photo or PDF per checklist item, progress shown, save and continue later; consent captured before any upload.
• Review queue for agents: preview each document, accept or reject with a reason; the applicant is notified automatically.
• Approving converts the applicant into a tenant and starts a draft lease; declining sends a courteous notice.
• The system does not run credit checks or score affordability; the agency makes its own decision. Integration with a vetting bureau can be quoted later.
Data model
PostgreSQL, one shared database for all agencies. Every table except agencies and platform_admins carries agency_id, enforced by row-level security. Money stored as integer cents (ZAR); all tables carry id (UUID), created_at, updated_at, created_by.
Table
Key fields
Relations
users
name, email, phone, role, active, last_login
staff only
owners
name, id_or_reg_no, email, phone, bank_name, account_no (encrypted), commission_pct, vat_registered
has many properties
properties
owner_id, name, address, type, notes
belongs to owner; has many units
units
property_id, label, bedrooms, status
belongs to property
agent_portfolios
user_id, property_id
assigns agents to properties
tenants
full_name, id_number (encrypted), email, phone, whatsapp_opt_in, sms_opt_in, consent_at
many-to-many with leases
leases
unit_id, eft_reference (unique), start_date, end_date, rent_cents, due_day, deposit_cents, escalation_pct, escalation_date, notice_days, status
belongs to unit
lease_tenants
lease_id, tenant_id, is_primary
join table
charges
lease_id, type (rent, late_fee, utility, damage, other), amount_cents, period, due_date, description
ledger debits
payments
lease_id, amount_cents, paid_on, source (pop, bank_import, manual), bank_line_id, status (pending, approved, rejected), approved_by
ledger credits
proofs_of_payment
lease_id, tenant_id, file_key, amount_cents, reference_given, submitted_via (portal, email, whatsapp), status, reviewed_by, reject_reason
linked to a payment once approved
bank_imports / bank_lines
file name, period / date, amount_cents, reference, description, matched_lease_id, match_status
one import has many lines
deposits
lease_id, amount_cents, received_on, interest_cents, refunded_on, deductions_cents
one per lease
owner_statements
owner_id, period, collected_cents, commission_cents, expenses_cents, payable_cents, pdf_key, paid_on
one per owner per month
maintenance_requests
unit_id, tenant_id, title, description, priority, status, contractor, cost_cents, charge_to
photos in documents
documents
owner_type, owner_id, kind, file_key, uploaded_by
polymorphic: lease, property, tenant, request
message_templates
key, channel, body, variables, provider_template_id
per channel
messages
recipient, channel, template_key, payload, status (queued, sent, delivered, read, failed), provider_id, error, sent_at
full notification log
scheduled_jobs
type, run_at, lease_id, status
reminders and escalations
audit_log
user_id, action, entity, entity_id, before, after
append-only
agencies
name, subdomain, logo_key, brand_colour, trust_bank_name, trust_account_no (encrypted), eft_prefix, sms_sender_name, quiet_hours, plan, included_units, included_sms, status (active, suspended)
tenant root; every other table points here
usage_counters
agency_id, month, active_units, sms_sent, emails_sent, whatsapp_sent
basis for each agency's monthly invoice
platform_admins
name, email, totp_secret (encrypted), last_login
AWDTECH staff; outside any agency
document_requirements
agency_id, name, description, applicant_type (employed, self_employed, company), required, sort_order
the agency's checklist
applications
agency_id, unit_id, agent_id, applicant_type, full_name, email, phone, token_hash, expires_at, status (sent, in_progress, submitted, more_info, approved, declined, expired), consent_at, decided_by, decided_at, delete_after
becomes a tenant and lease on approval
application_documents
agency_id, application_id, requirement_id, file_key, status (pending, accepted, rejected), reviewer_note, reviewed_by
one or more per checklist item
The tenant balance is never stored as a single editable number. It is always the sum of charges minus approved payments, so it can be audited.
Multi-tenancy
• One app and one database for all agencies; agency_id on every tenant table and leading every index that filters by agency.
• The agency is taken from the logged-in user's session on every request, never from a value the browser sends.
• Postgres row-level security policies on every tenant table, so the database refuses cross-agency reads even if a query forgets its filter.
• File storage keys start with agencies/{agency_id}/; signed download links are checked against the requester's agency.
• Background jobs (reminders, statements, imports) carry agency_id and set it before touching data.
• EFT references are unique per agency, using the agency's own prefix.
• A large agency can later get a dedicated instance from the same codebase, as a premium tier.
Notifications
Launch with email (Resend) and SMS (a local South African bulk-SMS gateway); add WhatsApp (Twilio) in phase 2 by enabling a channel, not rebuilding.
Architecture
• One send(recipient, template_key, variables) service. It picks channels from the tenant's opt-ins and the template's channel list, renders the text, queues the job and logs to messages.
• A background worker sends queued messages and retries failures (3 attempts, backing off).
• Delivery status comes back by webhook (Resend events, SMS gateway delivery reports) and updates the log.
• Fallback rule: if SMS or WhatsApp fails, send by email.
• Quiet hours set per agency (default 20:00 to 07:00 SAST); jobs wait until morning.
• A daily scheduler at 07:30 creates the day's reminder, overdue and expiry jobs.
Message catalogue (agency can edit wording in settings)
Key
When
To
Channels
Wording (SMS length)
rent_due_reminder
5 days before due day
Tenant
Email, SMS
Hi {name}, rent of R{amount} for {unit} is due on {due_date}. Pay by EFT, ref {eft_ref}. Bank details: {short_link}
rent_due_today
Due day, if unpaid
Tenant
SMS
Reminder: rent of R{amount} is due today. Ref {eft_ref}. Upload proof of payment: {portal_link}
pop_received
Tenant uploads POP
Tenant
Email, SMS
Thanks {name}, we've received your proof of payment of R{amount}. We'll confirm once it reflects.
payment_confirmed
Payment approved
Tenant
Email (receipt PDF), SMS
Payment of R{amount} received for {unit}. Balance: R{balance}. Receipt: {link}
pop_rejected
POP rejected
Tenant
Email, SMS
We couldn't verify your payment of R{amount}: {reason}. Please contact {agent_name} on {agent_phone}.
overdue_1
1 day after due
Tenant
Email, SMS
Your rent of R{balance} is overdue. Please pay today using ref {eft_ref} and upload proof: {portal_link}
overdue_7
7 days after due
Tenant, agent
Email, SMS
Your account is R{balance} in arrears. Please contact {agent_name} urgently on {agent_phone}.
overdue_14
14 days after due
Agent, admin
Email
Internal alert: {tenant} at {unit} is R{balance} in arrears; formal letter of demand due.
lease_expiry
60 and 30 days before end
Agent, tenant, owner
Email
Lease for {unit} ends {end_date}. Please confirm renewal or notice.
escalation_notice
60 days before escalation
Tenant, owner
Email
From {date}, rent for {unit} increases to R{new_amount} per the lease.
maintenance_update
Status change
Tenant
Email, SMS
Update on your request "{title}": {status}.
owner_statement
Monthly run
Owner
Email (PDF)
Your statement for {month} is attached. Amount payable: R{payable}.
application_invite
Agent sends an application
Applicant
Email, SMS
Hi {name}, {agency} invites you to apply for {unit}. Upload your documents here: {link} (expires {date}).
application_reminder
3 days after invite, if incomplete
Applicant
SMS
Your application for {unit} still needs {count} documents: {link}
application_more_info
Agent rejects a document
Applicant
Email, SMS
Please upload a new {document}: {reason}. {link}
application_submitted
Applicant completes the checklist
Agent
Email
{applicant} has submitted all documents for {unit}. Review: {link}
application_outcome
Approved or declined
Applicant
Email, SMS
Your application for {unit} has been {outcome}. {agent_name} will contact you about next steps.
Overdue escalation stops automatically once the balance is cleared. Agents can pause it for a lease (e.g. an agreed payment arrangement).
SMS gateway: send SMS through a local South African bulk-SMS provider, not Twilio. Twilio charges about R2.26 per SMS to South Africa; local providers advertise roughly 14c to 25c. Each agency can register its own sender name. Keep messages under 160 characters (one segment) and use short links. SMS, email and WhatsApp sent are counted per agency in usage_counters for billing.
Phase 2 — WhatsApp: register each agency's number as its own WhatsApp sender in Twilio (needs a Meta Business account in the agency's name), submit the tenant-facing templates above as Utility templates, and turn on the channel. Inbound WhatsApp messages with attachments go into the POP queue, matched by phone number.
Tech stack and hosting
One web app plus a background worker, deployed on Coolify. This is a proposed stack; swap pieces to match what you already maintain.
Layer
Choice
Why
App
Next.js (staff back office, tenant and owner portals in one app)
One codebase, server-side rendering, API routes
Database
PostgreSQL
Relational ledger, transactions, reliable reporting
Jobs and queue
Redis + BullMQ worker
Scheduled reminders, retries, bank import processing
File storage
S3-compatible (MinIO on the same server, or Cloudflare R2)
POPs, leases, receipts, photos; private buckets, signed URLs
PDFs
Server-side HTML to PDF (Playwright or React-PDF)
Leases, receipts, statements
Email out
Resend
Already in your stack; webhooks for delivery
Email in (POP inbox)
Resend inbound or IMAP polling of a dedicated mailbox
Attachments into the POP queue
SMS / WhatsApp
Local SA bulk-SMS gateway (SMS); Twilio (WhatsApp, phase 2)
Local SMS costs about a tenth of Twilio's rate; delivery reports by webhook
Auth
Staff: email + password with TOTP 2FA; tenants and owners: one-time code by email or SMS
No passwords for tenants to forget
Hosting
Coolify on a VPS (2–4 vCPU, 4–8 GB RAM to start)
Matches existing deployments
Backups
Nightly Postgres dump + storage sync to off-site bucket, 30-day retention
Restore tested monthly
Monitoring
Uptime check + error tracking (e.g. Sentry); optional Wazuh agent on the host
Alerts before the agency notices
Tenancy
Shared app and database; agency_id + Postgres row-level security; a subdomain per agency
One deployment to update; low server cost per agency
Security, POPIA and trust account compliance
Security
• TLS everywhere; HSTS; secure, HTTP-only session cookies.
• 2FA mandatory for staff; role and portfolio checks on every API route, not just in the UI.
• ID numbers and bank account numbers encrypted at the column level; masked in the UI (last 4 digits).
• Uploaded files: type and size limits (10 MB), virus scan (ClamAV), stored in private buckets, served only via short-lived signed URLs.
• Webhooks (Twilio, Resend) verified by signature.
• Rate limiting on login and one-time code endpoints.
• Audit log for money and lease changes; append-only.
• Penetration test before go-live.
Multi-tenant isolation
• One agency seeing another's tenants, ID numbers or bank details is a POPIA incident, not just a bug; isolation is enforced in the database (row-level security), not only in application code.
• Automated tests in CI that try to read, update and download across agencies, and must fail.
• The pen test includes cross-tenant attempts (changing IDs in URLs and API calls, swapping subdomains, reusing signed links).
• Platform admin access to an agency's data only through a logged support session.
• Per-agency data export and deletion, for offboarding and POPIA requests.
POPIA
• Record consent and channel opt-ins per tenant (SMS, WhatsApp, email) with timestamp; easy opt-out (reply STOP for SMS).
• Collect only what is needed for the lease; state the purpose in the tenant onboarding form.
• Retention policy: keep lease and payment records for the period the agency's auditor requires, then purge or anonymise.
• Data subject requests: export a tenant's data and delete or anonymise on request where the law allows.
• Operator agreements with Twilio and Resend (data leaves South Africa for message delivery).
• The agency is the responsible party; AWDTECH as host and developer is an operator, which should be in the service agreement.
Applicant documents
• Payslips, bank statements and ID documents are the most sensitive files in the system: private storage, virus scan on upload, access limited to the assigned agent, admins and accounts.
• Application links are single-use tokens stored as hashes, expire after 14 days, and can be revoked.
• Applicants consent before uploading, with a short notice of what is collected, why, and how long it is kept.
• Documents from declined or expired applications are deleted automatically after the agency's retention period (default 90 days); approved applicants' documents stay with the lease.
Trust account
• Rent collected on behalf of owners should normally be paid into the agency's trust account under the Property Practitioners Act, not its business account. The system treats the trust account as the receiving account shown to tenants and the one imported for matching.
• Deposits tracked separately with interest, as the Rental Housing Act requires.
• Owner statements and bank imports give the agency's auditor a clean trail.
• Confirm these requirements with the agency and its auditor; this spec is not legal advice.
Build phases
Four phases; the agency can go live after phase 2. Week counts are rough estimates for one developer and should be firmed up after the agency answers the open questions.
1. Phase 1 — Core records and multi-tenancy (about 4 weeks)
    ◦ Agencies, row-level security, subdomains, per-agency settings and branding, platform admin console; staff auth, roles, 2FA; owners, properties, units, tenants, leases; EFT reference generation; documents; audit log.
    ◦ Data import from the agency's current spreadsheets.
2. Phase 2 — Money and notifications (about 4 weeks) — go-live
    ◦ Rent charges, ledger, deposits; tenant portal with POP upload; POP inbox; verification queue; receipts.
    ◦ Bank statement CSV import and matching for the agency's bank.
    ◦ Messaging service with email + SMS; reminder, overdue and receipt messages; scheduler; notification log; per-agency usage counts for billing.
3. Phase 3 — Owners, maintenance and tenant onboarding (about 4 weeks)
    ◦ Tenant onboarding links, document checklist and review queue; owner statements, payout CSV, owner portal; maintenance requests; lease expiry and escalation alerts; reports and exports.
4. Phase 4 — WhatsApp (about 1–2 weeks, plus Meta approval time)
    ◦ Twilio WhatsApp sender, template approval, channel switched on, inbound POP via WhatsApp.
Before go-live: pen test including cross-tenant checks, backup restore test, staff training session, and a parallel month running alongside the agency's current process.
Open questions for the agency
[ ] How many owners, properties, units and active leases today, and expected growth in 12 months?
[ ] How many staff users, and do agents only see their own portfolio?
[ ] Which bank holds the trust account, and can they export statements as CSV or OFX?
[ ] Is rent always due on the 1st, or does it vary by lease?
[ ] Late fee policy: amount or %, grace period?
[ ] Commission structure: flat % per owner, or varies by property? VAT on commission?
[ ] Do owners want portal access, or emailed statements only?
[ ] Which accounting package do they use (Sage, Xero, other) for exports?
[ ] Existing data: spreadsheets, another system? Who will clean it for import?
[ ] Branded SMS sender ID wanted at launch?
[ ] Who handles maintenance contractors, and are contractor invoices charged to owners?
[ ] Any existing lease template they must keep?