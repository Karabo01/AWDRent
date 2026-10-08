"use client";

import { useActionState } from "react";
import { Field, FormMessage } from "@/components/form/fields";
import { SelectField } from "@/components/form/select-field";
import { Button } from "@/components/ui/button";
import type { FormState } from "@/server/forms";
import {
  activateLeaseAction,
  amendLeaseAction,
  applyEscalationAction,
  createLeaseAction,
  endLeaseAction,
  giveNoticeAction,
  renewLeaseAction,
  terminateLeaseAction,
} from "./actions";

export interface TermsValues {
  startDate: string;
  endDate: string | null;
  rent: string;
  dueDay: number;
  deposit: string;
  escalationPercent: string;
  escalationDate: string | null;
  noticeDays: number;
  notes: string | null;
}

function TermsFields({ state, values }: { state: FormState; values?: TermsValues }) {
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field name="startDate" label="Start date" type="date" defaultValue={values?.startDate} state={state} required />
        <Field name="endDate" label="End date" type="date" hint="Leave empty for month-to-month." defaultValue={values?.endDate} state={state} />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field name="rent" label="Monthly rent (R)" inputMode="decimal" defaultValue={values?.rent} state={state} required />
        <Field
          name="dueDay"
          label="Due day of month"
          type="number"
          min={1}
          max={31}
          hint="Short months use their last day."
          defaultValue={values?.dueDay ?? 1}
          state={state}
          required
        />
        <Field name="deposit" label="Deposit (R)" inputMode="decimal" defaultValue={values?.deposit ?? "0"} state={state} required />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field name="escalationPercent" label="Escalation (%)" inputMode="decimal" defaultValue={values?.escalationPercent} state={state} />
        <Field name="escalationDate" label="Escalation date" type="date" defaultValue={values?.escalationDate} state={state} />
        <Field name="noticeDays" label="Notice period (days)" type="number" min={0} defaultValue={values?.noticeDays ?? 30} state={state} required />
      </div>
      <Field name="notes" label="Notes" defaultValue={values?.notes} state={state} multiline />
    </>
  );
}

export function NewLeaseForm({
  units,
  tenants,
  defaults,
}: {
  units: { id: string; label: string; propertyName: string; status: string }[];
  tenants: { id: string; fullName: string }[];
  defaults: { unitId?: string; tenantId?: string };
}) {
  const [state, action, pending] = useActionState(createLeaseAction, {});
  return (
    <form action={action} className="grid gap-4">
      <SelectField
        name="unitId"
        label="Unit"
        defaultValue={defaults.unitId ?? ""}
        state={state}
        options={[
          { value: "", label: "Choose a unit…" },
          ...units.map((u) => ({ value: u.id, label: `${u.propertyName} — ${u.label}${u.status === "vacant" ? "" : ` (${u.status.replace("_", " ")})`}` })),
        ]}
      />
      <SelectField
        name="primaryTenantId"
        label="Main tenant"
        defaultValue={defaults.tenantId ?? ""}
        state={state}
        options={[{ value: "", label: "Choose the main tenant…" }, ...tenants.map((t) => ({ value: t.id, label: t.fullName }))]}
      />
      {tenants.length > 1 ? (
        <details>
          <summary className="cursor-pointer text-sm">Add co-tenants</summary>
          <fieldset className="mt-2 grid max-h-48 gap-1 overflow-y-auto rounded-md border p-3">
            {tenants.map((t) => (
              <label key={t.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="coTenantIds" value={t.id} />
                {t.fullName}
              </label>
            ))}
          </fieldset>
        </details>
      ) : null}
      <TermsFields state={state} />
      <FormMessage state={state} />
      <Button type="submit" disabled={pending} className="justify-self-start">
        Create draft lease
      </Button>
      <p className="text-xs text-muted-foreground">The EFT reference is assigned when the draft is created. Activate the lease once it is signed.</p>
    </form>
  );
}

/** One-click lifecycle step (activate, escalate, end). */
export function LeaseStepButton({
  leaseId,
  step,
  label,
  variant = "default",
}: {
  leaseId: string;
  step: "activate" | "escalate" | "end";
  label: string;
  variant?: "default" | "outline";
}) {
  const fn = { activate: activateLeaseAction, escalate: applyEscalationAction, end: endLeaseAction }[step];
  const [state, action, pending] = useActionState(fn.bind(null, leaseId), {});
  return (
    <form action={action} className="grid gap-2">
      <Button type="submit" variant={variant} disabled={pending}>
        {label}
      </Button>
      {state.error ? (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}

export function AmendLeaseForm({ leaseId, values }: { leaseId: string; values: TermsValues }) {
  const [state, action, pending] = useActionState(amendLeaseAction.bind(null, leaseId), {});
  const today = new Date().toISOString().slice(0, 10);
  return (
    <form action={action} className="grid gap-4">
      <TermsFields state={state} values={values} />
      <div className="grid gap-4 sm:grid-cols-[1fr_2fr]">
        <Field name="effectiveDate" label="Effective from" type="date" defaultValue={today} state={state} required />
        <Field name="reason" label="What changed and why" state={state} required />
      </div>
      <FormMessage state={state} />
      <Button type="submit" variant="outline" disabled={pending} className="justify-self-start">
        Save amendment
      </Button>
    </form>
  );
}

export function RenewLeaseForm({ leaseId, rent }: { leaseId: string; rent: string }) {
  const [state, action, pending] = useActionState(renewLeaseAction.bind(null, leaseId), {});
  return (
    <form action={action} className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <Field name="effectiveDate" label="New term starts" type="date" state={state} required />
        <Field name="newEndDate" label="New end date" type="date" hint="Empty for month-to-month." state={state} />
        <Field name="newRent" label="New monthly rent (R)" inputMode="decimal" defaultValue={rent} state={state} required />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field name="escalationPercent" label="Next escalation (%)" inputMode="decimal" state={state} />
        <Field name="escalationDate" label="Next escalation date" type="date" state={state} />
      </div>
      <FormMessage state={state} />
      <Button type="submit" variant="outline" disabled={pending} className="justify-self-start">
        Renew on the same EFT reference
      </Button>
    </form>
  );
}

export function NoticeForm({ leaseId }: { leaseId: string }) {
  const [state, action, pending] = useActionState(giveNoticeAction.bind(null, leaseId), {});
  return (
    <form action={action} className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field name="noticeDate" label="Notice received on" type="date" state={state} required />
        <Field name="endDate" label="Move-out date" type="date" state={state} required />
      </div>
      <Field name="note" label="Note" state={state} />
      <FormMessage state={state} />
      <Button type="submit" variant="outline" disabled={pending} className="justify-self-start">
        Record notice
      </Button>
    </form>
  );
}

export function TerminateForm({ leaseId }: { leaseId: string }) {
  const [state, action, pending] = useActionState(terminateLeaseAction.bind(null, leaseId), {});
  return (
    <form action={action} className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-[1fr_2fr]">
        <Field name="terminatedOn" label="Terminated on" type="date" state={state} required />
        <Field name="reason" label="Reason" state={state} required />
      </div>
      <FormMessage state={state} />
      <Button type="submit" variant="destructive" disabled={pending} className="justify-self-start">
        Terminate lease
      </Button>
    </form>
  );
}
