import { addMonths, monthStart, todayInSouthAfrica } from "@awdrent/core/billing";
import { formatCents } from "@awdrent/core/money";
import { can } from "@awdrent/core/permissions";
import { AGEING_BUCKETS, AGEING_LABEL, arrearsAgeing, collections, expiringLeases, occupancy } from "@awdrent/core/reports";
import Link from "next/link";
import { PageHeader } from "@/components/shell/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { actorOf, load } from "@/server/actor";
import { requireCan } from "@/server/session";

export const metadata = { title: "Reports" };

const UNIT_STATUS: Record<string, string> = { vacant: "Vacant", occupied: "Occupied", notice_given: "Notice given", under_maintenance: "Under maintenance" };
const month = new Intl.DateTimeFormat("en-ZA", { month: "long", year: "numeric", timeZone: "UTC" });

/** Reports (spec 7): arrears ageing, occupancy, leases ending, collections; CSV exports. */
export default async function ReportsPage() {
  const s = await requireCan("reports.view");
  const actor = actorOf(s);
  const today = todayInSouthAfrica();
  const [ageing, occ, expiring, col] = await Promise.all([
    load(() => arrearsAgeing(actor, today)),
    load(() => occupancy(actor)),
    load(() => expiringLeases(actor, today)),
    load(() => collections(actor)),
  ]);
  const canExport = can(s.user.role, "exports.run");
  const from = addMonths(monthStart(today), -1);
  return (
    <div className="grid gap-6">
      <PageHeader title="Reports" description={s.user.role === "agent" ? "For the properties in your portfolio." : "Across the agency, worked out from the ledger as it stands."} />

      <div className="grid gap-6 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Collections: {month.format(new Date(`${col.month}T00:00:00Z`))}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-1 text-sm" data-testid="collections">
            <div className="text-2xl font-semibold tabular-nums">{col.percent === null ? "—" : `${col.percent}%`}</div>
            <div>
              {formatCents(col.receivedCents)} received of {formatCents(col.dueCents)} due this month
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Occupancy</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-1 text-sm" data-testid="occupancy">
            <div className="text-2xl font-semibold tabular-nums">{occ.occupancyPercent}%</div>
            <div>
              {Object.entries(occ.counts)
                .map(([k, v]) => `${v} ${(UNIT_STATUS[k] ?? k).toLowerCase()}`)
                .join(", ") || "No units"}
            </div>
            {occ.vacant.length ? <div className="text-muted-foreground">Vacant: {occ.vacant.join("; ")}</div> : null}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Total overdue</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-1 text-sm">
            <div className="text-2xl font-semibold tabular-nums text-destructive">{formatCents(ageing.total)}</div>
            <div>
              on {ageing.rows.length} lease{ageing.rows.length === 1 ? "" : "s"}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Arrears ageing</CardTitle>
        </CardHeader>
        <CardContent>
          {ageing.rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing overdue.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table data-testid="arrears-ageing">
                <TableHeader>
                  <TableRow>
                    <TableHead>Lease</TableHead>
                    <TableHead>Tenant</TableHead>
                    {AGEING_BUCKETS.map((b) => (
                      <TableHead key={b} className="text-right">
                        {AGEING_LABEL[b]}
                      </TableHead>
                    ))}
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ageing.rows.map((r) => (
                    <TableRow key={r.leaseId}>
                      <TableCell>
                        <Link href={`/leases/${r.leaseId}`} className="font-mono underline">
                          {r.eftReference}
                        </Link>
                        <div className="text-xs text-muted-foreground">
                          {r.unit}
                          {r.status === "ended" || r.status === "terminated" ? " · ended" : ""}
                        </div>
                      </TableCell>
                      <TableCell>{r.tenant}</TableCell>
                      {AGEING_BUCKETS.map((b) => (
                        <TableCell key={b} className="text-right tabular-nums">
                          {r.buckets[b] ? formatCents(r.buckets[b]) : ""}
                        </TableCell>
                      ))}
                      <TableCell className="text-right font-medium tabular-nums">{formatCents(r.total)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell colSpan={2}>Total</TableCell>
                    {AGEING_BUCKETS.map((b) => (
                      <TableCell key={b} className="text-right tabular-nums">
                        {formatCents(ageing.totals[b])}
                      </TableCell>
                    ))}
                    <TableCell className="text-right tabular-nums">{formatCents(ageing.total)}</TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Leases ending in the next 90 days</CardTitle>
        </CardHeader>
        <CardContent>
          {expiring.length === 0 ? (
            <p className="text-sm text-muted-foreground">None.</p>
          ) : (
            <ul className="grid gap-2 text-sm" data-testid="expiring">
              {expiring.map((e) => (
                <li key={e.leaseId}>
                  <span className="inline-block w-24 text-muted-foreground">within {e.within} days</span>
                  <Link href={`/leases/${e.leaseId}`} className="font-mono underline">
                    {e.eftReference}
                  </Link>{" "}
                  {e.tenant}, {e.unit}: ends {e.endDate} ({e.days} days){e.noticeGiven ? " · notice given" : ""}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {canExport ? (
        <Card>
          <CardHeader>
            <CardTitle>Exports for your accounting package</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 text-sm">
            <p className="text-muted-foreground">CSV files that open in Excel and import into most accounting packages. Every download is recorded in the audit log.</p>
            {(
              [
                ["transactions", "All charges and payments"],
                ["receipts", "Receipts issued"],
                ["owner-statements", "Approved owner statements, by lease"],
                ["arrears", "Arrears ageing (as at the 'to' date)"],
              ] as const
            ).map(([kind, label]) => (
              <form key={kind} action={`/reports/export/${kind}`} method="get" className="flex flex-wrap items-end gap-3" data-testid={`export-${kind}`}>
                <div className="w-64 font-medium">{label}</div>
                <div className="grid gap-1">
                  <Label htmlFor={`${kind}-from`}>From</Label>
                  <Input id={`${kind}-from`} name="from" type="date" defaultValue={from} required className="w-40" />
                </div>
                <div className="grid gap-1">
                  <Label htmlFor={`${kind}-to`}>To</Label>
                  <Input id={`${kind}-to`} name="to" type="date" defaultValue={today} required className="w-40" />
                </div>
                <Button type="submit" variant="outline" size="sm">
                  Download CSV
                </Button>
              </form>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
