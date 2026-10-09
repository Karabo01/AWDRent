"use client";

import { useActionState, useState } from "react";
import { FormMessage } from "@/components/form/fields";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { saveChecklistAction } from "./actions";

type Item = { key: string; label: string; required: boolean };

/** A new item's key comes from its name: "Latest tax return" → latest_tax_return. */
const keyFor = (label: string, taken: string[]) => {
  const base = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 36) || "item";
  let key = base.length >= 2 ? base : `item_${base}`;
  for (let i = 2; taken.includes(key); i++) key = `${base}_${i}`;
  return key;
};

export function ChecklistEditor({ type, initial }: { type: "employed" | "self_employed" | "company"; initial: Item[] }) {
  const [items, setItems] = useState(initial);
  const [state, action, pending] = useActionState(saveChecklistAction.bind(null, type), {});
  const update = (i: number, patch: Partial<Item>) => setItems((all) => all.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  return (
    <form action={action} className="grid gap-3" data-testid={`checklist-${type}`}>
      <input type="hidden" name="items" value={JSON.stringify(items)} />
      {items.map((item, i) => (
        <div key={item.key} className="flex flex-wrap items-center gap-3">
          <Input aria-label={`Item ${i + 1}`} value={item.label} onChange={(e) => update(i, { label: e.target.value })} className="max-w-md" maxLength={120} />
          <label className="flex items-center gap-1 text-sm">
            <input type="checkbox" checked={item.required} onChange={(e) => update(i, { required: e.target.checked })} />
            Required
          </label>
          <button type="button" className="text-xs text-destructive underline" onClick={() => setItems((all) => all.filter((_, j) => j !== i))}>
            Remove
          </button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="justify-self-start"
        onClick={() => setItems((all) => [...all, { key: keyFor(`item ${all.length + 1}`, all.map((x) => x.key)), label: "New document", required: false }])}
      >
        Add an item
      </Button>
      <FormMessage state={state} />
      <Button type="submit" disabled={pending} className="justify-self-start">
        Save checklist
      </Button>
    </form>
  );
}
