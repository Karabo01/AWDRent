"use client";

import { useActionState, useRef, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { importAction, type ImportState } from "./actions";

const FILES = [
  { key: "owners", label: "Owners" },
  { key: "properties", label: "Properties" },
  { key: "units", label: "Units" },
  { key: "tenants", label: "Tenants" },
  { key: "leases", label: "Leases" },
] as const;

export function ImportForm() {
  const [state, action] = useActionState<ImportState, FormData>(importAction, {});
  const [pending, start] = useTransition();
  const form = useRef<HTMLFormElement>(null);

  // Submitted by hand rather than through the form's action prop, which would
  // clear the chosen files after "Check files"; the same files are then imported.
  function submit(mode: "check" | "run") {
    if (!form.current) return;
    const data = new FormData(form.current);
    data.set("mode", mode);
    start(() => action(data));
  }

  const report = state.report;
  return (
    <div className="grid gap-6">
      <form ref={form} onSubmit={(e) => e.preventDefault()} className="grid gap-3">
        {FILES.map((f) => (
          <label key={f.key} className="grid gap-1 text-sm sm:grid-cols-[8rem_1fr] sm:items-center">
            <span className="font-medium">{f.label}</span>
            <input type="file" name={f.key} accept=".csv,text/csv" className="text-sm" />
          </label>
        ))}
        <div className="flex flex-wrap gap-2 pt-2">
          <Button type="button" variant="outline" disabled={pending} onClick={() => submit("check")}>
            {pending && state.mode !== "run" ? "Checking…" : "Check files"}
          </Button>
          <Button type="button" disabled={pending || !report?.ok || state.imported} onClick={() => submit("run")}>
            {pending ? "Importing…" : "Import"}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Check first: nothing is saved until you press Import, and then either every row is imported or none is.
        </p>
      </form>

      {state.error ? (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      ) : null}

      {report ? (
        <div className="grid gap-4" data-testid="import-report">
          {state.imported ? (
            <p role="status" className="rounded-md bg-green-50 p-3 text-sm text-green-900">
              Imported {summary(report.counts)}.
            </p>
          ) : report.ok ? (
            <p role="status" className="rounded-md bg-green-50 p-3 text-sm text-green-900">
              Ready to import {summary(report.counts)}. No errors found.
            </p>
          ) : (
            <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-900">
              {report.errors.length} problem{report.errors.length === 1 ? "" : "s"} to fix before importing.
            </p>
          )}
          <Issues title="Errors" rows={report.errors} />
          <Issues title="Warnings (import will still work)" rows={report.warnings} />
        </div>
      ) : null}
    </div>
  );
}

function summary(counts: Record<string, number>) {
  return Object.entries(counts)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${n} ${k}`)
    .join(", ");
}

function Issues({ title, rows }: { title: string; rows: { file: string; row: number; column?: string; message: string }[] }) {
  if (rows.length === 0) return null;
  return (
    <div>
      <h2 className="mb-2 text-sm font-semibold">{title}</h2>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>File</TableHead>
            <TableHead>Row</TableHead>
            <TableHead>Column</TableHead>
            <TableHead>Problem</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.slice(0, 200).map((r, i) => (
            <TableRow key={i}>
              <TableCell>{r.file}.csv</TableCell>
              <TableCell className="tabular-nums">{r.row || "—"}</TableCell>
              <TableCell className="font-mono text-xs">{r.column ?? "—"}</TableCell>
              <TableCell>{r.message}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {rows.length > 200 ? <p className="mt-2 text-xs text-muted-foreground">Showing the first 200 of {rows.length}.</p> : null}
    </div>
  );
}
