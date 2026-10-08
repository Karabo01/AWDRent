"use client";

import { useActionState, useState } from "react";
import { Field } from "@/components/form/fields";
import { Button } from "@/components/ui/button";
import { approvePopAction, rejectPopAction } from "./actions";

export function ApproveWithLine({ popId, lineId, label }: { popId: string; lineId: string; label: string }) {
  const [state, action, pending] = useActionState(approvePopAction.bind(null, popId, lineId), {});
  return (
    <form action={action} className="inline-flex flex-col items-end gap-1">
      <Button type="submit" size="sm" disabled={pending}>
        {label}
      </Button>
      {state.error ? <span className="text-xs text-destructive">{state.error}</span> : null}
    </form>
  );
}

export function RejectPop({ popId }: { popId: string }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(rejectPopAction.bind(null, popId), {});
  if (!open) {
    return (
      <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(true)}>
        Reject
      </Button>
    );
  }
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <Field name="reason" label="Reason (sent to the tenant)" state={state} />
      <Button type="submit" size="sm" variant="destructive" disabled={pending}>
        Reject
      </Button>
    </form>
  );
}
