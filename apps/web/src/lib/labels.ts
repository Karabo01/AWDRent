// Display labels shared by server and client components. Keep this module
// free of "use client" so server pages can import plain values from it.

export const UNIT_STATUS_OPTIONS = [
  { value: "vacant", label: "Vacant" },
  { value: "occupied", label: "Occupied" },
  { value: "notice_given", label: "Notice given" },
  { value: "under_maintenance", label: "Under maintenance" },
];

export const UNIT_STATUS_LABEL: Record<string, string> = Object.fromEntries(UNIT_STATUS_OPTIONS.map((o) => [o.value, o.label]));

export const LEASE_STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  active: "Active",
  notice_given: "Notice given",
  ended: "Ended",
  terminated: "Terminated",
};

export const LEASE_EVENT_LABEL: Record<string, string> = {
  created: "Created",
  activated: "Activated",
  amended: "Amended",
  renewed: "Renewed",
  escalated: "Rent escalated",
  notice_given: "Notice given",
  terminated: "Terminated",
  ended: "Ended",
};

export const DOCUMENT_KIND_LABEL: Record<string, string> = {
  title_deed: "Title deed",
  inspection_report: "Inspection report",
  photo: "Photo",
  id_document: "ID document",
  lease_agreement: "Signed lease",
  proof_of_address: "Proof of address",
  payslip: "Payslip",
  bank_statement: "Bank statement",
  proof_of_payment: "Proof of payment",
  receipt: "Receipt",
  owner_statement: "Owner statement",
  confirmation_letter: "Lease confirmation letter",
  other: "Other",
};
