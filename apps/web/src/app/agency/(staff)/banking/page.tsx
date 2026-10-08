import { listImports, listLines, listProfiles } from "@awdrent/core/banking";
import { listLeases } from "@awdrent/core/leases";
import { formatCents } from "@awdrent/core/money";
import Link from "next/link";
import { PageHeader } from "@/components/shell/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { actorOf, load } from "@/server/actor";
import { requireCan } from "@/server/session";
import { ImportStatementForm, ResolveLine, UndoLine } from "./banking-forms";

export const metadata = { title: "Banking" };

const when = new Intl.DateTimeFormat("en-ZA", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Johannesburg" });

export default async function BankingPage() {
  const s = await requireCan("payments.approve");
  const actor = actorOf(s);
  const [profiles, unmatched, matched, imports, leases] = await Promise.all([
    load(() => listProfiles(actor)),
    load(() => listLines(actor, { status: "unmatched" })),
    load(() => listLines(actor, { status: "matched" })),
    load(() => listImports(actor)),
    load(() => listLeases(actor)),
  ]);
  const leaseOptions = leases
    .filter(({ lease }) => lease.status !== "ended" && lease.status !== "terminated")
    .map(({ lease, primaryTenant, propertyName, unitLabel }) => ({
      id: lease.id,
      label: `${lease.eftReference} — ${primaryTenant ?? "?"} — ${propertyName} ${unitLabel}`,
    }));

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Banking"
        description="Import the trust account statement. Payments count only once matched to a statement line."
        actions={
          <Button asChild variant="outline">
            <Link href="/banking/profiles">Bank formats</Link>
          </Button>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Import a statement</CardTitle>
        </CardHeader>
        <CardContent>
          {profiles.length ? (
            <ImportStatementForm profiles={profiles.map((p) => ({ id: p.id, name: p.name }))} />
          ) : (
            <p className="text-sm">
              First <Link href="/banking/profiles" className="underline">describe your bank&apos;s CSV format</Link>: which columns hold the date,
              amount and reference.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Waiting to be allocated ({unmatched.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {unmatched.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing waiting. Lines with a lease&apos;s EFT reference are matched automatically.</p>
          ) : (
            <Table data-testid="unmatched-lines">
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {unmatched.map(({ line }) => (
                  <TableRow key={line.id}>
                    <TableCell className="whitespace-nowrap">{line.lineDate}</TableCell>
                    <TableCell>
                      <span className="font-mono">{line.reference || "—"}</span>
                      {line.description ? <span className="ml-2 text-xs text-muted-foreground">{line.description}</span> : null}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatCents(line.amountCents)}</TableCell>
                    <TableCell>
                      <ResolveLine lineId={line.id} leases={leaseOptions} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recently matched</CardTitle>
        </CardHeader>
        <CardContent>
          {matched.length === 0 ? (
            <p className="text-sm text-muted-foreground">No payments matched yet.</p>
          ) : (
            <Table data-testid="matched-lines">
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead>Lease</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {matched.slice(0, 50).map(({ line, eftReference }) => (
                  <TableRow key={line.id}>
                    <TableCell className="whitespace-nowrap">{line.lineDate}</TableCell>
                    <TableCell className="font-mono">{line.reference}</TableCell>
                    <TableCell>
                      <Link href={`/leases/${line.matchedLeaseId}`} className="font-mono underline">
                        {eftReference}
                      </Link>
                      {line.autoMatched ? <Badge variant="secondary" className="ml-2">auto</Badge> : null}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatCents(line.amountCents)}</TableCell>
                    <TableCell className="text-right">
                      <UndoLine lineId={line.id} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {imports.length ? (
        <Card>
          <CardHeader>
            <CardTitle>Statements imported</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-1 text-sm">
              {imports.map(({ imp, userName }) => (
                <li key={imp.id}>
                  {when.format(imp.createdAt)} · {imp.fileName} · {imp.periodFrom} to {imp.periodTo} · {imp.newLines} new of {imp.creditLines},{" "}
                  {imp.autoMatched} auto-matched · {userName ?? "AWDTECH support"}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
