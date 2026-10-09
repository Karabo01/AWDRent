"use client";

import { useActionState } from "react";
import { Field, FormMessage } from "@/components/form/fields";
import { SelectField } from "@/components/form/select-field";
import { Button } from "@/components/ui/button";
import { logRequestAction, saveContractorAction, updateRequestAction } from "./actions";

const PRIORITIES = [
  { value: "low", label: "Low" },
  { value: "normal", label: "Normal" },
  { value: "urgent", label: "Urgent" },
  { value: "emergency", label: "Emergency" },
];
const STATUSES = [
  { value: "open", label: "Logged" },
  { value: "assigned", label: "Contractor assigned" },
  { value: "in_progress", label: "In progress" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
];

export function LogRequestForm({ units }: { units: { value: string; label: string }[] }) {
  const [state, action, pending] = useActionState(logRequestAction, {});
  return (
    <form action={action} className="grid max-w-xl gap-4">
      <SelectField name="unitId" label="Unit" options={[{ value: "", label: "Choose…" }, ...units]} state={state} />
      <Field name="title" label="What is wrong" state={state} required />
      <Field name="description" label="Details" multiline state={state} required />
      <SelectField name="priority" label="Priority" options={PRIORITIES} defaultValue="normal" state={state} />
      <FormMessage state={state} />
      <Button type="submit" disabled={pending}>
        Log request
      </Button>
    </form>
  );
}

export function UpdateRequestForm({
  requestId,
  status,
  priority,
  contractorId,
  contractors,
}: {
  requestId: string;
  status: string;
  priority: string;
  contractorId: string | null;
  contractors: { value: string; label: string }[];
}) {
  const [state, action, pending] = useActionState(updateRequestAction.bind(null, requestId), {});
  return (
    <form action={action} className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <SelectField name="status" label="Status" options={STATUSES} defaultValue={status} state={state} />
        <SelectField name="priority" label="Priority" options={PRIORITIES} defaultValue={priority} state={state} />
        <SelectField name="contractorId" label="Contractor" options={[{ value: "", label: "None" }, ...contractors]} defaultValue={contractorId ?? ""} state={state} />
      </div>
      <Field name="note" label="Note" multiline state={state} hint="A new contractor is emailed a job card with the tenant's name and phone. The tenant is told of status changes." />
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="visibleToTenant" defaultChecked={false} />
        Show this note to the tenant
      </label>
      <FormMessage state={state} />
      <Button type="submit" disabled={pending} className="justify-self-start">
        Save update
      </Button>
    </form>
  );
}

export function ContractorForm({
  contractorId,
  values,
}: {
  contractorId: string | null;
  values?: { name: string; trade: string | null; email: string | null; phone: string | null; notes: string | null; active: boolean };
}) {
  const [state, action, pending] = useActionState(saveContractorAction.bind(null, contractorId), {});
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2">
      <Field name="name" label="Name" defaultValue={values?.name} state={state} required />
      <Field name="trade" label="Trade" defaultValue={values?.trade} state={state} hint="e.g. plumber, electrician" />
      <Field name="email" label="Email" type="email" defaultValue={values?.email} state={state} hint="Job cards are emailed here" />
      <Field name="phone" label="Phone" defaultValue={values?.phone} state={state} />
      <div className="sm:col-span-2">
        <Field name="notes" label="Notes" defaultValue={values?.notes} state={state} />
      </div>
      {contractorId ? (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="active" defaultChecked={values?.active ?? true} />
          Active
        </label>
      ) : null}
      <div className="sm:col-span-2">
        <FormMessage state={state} />
      </div>
      <Button type="submit" disabled={pending} className="justify-self-start">
        {contractorId ? "Save" : "Add contractor"}
      </Button>
    </form>
  );
}
