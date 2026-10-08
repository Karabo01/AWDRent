"use client";

import { useActionState } from "react";
import { Field, FormMessage } from "@/components/form/fields";
import { Button } from "@/components/ui/button";
import {
  enableSupportWriteAction,
  setAgencyStatusAction,
  startSupportAction,
  updateAgencyAction,
} from "../../actions";

export function AgencySettingsForm({
  id,
  values,
}: {
  id: string;
  values: { name: string; plan: string; includedUnits: number; includedSms: number; smsSenderName: string | null };
}) {
  const [state, action, pending] = useActionState(updateAgencyAction.bind(null, id), {});
  return (
    <form action={action} className="grid gap-4">
      <Field name="name" label="Agency name" defaultValue={values.name} state={state} required />
      <div className="grid gap-4 sm:grid-cols-3">
        <Field name="plan" label="Plan" defaultValue={values.plan} state={state} required />
        <Field name="includedUnits" label="Included units" type="number" min={0} defaultValue={values.includedUnits} state={state} />
        <Field name="includedSms" label="Included SMS / month" type="number" min={0} defaultValue={values.includedSms} state={state} />
      </div>
      <Field
        name="smsSenderName"
        label="SMS sender ID"
        hint="Up to 11 letters or digits, once registered with the SMS gateway. Leave empty for the default."
        defaultValue={values.smsSenderName}
        state={state}
      />
      <FormMessage state={state} />
      <Button type="submit" disabled={pending} className="justify-self-start">
        Save
      </Button>
    </form>
  );
}

export function AgencyStatusForm({ id, status }: { id: string; status: "active" | "suspended" }) {
  const [state, action, pending] = useActionState(setAgencyStatusAction.bind(null, id), {});
  if (status === "suspended") {
    return (
      <form action={action} className="grid gap-3">
        <input type="hidden" name="status" value="active" />
        <FormMessage state={state} />
        <Button type="submit" disabled={pending} className="justify-self-start">
          Reactivate agency
        </Button>
      </form>
    );
  }
  return (
    <form action={action} className="grid gap-3">
      <input type="hidden" name="status" value="suspended" />
      <Field name="reason" label="Reason for suspending" hint="Shown in the platform log." state={state} />
      <FormMessage state={state} />
      <Button type="submit" variant="destructive" disabled={pending} className="justify-self-start">
        Suspend agency and sign everyone out
      </Button>
    </form>
  );
}

export function SupportStartForm({ id }: { id: string }) {
  const [state, action, pending] = useActionState(startSupportAction.bind(null, id), {});
  return (
    <form action={action} className="grid gap-3">
      <Field
        name="reason"
        label="Reason for access"
        hint="Recorded in the platform log and the agency's audit log. Read-only for 60 minutes."
        state={state}
        multiline
      />
      <FormMessage state={state} />
      <Button type="submit" disabled={pending} className="justify-self-start">
        Start support session
      </Button>
    </form>
  );
}

export function EnableWriteForm({ sessionId, subdomain }: { sessionId: string; subdomain: string }) {
  const [state, action, pending] = useActionState(enableSupportWriteAction.bind(null, sessionId, subdomain), {});
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <Field name="confirm" label={`Type ${subdomain} to allow changes`} state={state} autoComplete="off" />
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        Enable write access
      </Button>
    </form>
  );
}
