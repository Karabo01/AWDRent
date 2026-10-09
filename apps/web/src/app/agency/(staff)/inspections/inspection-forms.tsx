"use client";

import { useActionState } from "react";
import { Field, FormMessage } from "@/components/form/fields";
import { SelectField } from "@/components/form/select-field";
import { Button } from "@/components/ui/button";
import { useHydrated } from "@/lib/use-hydrated";
import { addItemAction, deleteInspectionAction, fileReportAction, saveInspectionAction, startInspectionAction } from "./actions";

const CONDITIONS = [
  { value: "", label: "Not rated" },
  { value: "good", label: "Good" },
  { value: "fair", label: "Fair" },
  { value: "poor", label: "Poor" },
  { value: "damaged", label: "Damaged" },
  { value: "missing", label: "Missing" },
  { value: "not_applicable", label: "N/A" },
];

const control = "h-9 rounded-md border border-input bg-transparent px-2 text-sm";

export function StartInspectionForm({ leaseId, kinds, today }: { leaseId: string; kinds: { value: string; label: string }[]; today: string }) {
  const [state, action, pending] = useActionState(startInspectionAction.bind(null, leaseId), {});
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
      <SelectField name="kind" label="Inspection" options={kinds} state={state} />
      <Field name="inspectedOn" label="Date" type="date" defaultValue={today} state={state} required />
      <Button type="submit" disabled={pending}>
        Start
      </Button>
      <div className="sm:col-span-3">
        <FormMessage state={state} />
      </div>
    </form>
  );
}

export interface SheetItem {
  id: string;
  room: string;
  item: string;
  condition: string | null;
  notes: string | null;
  ingoing: string | null;
  ingoingNotes: string | null;
  worse: boolean;
  photos: { id: string; filename: string; clean: boolean }[];
}

/** The room-by-room sheet: one form saves every item; "Save and complete" files the report. */
export function InspectionSheet({
  inspectionId,
  outgoing,
  details,
  items,
}: {
  inspectionId: string;
  outgoing: boolean;
  details: { inspectedOn: string; attendees: string | null; notes: string | null };
  items: SheetItem[];
}) {
  const [state, action, pending] = useActionState(saveInspectionAction.bind(null, inspectionId), {});
  const hydrated = useHydrated();
  const rooms = [...new Set(items.map((i) => i.room))];
  return (
    <form action={action} className="grid gap-6">
      <div className="grid gap-4 sm:grid-cols-[12rem_1fr]">
        <Field name="inspectedOn" label="Inspected on" type="date" defaultValue={details.inspectedOn} state={state} required />
        <Field name="attendees" label="Present" defaultValue={details.attendees} state={state} hint="The Act asks for the tenant and the agent to inspect together" />
      </div>
      <Field name="notes" label="General notes" multiline defaultValue={details.notes} state={state} />
      {rooms.map((room) => (
        <fieldset key={room} className="grid gap-2" data-testid="inspection-room">
          <legend className="mb-2 text-sm font-semibold">{room}</legend>
          {items
            .filter((i) => i.room === room)
            .map((i) => (
              <div key={i.id} className="grid gap-2 border-b pb-2 text-sm sm:grid-cols-[12rem_9rem_1fr] sm:items-start" data-testid="inspection-item">
                <div>
                  <div className="font-medium">{i.item}</div>
                  {outgoing ? (
                    <div className={i.worse ? "text-xs font-medium text-destructive" : "text-xs text-muted-foreground"}>
                      At move-in: {i.ingoing ?? "not recorded"}
                      {i.ingoingNotes ? ` (${i.ingoingNotes})` : ""}
                    </div>
                  ) : null}
                  {i.photos.length ? (
                    <div className="text-xs">
                      {i.photos.map((p) =>
                        p.clean ? (
                          <a key={p.id} href={`/documents/${p.id}/download`} className="mr-2 underline">
                            {p.filename}
                          </a>
                        ) : (
                          <span key={p.id} className="mr-2 text-muted-foreground">
                            {p.filename} (checking)
                          </span>
                        ),
                      )}
                    </div>
                  ) : null}
                </div>
                <select
                  name={`condition:${i.id}`}
                  aria-label={`${room}: ${i.item} condition`}
                  defaultValue={state.values?.[`condition:${i.id}`] ?? i.condition ?? ""}
                  className={control}
                >
                  {CONDITIONS.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
                <input
                  name={`notes:${i.id}`}
                  aria-label={`${room}: ${i.item} notes`}
                  defaultValue={state.values?.[`notes:${i.id}`] ?? i.notes ?? ""}
                  maxLength={1000}
                  placeholder="Notes"
                  className={`${control} w-full`}
                />
              </div>
            ))}
        </fieldset>
      ))}
      <FormMessage state={state} />
      <div className="flex flex-wrap gap-3">
        <Button type="submit" name="intent" value="save" variant="outline" disabled={pending || !hydrated}>
          Save
        </Button>
        <Button
          type="submit"
          name="intent"
          value="complete"
          disabled={pending || !hydrated}
          onClick={(e) => {
            if (!confirm("Complete the inspection? It cannot be changed afterwards. The report is filed with the lease and emailed to the tenants.")) e.preventDefault();
          }}
        >
          Save and complete
        </Button>
      </div>
    </form>
  );
}

export function AddItemForm({ inspectionId, rooms }: { inspectionId: string; rooms: string[] }) {
  const [state, action, pending] = useActionState(addItemAction.bind(null, inspectionId), {});
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
      <Field name="room" label="Room" list="inspection-rooms" state={state} required hint="An existing room or a new one" />
      <datalist id="inspection-rooms">
        {rooms.map((r) => (
          <option key={r} value={r} />
        ))}
      </datalist>
      <Field name="item" label="Item" state={state} required />
      <Button type="submit" variant="outline" disabled={pending}>
        Add item
      </Button>
      <div className="sm:col-span-3">
        <FormMessage state={state} />
      </div>
    </form>
  );
}

export function DeleteInspectionButton({ inspectionId, leaseId }: { inspectionId: string; leaseId: string }) {
  const [state, action, pending] = useActionState(deleteInspectionAction.bind(null, inspectionId, leaseId), {});
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!confirm("Delete this draft inspection?")) e.preventDefault();
      }}
      className="grid gap-2"
    >
      <Button type="submit" variant="outline" size="sm" disabled={pending} className="justify-self-start">
        Delete draft
      </Button>
      <FormMessage state={state} />
    </form>
  );
}

export function FileReportButton({ inspectionId }: { inspectionId: string }) {
  const [state, action, pending] = useActionState(fileReportAction.bind(null, inspectionId), {});
  return (
    <form action={action} className="grid gap-2">
      <Button type="submit" size="sm" disabled={pending} className="justify-self-start">
        Build and send the report
      </Button>
      <FormMessage state={state} />
    </form>
  );
}
