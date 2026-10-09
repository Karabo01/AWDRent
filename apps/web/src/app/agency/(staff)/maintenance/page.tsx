import { listRequests, PRIORITY_LABEL, STATUS_LABEL } from "@awdrent/core/maintenance";
import Link from "next/link";
import { PageHeader } from "@/components/shell/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { actorOf, load } from "@/server/actor";
import { requireCan } from "@/server/session";

export const metadata = { title: "Maintenance" };

const day = new Intl.DateTimeFormat("en-ZA", { dateStyle: "medium", timeZone: "Africa/Johannesburg" });

export default async function MaintenancePage({ searchParams }: { searchParams: Promise<{ all?: string }> }) {
  const s = await requireCan("maintenance.manage");
  const all = (await searchParams).all !== undefined;
  const rows = await load(() => listRequests(actorOf(s), { open: !all }));
  return (
    <>
      <PageHeader
        title="Maintenance"
        description="Requests from tenants and staff. Assign a contractor to email them a job card; tenants are told when the status changes."
        actions={
          <div className="flex gap-2">
            <Button asChild variant="outline">
              <Link href="/maintenance/contractors">Contractors</Link>
            </Button>
            <Button asChild>
              <Link href="/maintenance/new">Log a request</Link>
            </Button>
          </div>
        }
      />
      <nav aria-label="Filter" className="mb-4 flex gap-1 text-sm">
        <Link href="/maintenance" className={`rounded-md px-2 py-1 ${!all ? "bg-muted font-medium" : "hover:bg-muted"}`}>
          Open
        </Link>
        <Link href="/maintenance?all" className={`rounded-md px-2 py-1 ${all ? "bg-muted font-medium" : "hover:bg-muted"}`}>
          All
        </Link>
      </nav>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No requests.</p>
      ) : (
        <Table data-testid="maintenance-list">
          <TableHeader>
            <TableRow>
              <TableHead>Reference</TableHead>
              <TableHead>Request</TableHead>
              <TableHead>Unit</TableHead>
              <TableHead>Priority</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Logged</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(({ request: r, unit, property, contractor, reference }) => (
              <TableRow key={r.id}>
                <TableCell className="font-mono">
                  <Link href={`/maintenance/${r.id}`} className="underline">
                    {reference}
                  </Link>
                </TableCell>
                <TableCell>{r.title}</TableCell>
                <TableCell>
                  {unit}, {property}
                </TableCell>
                <TableCell>
                  <Badge variant={r.priority === "emergency" || r.priority === "urgent" ? "destructive" : "outline"}>{PRIORITY_LABEL[r.priority]}</Badge>
                </TableCell>
                <TableCell>
                  {STATUS_LABEL[r.status]}
                  {contractor ? <div className="text-xs text-muted-foreground">{contractor}</div> : null}
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  {day.format(r.createdAt)}
                  <div className="text-xs text-muted-foreground">{r.reportedVia === "portal" ? "by the tenant" : "by staff"}</div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </>
  );
}
