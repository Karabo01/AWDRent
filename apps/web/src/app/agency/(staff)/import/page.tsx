import { IMPORT_FILES, listImports } from "@awdrent/core/import";
import { PageHeader } from "@/components/shell/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { actorOf, load } from "@/server/actor";
import { requireCan } from "@/server/session";
import { ImportForm } from "./import-form";

export const metadata = { title: "Import" };

const when = new Intl.DateTimeFormat("en-ZA", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Johannesburg" });

export default async function ImportPage() {
  const s = await requireCan("import.run");
  const history = await load(() => listImports({ ...actorOf(s), ctx: { ...s.ctx, readOnly: true } }));
  return (
    <div className="grid gap-6">
      <PageHeader
        title="Import from spreadsheets"
        description="Bring in owners, properties, units, tenants and leases from your current spreadsheets."
      />
      <Card>
        <CardHeader>
          <CardTitle>1. Download the templates</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm">
          <p>
            Fill in one file per sheet. Rows are linked by your own codes: <code>owner_ref</code>, <code>property_ref</code> and{" "}
            <code>tenant_ref</code> (anything unique, e.g. O1, P1, T1). Keep a lease&apos;s current EFT reference in{" "}
            <code>eft_reference</code> so tenants can keep paying with it; leave it empty to get a new one. Dates can be
            31/10/2026 or 2026-10-31. Excel&apos;s semicolon-separated CSV works too.
          </p>
          <ul className="flex flex-wrap gap-3">
            {IMPORT_FILES.map((f) => (
              <li key={f}>
                <a href={`/import/template/${f}.csv`} className="underline" download>
                  {f}.csv
                </a>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>2. Check, then import</CardTitle>
        </CardHeader>
        <CardContent>
          <ImportForm />
        </CardContent>
      </Card>
      {history.length ? (
        <Card>
          <CardHeader>
            <CardTitle>Previous imports</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-1 text-sm">
              {history.map(({ job, userName }) => (
                <li key={job.id}>
                  {when.format(job.createdAt)} · {userName ?? "AWDTECH support"} ·{" "}
                  {job.status === "completed" ? "Imported" : "Failed, nothing saved"} ·{" "}
                  {IMPORT_FILES.map((k) => [k, (job.counts as Record<string, number>)[k] ?? 0] as const)
                    .filter(([, n]) => n > 0)
                    .map(([k, n]) => `${n} ${k}`)
                    .join(", ")}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
