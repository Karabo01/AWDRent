"use client";

import { useId } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { FormState } from "@/server/forms";

/** Labelled input that shows its server-side error and keeps its value after one. */
export function Field({
  name,
  label,
  state,
  hint,
  defaultValue,
  multiline,
  ...props
}: {
  name: string;
  label: string;
  state?: FormState;
  hint?: string;
  defaultValue?: string | number | null;
  multiline?: boolean;
} & Omit<React.ComponentProps<"input">, "name" | "defaultValue">) {
  // Unique per instance: two forms on one page may both have a "reason" field
  const id = `${useId()}-${name}`;
  const error = state?.fieldErrors?.[name];
  const value = state?.values?.[name] ?? (defaultValue == null ? undefined : String(defaultValue));
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {multiline ? (
        <Textarea id={id} name={name} defaultValue={value} aria-invalid={!!error} aria-describedby={describedBy} />
      ) : (
        <Input id={id} name={name} defaultValue={value} aria-invalid={!!error} aria-describedby={describedBy} {...props} />
      )}
      {error ? (
        <p id={`${id}-error`} className="text-sm text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function FormMessage({ state }: { state?: FormState }) {
  if (state?.error) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {state.error}
      </p>
    );
  }
  if (state?.ok) {
    return (
      <p role="status" className="text-sm text-green-700">
        Saved.
      </p>
    );
  }
  return null;
}
