"use client";

import { useState, useTransition } from "react";

/**
 * Shows a masked value with a "Show (logged)" button that calls a server
 * action. The action audits each reveal; the full value is never in the page
 * until asked for.
 */
export function RevealValue({
  masked,
  reveal,
  testId,
}: {
  masked: string;
  reveal: () => Promise<{ value?: string | null; error?: string }>;
  testId?: string;
}) {
  const [value, setValue] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <span className="inline-flex items-center gap-2">
      <span className="font-mono" data-testid={testId}>
        {value ?? masked}
      </span>
      {value === null ? (
        <button
          type="button"
          className="text-xs underline"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await reveal();
              if (r.error) setError(r.error);
              else setValue(r.value ?? "—");
            })
          }
        >
          Show (logged)
        </button>
      ) : null}
      {error ? <span className="text-xs text-destructive">{error}</span> : null}
    </span>
  );
}
