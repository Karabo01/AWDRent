// The message catalogue (spec "Message catalogue"). Each message has
// built-in wording per channel; agencies may replace it in settings (stored
// in message_templates). SMS wording is the spec's; email wording says the
// same at more length. Every message has email wording, because a failed
// SMS falls back to email (spec).
//
// {name} and {agency} are always available; the rest are supplied by the
// caller. Money variables are amounts without the "R" (e.g. "8 500,00").

export type Channel = "email" | "sms" | "whatsapp";

export interface CatalogueEntry {
  key: string;
  label: string;
  when: string;
  to: string;
  /** Channels used when the recipient has opted in to them (spec). */
  channels: Channel[];
  variables: string[];
  sms: string | null;
  emailSubject: string;
  email: string;
}

const ALWAYS = ["name", "agency"];

const entries: CatalogueEntry[] = [
  {
    key: "rent_due_reminder",
    label: "Rent due reminder",
    when: "5 days before the due day",
    to: "Tenant",
    channels: ["email", "sms"],
    variables: ["amount", "unit", "due_date", "eft_ref", "short_link"],
    sms: "Hi {name}, rent of R{amount} for {unit} is due on {due_date}. Pay by EFT, ref {eft_ref}. Bank details: {short_link}",
    emailSubject: "Rent of R{amount} due on {due_date}",
    email:
      "Hi {name},\n\nA reminder that rent of R{amount} for {unit} is due on {due_date}.\n\nPlease pay by EFT using the reference {eft_ref}. Our bank details: {short_link}\n\nThank you,\n{agency}",
  },
  {
    key: "rent_due_today",
    label: "Rent due today",
    when: "Due day, if unpaid",
    to: "Tenant",
    channels: ["sms"],
    variables: ["amount", "eft_ref", "portal_link"],
    sms: "Reminder: rent of R{amount} is due today. Ref {eft_ref}. Upload proof of payment: {portal_link}",
    emailSubject: "Rent of R{amount} is due today",
    email:
      "Hi {name},\n\nA reminder that rent of R{amount} is due today. Please use the reference {eft_ref} and upload your proof of payment here: {portal_link}\n\nThank you,\n{agency}",
  },
  {
    key: "pop_received",
    label: "Proof of payment received",
    when: "Tenant uploads a proof of payment",
    to: "Tenant",
    channels: ["email", "sms"],
    variables: ["amount"],
    sms: "Thanks {name}, we've received your proof of payment of R{amount}. We'll confirm once it reflects.",
    emailSubject: "We've received your proof of payment",
    email:
      "Hi {name},\n\nThank you, we've received your proof of payment of R{amount}. We'll confirm as soon as the payment reflects in our account.\n\nKind regards,\n{agency}",
  },
  {
    key: "payment_confirmed",
    label: "Payment confirmed (with receipt)",
    when: "Payment approved",
    to: "Tenant",
    channels: ["email", "sms"],
    variables: ["amount", "unit", "balance", "link", "receipt_number"],
    sms: "Payment of R{amount} received for {unit}. Balance: R{balance}. Receipt: {link}",
    emailSubject: "Payment received: receipt {receipt_number}",
    email:
      "Hi {name},\n\nWe've received your payment of R{amount} for {unit}. Your receipt {receipt_number} is attached.\n\nYour balance is now R{balance}.\n\nThank you,\n{agency}",
  },
  {
    key: "pop_rejected",
    label: "Proof of payment rejected",
    when: "Proof of payment rejected",
    to: "Tenant",
    channels: ["email", "sms"],
    variables: ["amount", "reason", "agent_name", "agent_phone"],
    sms: "We couldn't verify your payment of R{amount}: {reason}. Please contact {agent_name} on {agent_phone}.",
    emailSubject: "We couldn't verify your payment",
    email:
      "Hi {name},\n\nWe couldn't verify your payment of R{amount}: {reason}.\n\nPlease contact {agent_name} on {agent_phone}.\n\nKind regards,\n{agency}",
  },
  {
    key: "overdue_1",
    label: "Overdue: 1 day",
    when: "1 day after the due day",
    to: "Tenant",
    channels: ["email", "sms"],
    variables: ["balance", "eft_ref", "portal_link"],
    sms: "Your rent of R{balance} is overdue. Please pay today using ref {eft_ref} and upload proof: {portal_link}",
    emailSubject: "Your rent is overdue",
    email:
      "Hi {name},\n\nYour rent of R{balance} is overdue. Please pay today using the reference {eft_ref} and upload your proof of payment here: {portal_link}\n\nIf you have already paid, thank you, and please ignore this message.\n\n{agency}",
  },
  {
    key: "overdue_7",
    label: "Overdue: 7 days",
    when: "7 days after the due day",
    to: "Tenant, agent",
    channels: ["email", "sms"],
    variables: ["balance", "agent_name", "agent_phone"],
    sms: "Your account is R{balance} in arrears. Please contact {agent_name} urgently on {agent_phone}.",
    emailSubject: "Your account is in arrears",
    email: "Hi {name},\n\nYour account is R{balance} in arrears. Please contact {agent_name} urgently on {agent_phone}.\n\n{agency}",
  },
  {
    key: "overdue_14",
    label: "Overdue: 14 days (internal)",
    when: "14 days after the due day",
    to: "Agent, admin",
    channels: ["email"],
    variables: ["tenant", "unit", "balance"],
    sms: null,
    emailSubject: "Arrears: {tenant} at {unit}",
    email: "Internal alert: {tenant} at {unit} is R{balance} in arrears; formal letter of demand due.",
  },
  {
    key: "lease_expiry",
    label: "Lease expiry",
    when: "60 and 30 days before the lease ends",
    to: "Agent, tenant, owner",
    channels: ["email"],
    variables: ["unit", "end_date"],
    sms: null,
    emailSubject: "Lease for {unit} ends {end_date}",
    email: "Hi {name},\n\nThe lease for {unit} ends on {end_date}. Please confirm renewal or notice.\n\n{agency}",
  },
  {
    key: "escalation_notice",
    label: "Rent escalation notice",
    when: "60 days before the escalation",
    to: "Tenant, owner",
    channels: ["email"],
    variables: ["date", "unit", "new_amount"],
    sms: null,
    emailSubject: "Rent for {unit} from {date}",
    email: "Hi {name},\n\nFrom {date}, rent for {unit} increases to R{new_amount} per the lease.\n\n{agency}",
  },
  {
    key: "maintenance_update",
    label: "Maintenance update",
    when: "Maintenance request status changes",
    to: "Tenant",
    channels: ["email", "sms"],
    variables: ["title", "status"],
    sms: 'Update on your request "{title}": {status}.',
    emailSubject: 'Update on your request "{title}"',
    email: 'Hi {name},\n\nUpdate on your maintenance request "{title}": {status}.\n\n{agency}',
  },
  {
    key: "owner_statement",
    label: "Owner statement",
    when: "Monthly run",
    to: "Owner",
    channels: ["email"],
    variables: ["month", "payable"],
    sms: null,
    emailSubject: "Your statement for {month}",
    email: "Hi {name},\n\nYour statement for {month} is attached. Amount payable: R{payable}.\n\n{agency}",
  },
  {
    key: "application_invite",
    label: "Application invite",
    when: "Agent sends an application",
    to: "Applicant",
    channels: ["email", "sms"],
    variables: ["unit", "link", "date"],
    sms: "Hi {name}, {agency} invites you to apply for {unit}. Upload your documents here: {link} (expires {date}).",
    emailSubject: "Your application for {unit}",
    email: "Hi {name},\n\n{agency} invites you to apply for {unit}. Upload your documents here: {link}\n\nThe link expires on {date}.",
  },
  {
    key: "application_reminder",
    label: "Application reminder",
    when: "3 days after the invite, if incomplete",
    to: "Applicant",
    channels: ["sms"],
    variables: ["unit", "count", "link"],
    sms: "Your application for {unit} still needs {count} documents: {link}",
    emailSubject: "Your application for {unit} is incomplete",
    email: "Hi {name},\n\nYour application for {unit} still needs {count} documents. Upload them here: {link}\n\n{agency}",
  },
  {
    key: "application_more_info",
    label: "Application: document needed",
    when: "Agent rejects a document",
    to: "Applicant",
    channels: ["email", "sms"],
    variables: ["document", "reason", "link"],
    sms: "Please upload a new {document}: {reason}. {link}",
    emailSubject: "Please upload a new {document}",
    email: "Hi {name},\n\nPlease upload a new {document}: {reason}.\n\n{link}\n\n{agency}",
  },
  {
    key: "application_submitted",
    label: "Application submitted (internal)",
    when: "Applicant completes the checklist",
    to: "Agent",
    channels: ["email"],
    variables: ["applicant", "unit", "link"],
    sms: null,
    emailSubject: "{applicant} has applied for {unit}",
    email: "{applicant} has submitted all documents for {unit}. Review: {link}",
  },
  {
    key: "application_outcome",
    label: "Application outcome",
    when: "Application approved or declined",
    to: "Applicant",
    channels: ["email", "sms"],
    variables: ["unit", "outcome", "agent_name"],
    sms: "Your application for {unit} has been {outcome}. {agent_name} will contact you about next steps.",
    emailSubject: "Your application for {unit}",
    email: "Hi {name},\n\nYour application for {unit} has been {outcome}. {agent_name} will contact you about next steps.\n\n{agency}",
  },
  // Lease documents and e-signing (D47–D49, D84)
  {
    key: "signing_request",
    label: "Document to sign",
    when: "A lease document is sent for signing, to each signer in turn",
    to: "Tenant, owner, agent",
    channels: ["email", "sms"],
    variables: ["document", "unit", "link"],
    sms: "Hi {name}, {agency} has sent you the {document} for {unit} to sign: {link}",
    emailSubject: "Please sign: {document} for {unit}",
    email:
      "Hi {name},\n\n{agency} has sent you the {document} for {unit} to sign electronically.\n\nOpen your personal link to read and sign it: {link}\n\nWe will send a one-time code to confirm it is you. The link is for you only; please do not forward it.\n\n{agency}",
  },
  {
    key: "signing_completed",
    label: "Document signed by everyone",
    when: "The last signer signs",
    to: "Every signer",
    channels: ["email", "sms"],
    variables: ["document", "unit"],
    sms: "The {document} for {unit} has been signed by everyone. We have emailed your copy, or ask {agency} for one.",
    emailSubject: "Signed: {document} for {unit}",
    email: "Hi {name},\n\nThe {document} for {unit} has now been signed by everyone. Your signed copy is attached; please keep it safe.\n\n{agency}",
  },
  {
    key: "signing_declined",
    label: "Signing declined (internal)",
    when: "A signer declines to sign",
    to: "The staff member who sent it",
    channels: ["email"],
    variables: ["signer", "document", "unit", "reason"],
    sms: null,
    emailSubject: "{signer} declined to sign the {document}",
    email: "{signer} declined to sign the {document} for {unit}: {reason}\n\nThe document has been withdrawn; prepare a new one when ready.",
  },
];

