"use client";

import { useActionState, useState } from "react";
import { Field, FormMessage } from "@/components/form/fields";
import { SelectField } from "@/components/form/select-field";
import { Button } from "@/components/ui/button";
import { addChargeAction, voidChargeAction } from "../actions";

const TYPES = [
  { value: "utility", label: "Utilities (water, electricity)" },
  { value: "damage", label: "Damage" },
  { value: "admin_fee", label: "Admin fee" },
  { value: "late_fee", label: "Late fee" },
  { value: "other", label: "Other" },
];

export function AddChargeForm({ leaseId, today }: { leaseId: string; today: string }) {
  const [state, action, pending] = useActionState(addChargeAction.bind(null, leaseId), {});
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr] sm:items-end">
      <SelectField name="type" label="Charge" options={TYPES} defaultValue="utility" state={state} />
      <Field name="amount" label="Amount (R)" inputMode="decimal" state={state} required />
      <Field name="dueDate" label="Due" type="date" defaultValue={today} state={state} required />
      <div className="sm:col-span-2">
        <Field name="description" label="Description" hint="Shown on the tenant's statement" state={state} required />
      </div>
      <Button type="submit" variant="outline" disabled={pending}>
        Add charge
      </Button>
      <div className="sm:col-span-3">
        <FormMessage state={state} />
      </div>
    </form>
  );
}

/** "Void" opens a reason box; the charge stays on the statement, struck through. */
export function VoidChargeButton({ leaseId, chargeId }: { leaseId: string; chargeId: string }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(voidChargeAction.bind(null, leaseId, chargeId), {});
  if (!open) {
    return (
      <button type="button" className="text-xs text-muted-foreground underline" onClick={() => setOpen(true)}>
        Void
      </button>
    );
  }
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <Field name="reason" label="Reason for voiding" state={state} />
      <Button type="submit" size="sm" variant="destructive" disabled={pending}>
        Void charge
      </Button>
      {state.error ? <p className="text-xs text-destructive">{state.error}</p> : null}
    </form>
  );
}
