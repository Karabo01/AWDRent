"use client";

import { useActionState, useState } from "react";
import { Field, FormMessage } from "@/components/form/fields";
import { SelectField } from "@/components/form/select-field";
import { Button } from "@/components/ui/button";
import { decideAction, inviteAction, reviewFileAction } from "./actions";

export function InviteForm({ units, defaultStart }: { units: { value: string; label: string }[]; defaultStart: string }) {
  const [state, action, pending] = useActionState(inviteAction, {});
  return (
    <form action={action} className="grid max-w-xl gap-4">
      <SelectField name="unitId" label="Unit" options={[{ value: "", label: "Choose…" }, ...units]} state={state} />
      <SelectField
        name="applicantType"
        label="Applicant"
        options={[
          { value: "employed", label: "Employed" },
          { value: "self_employed", label: "Self-employed" },
          { value: "company", label: "A company" },
        ]}
        defaultValue="employed"
        state={state}
      />
      <Field name="fullName" label="Applicant's name" state={state} required />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field name="email" label="Email" type="email" state={state} />
        <Field name="phone" label="Mobile number" type="tel" state={state} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field name="proposedRent" label="Monthly rent (R)" inputMode="decimal" state={state} required />
        <Field name="proposedStart" label="Move-in date" type="date" defaultValue={defaultStart} state={state} required />
      </div>
      <p className="text-xs text-muted-foreground">The applicant is sent a personal link by email and SMS. Approving creates the tenant and a draft lease with this rent and date.</p>
      <FormMessage state={state} />
      <Button type="submit" disabled={pending} className="justify-self-start">
        Send the application link
      </Button>
    </form>
  );
}

export function ReviewFileButtons({ applicationId, fileId, canAccept }: { applicationId: string; fileId: string; canAccept: boolean }) {
  const [rejecting, setRejecting] = useState(false);
  const [acceptState, accept, accepting] = useActionState(reviewFileAction.bind(null, applicationId, fileId, true), {});
  const [rejectState, reject, rejectingPending] = useActionState(reviewFileAction.bind(null, applicationId, fileId, false), {});
  if (rejecting) {
    return (
      <form action={reject} className="flex flex-wrap items-end gap-2">
        <Field name="reason" label="What is wrong" state={rejectState} />
        <Button type="submit" size="sm" variant="destructive" disabled={rejectingPending}>
          Ask for a new file
        </Button>
      </form>
    );
  }
  return (
    <div className="flex items-center gap-2">
      {canAccept ? (
        <form action={accept}>
          <Button type="submit" size="sm" variant="outline" disabled={accepting}>
            Accept
          </Button>
        </form>
      ) : null}
      <button type="button" className="text-xs underline" onClick={() => setRejecting(true)}>
        Reject
      </button>
      {acceptState.error ? <span className="text-xs text-destructive">{acceptState.error}</span> : null}
    </div>
  );
}

export function DecisionForms({ applicationId, canApprove, open }: { applicationId: string; canApprove: boolean; open: boolean }) {
  const [approveState, approve, approving] = useActionState(decideAction.bind(null, applicationId, "approve"), {});
  const [declineState, decline, declining] = useActionState(decideAction.bind(null, applicationId, "decline"), {});
  const [otherState, resend, resending] = useActionState(decideAction.bind(null, applicationId, "resend"), {});
  const [revokeState, revoke, revoking] = useActionState(decideAction.bind(null, applicationId, "revoke"), {});
  return (
    <div className="grid gap-4">
      {open ? (
        <>
          <form action={approve} className="grid gap-2">
            <Button type="submit" disabled={!canApprove || approving} className="justify-self-start">
              Approve: create the tenant and a draft lease
            </Button>
            {!canApprove ? <p className="text-xs text-muted-foreground">Once submitted, accept a file for every required item to approve.</p> : null}
            <FormMessage state={approveState} />
          </form>
          <form action={decline} className="flex flex-wrap items-end gap-2">
            <Field name="reason" label="Decline: why (internal)" state={declineState} />
            <Button type="submit" variant="outline" disabled={declining}>
              Decline
            </Button>
            <div className="w-full">
              <FormMessage state={declineState} />
            </div>
          </form>
        </>
      ) : null}
      <div className="flex flex-wrap gap-4 text-sm">
        <form action={resend}>
          <button type="submit" className="underline" disabled={resending}>
            Send a new link
          </button>
        </form>
        {open ? (
          <form action={revoke}>
            <button type="submit" className="text-muted-foreground underline" disabled={revoking}>
              Revoke the link
            </button>
          </form>
        ) : null}
      </div>
      <FormMessage state={otherState.error ? otherState : revokeState} />
    </div>
  );
}
