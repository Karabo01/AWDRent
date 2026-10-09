"use client";

import { useActionState } from "react";
import { FormMessage } from "@/components/form/fields";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { approveRunAction, prepareRunAction, setLettingFeeAction } from "./actions";

export function PrepareRunForm({ defaultMonth, maxMonth, label = "Prepare statements" }: { defaultMonth: string; maxMonth: string; label?: string }) {
  const [state, action, pending] = useActionState(prepareRunAction, {});
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <div className="grid gap-1.5">
        <Label htmlFor="statement-month">Month</Label>
        <Input id="statement-month" name="month" type="month" defaultValue={defaultMonth} max={maxMonth} required className="w-44" />
      </div>
      <Button type="submit" disabled={pending}>
        {label}
      </Button>
      <div className="w-full">
        <FormMessage state={state} />
      </div>
    </form>
  );
}

export function ApproveRunForm({ runId, owners }: { runId: string; owners: number }) {
  const [state, action, pending] = useActionState(approveRunAction.bind(null, runId), {});
  return (
    <form
      action={action}
      className="grid gap-2"
      onSubmit={(e) => {
        if (!confirm(`Approve and email ${owners} statement${owners === 1 ? "" : "s"}? Approved statements cannot be changed.`)) e.preventDefault();
      }}
    >
      <Button type="submit" disabled={pending}>
        Approve and email to owners
      </Button>
      <FormMessage state={state} />
    </form>
  );
}

export function LettingFeeToggle({ leaseId, applies }: { leaseId: string; applies: boolean }) {
  const [state, action, pending] = useActionState(setLettingFeeAction.bind(null, leaseId, !applies), {});
  return (
    <form action={action} className="inline-flex flex-wrap items-center gap-2">
      <button type="submit" className="text-xs underline" disabled={pending}>
        {applies ? "Do not take the letting fee on this lease" : "Take the letting fee on this lease"}
      </button>
      {state.error ? <span className="text-xs text-destructive">{state.error}</span> : null}
    </form>
  );
}
