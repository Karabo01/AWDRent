"use client";

import { useActionState, useState } from "react";
import { Field, FormMessage } from "@/components/form/fields";
import { SelectField } from "@/components/form/select-field";
import { Button } from "@/components/ui/button";
import type { FormState } from "@/server/forms";
import {
  allocateLineAction,
  ignoreLineAction,
  type ImportResultState,
  importStatementAction,
  saveProfileAction,
  unallocateLineAction,
} from "./actions";

export function ImportStatementForm({ profiles }: { profiles: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState<ImportResultState, FormData>(importStatementAction, {});
  return (
    <form action={action} className="grid gap-3">
      <div className="grid gap-3 sm:grid-cols-[1fr_2fr_auto] sm:items-end">
        <SelectField name="profileId" label="Bank format" options={profiles.map((p) => ({ value: p.id, label: p.name }))} defaultValue={profiles[0]?.id} />
        <label className="grid gap-1.5 text-sm">
          Trust account statement (CSV)
          <input type="file" name="file" accept=".csv,text/csv" required className="text-sm" />
        </label>
        <Button type="submit" disabled={pending}>
          {pending ? "Importing…" : "Import statement"}
        </Button>
      </div>
      {state.summary ? (
        <p role="status" className="text-sm text-green-700" data-testid="import-summary">
          {state.summary}
        </p>
      ) : null}
      {state.error ? (
        <div role="alert" className="text-sm text-destructive">
          <p>{state.error}</p>
          {state.problems?.length ? (
            <ul className="mt-1 list-disc pl-5">
              {state.problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}

export function ResolveLine({ lineId, leases }: { lineId: string; leases: { id: string; label: string }[] }) {
  const [mode, setMode] = useState<"none" | "allocate" | "ignore">("none");
  const [allocState, allocate, allocPending] = useActionState(allocateLineAction.bind(null, lineId), {});
  const [ignoreState, ignore, ignorePending] = useActionState(ignoreLineAction.bind(null, lineId), {});
  if (mode === "none") {
    return (
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="outline" onClick={() => setMode("allocate")}>
          Allocate
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setMode("ignore")}>
          Ignore
        </Button>
      </div>
    );
  }
  if (mode === "ignore") {
    return (
      <form action={ignore} className="flex flex-wrap items-end justify-end gap-2">
        <Field name="reason" label="Why is this not rent?" state={ignoreState} />
        <Button type="submit" size="sm" disabled={ignorePending}>
          Ignore line
        </Button>
        <FormMessage state={ignoreState} />
      </form>
    );
  }
  return (
    <form action={allocate} className="flex flex-wrap items-end justify-end gap-2">
      <SelectField name="leaseId" label="Lease" options={[{ value: "", label: "Choose a lease…" }, ...leases.map((l) => ({ value: l.id, label: l.label }))]} />
      <SelectField
        name="target"
        label="For"
        options={[
          { value: "rent", label: "Rent" },
          { value: "deposit", label: "Deposit" },
        ]}
      />
      <Button type="submit" size="sm" disabled={allocPending}>
        Allocate
      </Button>
      {allocState.error ? <p className="w-full text-right text-xs text-destructive">{allocState.error}</p> : null}
    </form>
  );
}

export function UndoLine({ lineId }: { lineId: string }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(unallocateLineAction.bind(null, lineId), {});
  if (!open) {
    return (
      <button type="button" className="text-xs text-muted-foreground underline" onClick={() => setOpen(true)}>
        Undo
      </button>
    );
  }
  return (
    <form action={action} className="flex flex-wrap items-end justify-end gap-2">
      <Field name="reason" label="Reason" state={state} />
      <Button type="submit" size="sm" variant="destructive" disabled={pending}>
        Undo
      </Button>
      {state.error ? <p className="w-full text-right text-xs text-destructive">{state.error}</p> : null}
    </form>
  );
}

export interface ProfileValues {
  name: string;
  dateColumn: string;
  amountMode: "single" | "split";
  amountColumn: string;
  creditColumn: string;
  debitColumn: string;
  referenceColumn: string;
  descriptionColumn: string;
  dateFormat: string;
  skipRows: number;
}

export function ProfileForm({ profileId, values }: { profileId: string | null; values?: ProfileValues }) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveProfileAction.bind(null, profileId), {});
  const [mode, setMode] = useState(values?.amountMode ?? "single");
  return (
    <form action={action} className="grid gap-4">
      <Field name="name" label="Name" hint="e.g. FNB business account CSV" defaultValue={values?.name} state={state} required />
      <p className="text-sm text-muted-foreground">Type the column headings exactly as they appear in the bank&apos;s CSV file.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field name="dateColumn" label="Date column" defaultValue={values?.dateColumn ?? "Date"} state={state} required />
        <SelectField
          name="dateFormat"
          label="Date order"
          defaultValue={values?.dateFormat ?? "DMY"}
          state={state}
          options={[
            { value: "DMY", label: "Day/month/year (31/10/2026)" },
            { value: "YMD", label: "Year-month-day (2026-10-31)" },
            { value: "MDY", label: "Month/day/year (10/31/2026)" },
          ]}
        />
      </div>
      <fieldset className="grid gap-3">
        <legend className="mb-1 text-sm font-medium">Amount</legend>
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" name="amountMode" value="single" checked={mode === "single"} onChange={() => setMode("single")} />
          One column, negative for money out
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" name="amountMode" value="split" checked={mode === "split"} onChange={() => setMode("split")} />
          Separate money-in and money-out columns
        </label>
        {mode === "single" ? (
          <Field name="amountColumn" label="Amount column" defaultValue={values?.amountColumn ?? "Amount"} state={state} />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field name="creditColumn" label="Money-in column" defaultValue={values?.creditColumn} state={state} />
            <Field name="debitColumn" label="Money-out column" defaultValue={values?.debitColumn} state={state} />
          </div>
        )}
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field name="referenceColumn" label="Reference column" hint="Where the tenant's EFT reference appears" defaultValue={values?.referenceColumn ?? "Reference"} state={state} required />
        <Field name="descriptionColumn" label="Description column (optional)" defaultValue={values?.descriptionColumn} state={state} />
      </div>
      <Field
        name="skipRows"
        label="Lines above the headings"
        type="number"
        min={0}
        max={50}
        hint="Some banks print the account details first; count those lines"
        defaultValue={values?.skipRows ?? 0}
        state={state}
      />
      <FormMessage state={state} />
      <Button type="submit" disabled={pending} className="justify-self-start">
        Save bank format
      </Button>
    </form>
  );
}
