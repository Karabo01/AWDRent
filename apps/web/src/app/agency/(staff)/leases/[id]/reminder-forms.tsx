"use client";

import { useActionState } from "react";
import { Field, FormMessage } from "@/components/form/fields";
import { Button } from "@/components/ui/button";
import { pauseRemindersAction } from "./reminder-actions";

export function PauseRemindersForm({ leaseId, today }: { leaseId: string; today: string }) {
  const [state, action, pending] = useActionState(pauseRemindersAction.bind(null, leaseId), {});
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-[2fr_1fr_auto] sm:items-end">
      <Field name="reason" label="Reason" hint="e.g. agreed to pay the arrears in two parts" state={state} required />
      <Field name="until" label="Until (optional)" type="date" min={today} state={state} />
      <Button type="submit" variant="outline" disabled={pending}>
        Pause overdue messages
      </Button>
      <div className="sm:col-span-3">
        <FormMessage state={state} />
      </div>
    </form>
  );
}
