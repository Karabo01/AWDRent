import { APPLICANT_TYPE_LABEL, listApplications } from "@awdrent/core/onboarding";
import Link from "next/link";
import { PageHeader } from "@/components/shell/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { APPLICATION_STATUS_LABEL } from "@/lib/labels";
import { actorOf, load } from "@/server/actor";
import { requireCan } from "@/server/session";

export const metadata = { title: "Applications" };

const day = new Intl.DateTimeFormat("en-ZA", { dateStyle: "medium", timeZone: "Africa/Johannesburg" });

export default async function ApplicationsPage({ searchParams }: { searchParams: Promise<{ all?: string }> }) {
  const s = await requireCan("applications.manage");
  const all = (await searchParams).all !== undefined;
  const rows = await load(() => listApplications(actorOf(s), { open: !all }));
  return (
    <>
      <PageHeader
        title="Applications"
        description="Invite applicants to a unit; they upload their documents through a personal link, you review them, and approving creates the tenant and a draft lease. AWDRent does not run credit checks."
        actions={
          <Button asChild>
            <Link href="/applications/new">Invite an applicant</Link>
          </Button>
        }
      />
      <nav aria-label="Filter" className="mb-4 flex gap-1 text-sm">
        <Link href="/applications" className={`rounded-md px-2 py-1 ${!all ? "bg-muted font-medium" : "hover:bg-muted"}`}>
          Open
        </Link>
        <Link href="/applications?all" className={`rounded-md px-2 py-1 ${all ? "bg-muted font-medium" : "hover:bg-muted"}`}>
          All
        </Link>
      </nav>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No applications.</p>
      ) : (
        <Table data-testid="applications">
          <TableHeader>
            <TableRow>
              <TableHead>Applicant</TableHead>
              <TableHead>Unit</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Invited</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell>
                  <Link href={`/applications/${r.id}`} className="font-medium underline">
                    {r.fullName}
                  </Link>
                  <div className="text-xs text-muted-foreground">{APPLICANT_TYPE_LABEL[r.applicantType]}</div>
                </TableCell>
                <TableCell>{r.unit}</TableCell>
                <TableCell>
                  <Badge variant={r.status === "submitted" ? "default" : "outline"}>{APPLICATION_STATUS_LABEL[r.status]}</Badge>
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  {day.format(r.createdAt)}
                  {r.status === "invited" || r.status === "in_progress" ? <div className="text-xs text-muted-foreground">link until {day.format(r.expiresAt)}</div> : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </>
  );
}
