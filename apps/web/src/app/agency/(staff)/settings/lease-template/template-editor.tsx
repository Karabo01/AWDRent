"use client";

import { useActionState, useState } from "react";
import { FormMessage } from "@/components/form/fields";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { saveLeaseTemplateAction } from "./actions";

type Section = { heading: string; body: string };

/** Edit, add, remove and reorder the clauses of the agency's lease (D82). */
export function TemplateEditor({ initial }: { initial: Section[] }) {
  const [sections, setSections] = useState(initial);
  const [state, action, pending] = useActionState(saveLeaseTemplateAction, {});
  const update = (i: number, patch: Partial<Section>) => setSections((all) => all.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const move = (i: number, by: number) =>
    setSections((all) => {
      const next = [...all];
      const [item] = next.splice(i, 1);
      next.splice(i + by, 0, item!);
      return next;
    });
  return (
    <form action={action} className="grid gap-4">
      <input type="hidden" name="sections" value={JSON.stringify(sections)} />
      {sections.map((s, i) => (
        <fieldset key={i} className="grid gap-2 rounded-md border p-3" data-testid="clause">
          <legend className="px-1 text-sm font-medium">Clause {i + 1}</legend>
          <Input aria-label={`Clause ${i + 1} heading`} value={s.heading} onChange={(e) => update(i, { heading: e.target.value })} maxLength={120} />
          <Textarea aria-label={`Clause ${i + 1} text`} value={s.body} onChange={(e) => update(i, { body: e.target.value })} rows={5} maxLength={6000} />
          <div className="flex gap-3 text-xs">
            <button type="button" className="underline disabled:opacity-40" disabled={i === 0} onClick={() => move(i, -1)}>
              Move up
            </button>
            <button type="button" className="underline disabled:opacity-40" disabled={i === sections.length - 1} onClick={() => move(i, 1)}>
              Move down
            </button>
            <button type="button" className="text-destructive underline" onClick={() => setSections((all) => all.filter((_, j) => j !== i))}>
              Remove clause
            </button>
          </div>
        </fieldset>
      ))}
      <Button type="button" variant="outline" onClick={() => setSections((all) => [...all, { heading: "New clause", body: "" }])}>
        Add a clause
      </Button>
      <FormMessage state={state} />
      <Button type="submit" disabled={pending}>
        Save lease template
      </Button>
    </form>
  );
}
