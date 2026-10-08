import type { z } from "zod";

/** What every form server action returns to its client form. */
export interface FormState {
  ok?: boolean;
  error?: string;
  fieldErrors?: Record<string, string>;
  /** Echo of the submitted values so the form keeps them after an error. */
  values?: Record<string, string>;
}

export function formValues(form: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of form.entries()) if (typeof value === "string") out[key] = value;
  return out;
}

/** Parses FormData with a zod schema into data or a FormState with per-field messages. */
export function parseForm<S extends z.ZodType>(
  schema: S,
  form: FormData,
): { data: z.infer<S>; state?: undefined } | { data?: undefined; state: FormState } {
  const values = formValues(form);
  const result = schema.safeParse(values);
  if (result.success) return { data: result.data };
  const fieldErrors: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = String(issue.path[0] ?? "");
    fieldErrors[key] ??= issue.message;
  }
  return { state: { error: "Please fix the highlighted fields.", fieldErrors, values } };
}