export const CATALOGUE: ReadonlyMap<string, CatalogueEntry> = new Map(entries.map((e) => [e.key, e]));
export const CATALOGUE_KEYS = entries.map((e) => e.key);

export function catalogueEntry(key: string): CatalogueEntry {
  const entry = CATALOGUE.get(key);
  if (!entry) throw new Error(`unknown message ${key}`);
  return entry;
}

export const allowedVariables = (entry: CatalogueEntry) => [...ALWAYS, ...entry.variables];

/**
 * Typical long values, used to check that SMS wording fits one segment
 * when an agency edits it.
 */
export const SAMPLE_VALUES: Record<string, string> = {
  name: "Nomvula",
  agency: "Kgosi Letting",
  amount: "12 500,00",
  balance: "12 500,00",
  new_amount: "13 375,00",
  payable: "11 250,00",
  unit: "Flat 12, Sunset Court",
  due_date: "1 November",
  date: "1 November",
  end_date: "30 November 2026",
  month: "October 2026",
  eft_ref: "KL-0042",
  short_link: "kgosi.awdrent.co.za/p/pay",
  portal_link: "kgosi.awdrent.co.za/p",
  link: "kgosi.awdrent.co.za/s/AbCdEfGhIjKlMnOpQrStUvWxYz012345",
  signer: "Ayanda Khumalo",
  receipt_number: "KL-R000123",
  reason: "amount does not match",
  agent_name: "Thabo Mokoena",
  agent_phone: "082 555 0123",
  tenant: "Nomvula Dlamini",
  title: "Leaking geyser",
  status: "technician booked",
  count: "3",
  document: "bank statement",
  applicant: "Nomvula Dlamini",
  outcome: "approved",
};
