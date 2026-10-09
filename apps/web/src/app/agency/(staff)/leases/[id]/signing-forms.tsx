"use client";

import { useActionState, useState } from "react";
import { Field, FormMessage } from "@/components/form/fields";
import { SelectField } from "@/components/form/select-field";
import { Button } from "@/components/ui/button";
import { cancelEnvelopeAction, sendForSigningAction } from "./signing-actions";

type Staff = { id: string; name: string; role: string };

function previewHref(leaseId: string, form: HTMLFormElement | null) {
  if (!form) return "#";
  const params = new URLSearchParams();
  for (const [k, v] of new FormData(form).entries()) if (typeof v === "string") params.set(k, v);
  return `/leases/${leaseId}/documents/preview?${params.toString()}`;
}

/** Choose who signs, preview the draft, then send it out for signing. */
export function PrepareForm({ leaseId, kind, staff, defaultAgentId }: { leaseId: string; kind: "lease_agreement" | "confirmation_letter"; staff: Staff[]; defaultAgentId: string | null }) {
  const [state, action, pending] = useActionState(sendForSigningAction.bind(null, leaseId), {});
  const [form, setForm] = useState<HTMLFormElement | null>(null);
  const agents = staff.map((u) => ({ value: u.id, label: `${u.name}${u.role === "admin" ? " (admin)" : ""}` }));
  const admins = staff.filter((u) => u.role === "admin").map((u) => ({ value: u.id, label: u.name }));
  return (
    <form ref={setForm} action={action} className="grid gap-3" data-testid={`prepare-${kind}`}>
      <input type="hidden" name="kind" value={kind} />
      {kind === "lease_agreement" ? (
        <SelectField
          name="landlordSignatory"
          label="Who signs for the landlord"
          options={[
            { value: "owner", label: "The owner signs personally" },
            { value: "agent", label: "The agent signs under the agency's mandate" },
          ]}
          defaultValue="owner"
          state={state}
        />
      ) : null}
      <SelectField name="agentUserId" label="Agent" options={agents} defaultValue={defaultAgentId ?? agents[0]?.value} state={state} />
      {kind === "confirmation_letter" ? (
        <SelectField name="representativeUserId" label="Authorised representative (an admin)" options={admins} defaultValue={admins.find((a) => a.value !== defaultAgentId)?.value} state={state} />
      ) : null}
      <FormMessage state={state} />
      <div className="flex flex-wrap gap-2">
        <Button asChild variant="outline" size="sm">
          <a href="#" target="_blank" rel="noopener" onClick={(e) => (e.currentTarget.href = previewHref(leaseId, form))}>
            Preview draft
          </a>
        </Button>
        <Button type="submit" size="sm" disabled={pending}>
          Send for signing
        </Button>
      </div>
    </form>
  );
}

export function CancelEnvelopeForm({ leaseId, envelopeId }: { leaseId: string; envelopeId: string }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(cancelEnvelopeAction.bind(null, leaseId, envelopeId), {});
  if (!open) {
    return (
      <button type="button" className="text-xs text-muted-foreground underline" onClick={() => setOpen(true)}>
        Cancel
      </button>
    );
  }
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <Field name="reason" label="Why cancel?" state={state} />
      <Button type="submit" size="sm" variant="destructive" disabled={pending}>
        Cancel signing
      </Button>
    </form>
  );
}
