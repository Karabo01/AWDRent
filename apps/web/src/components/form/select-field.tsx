"use client";

import { useId } from "react";
import { Label } from "@/components/ui/label";
import type { FormState } from "@/server/forms";

/** Native select styled like the inputs; posts its value with the form. */
export function SelectField({
  name,
  label,
  options,
  state,
  defaultValue,
  hint,
}: {
  name: string;
  label: string;
  options: { value: string; label: string }[];
  state?: FormState;
  defaultValue?: string | null;
  hint?: string;
}) {
  const id = `${useId()}-${name}`;
  const error = state?.fieldErrors?.[name];
  const value = state?.values?.[name] ?? defaultValue ?? undefined;
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <select
        id={id}
        name={name}
        defaultValue={value}
        aria-invalid={!!error}
        className="h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {error ? <p className="text-sm text-destructive">{error}</p> : hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
