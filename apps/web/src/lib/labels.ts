// Display labels shared by server and client components. Keep this module
// free of "use client" so server pages can import plain values from it.

export const UNIT_STATUS_OPTIONS = [
  { value: "vacant", label: "Vacant" },
  { value: "occupied", label: "Occupied" },
  { value: "notice_given", label: "Notice given" },
  { value: "under_maintenance", label: "Under maintenance" },
];

export const UNIT_STATUS_LABEL: Record<string, string> = Object.fromEntries(UNIT_STATUS_OPTIONS.map((o) => [o.value, o.label]));
