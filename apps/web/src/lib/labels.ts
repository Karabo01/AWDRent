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
