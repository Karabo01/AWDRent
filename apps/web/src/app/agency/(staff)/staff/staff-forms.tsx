"use client";

import { useActionState } from "react";
import { Field, FormMessage } from "@/components/form/fields";
import { SelectField } from "@/components/form/select-field";
import { Button } from "@/components/ui/button";
import { inviteStaffAction, updateStaffAction } from "./actions";

const ROLES = [
  { value: "agent", label: "Rental agent — their portfolio's owners, properties, tenants and leases" },
  { value: "accounts", label: "Accounts — payments, statements and exports" },
  { value: "admin", label: "Admin — everything, including settings and staff" },
];

export function InviteStaffForm() {
  const [state, action, pending] = useActionState(inviteStaffAction, {});
  return (
    <form action={action} className="grid gap-4">
      <Field name="name" label="Full name" state={state} required />
      <Field name="email" label="Email" type="email" state={state} required />
      <Field name="phone" label="Mobile number" type="tel" state={state} />
      <SelectField name="role" label="Role" options={ROLES} defaultValue="agent" state={state} />
      <FormMessage state={state} />
      <Button type="submit" disabled={pending} className="justify-self-start">
        Send invite
      </Button>
    </form>
  );
}

export function EditStaffForm({
  userId,
  values,
}: {
  userId: string;
  values: { name: string; role: string; phone: string | null; active: boolean };
}) {
  const [state, action, pending] = useActionState(updateStaffAction.bind(null, userId), {});
  return (
    <form action={action} className="grid gap-4">
      <Field name="name" label="Full name" defaultValue={values.name} state={state} required />
      <Field name="phone" label="Mobile number" type="tel" defaultValue={values.phone} state={state} />
      <SelectField name="role" label="Role" options={ROLES} defaultValue={values.role} state={state} />
      <SelectField
        name="active"
        label="Access"
        options={[
          { value: "true", label: "Active" },
          { value: "false", label: "Deactivated — cannot sign in" },
        ]}
        defaultValue={String(values.active)}
        state={state}
        hint="Deactivating signs them out everywhere at once. Their history stays in the audit log."
      />
      <FormMessage state={state} />
      <Button type="submit" disabled={pending} className="justify-self-start">
        Save
      </Button>
    </form>
  );
}
