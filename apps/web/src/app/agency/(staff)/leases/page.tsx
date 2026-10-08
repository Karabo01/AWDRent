import { listLeases } from "@awdrent/core/leases";
import { formatCents } from "@awdrent/core/money";
import { can } from "@awdrent/core/permissions";
import Link from "next/link";
import { PageHeader } from "@/components/shell/app-shell";
import { SearchBox } from "@/components/shell/search-box";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LEASE_STATUS_LABEL } from "@/lib/labels";
import { actorOf, load } from "@/server/actor";
import { requireCan } from "@/server/session";

export const metadata = { title: "Leases" };

const FILTERS = [
  { value: "", label: "All" },
  { value: "active", label: "Active" },
  { value: "notice_given", label: "Notice given" },
  { value: "draft", label: "Drafts" },
  { value: "ended", label: "Ended" },
  { value: "terminated", label: "Terminated" },
];

export default async function LeasesPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string }> }) {
  const s = await requireCan("records.view");
  const { q, status } = await searchParams;
  const rows = await load(() => listLeases(actorOf(s), { q, status }));
  return (
    <>
      <PageHeader
        title="Leases"
        actions={
          can(s.user.role, "records.edit") ? (
            <Button asChild>
              <Link href="/leases/new">New lease</Link>
            </Button>
          ) : null
        }
      />
      <div className="flex flex-wrap items-center gap-4">
        <SearchBox placeholder="Search by EFT reference, tenant or property" defaultValue={q} />
        <nav aria-label="Filter by status" className="flex flex-wrap gap-1 text-sm">
          {FILTERS.map((f) => (
            <Link
              key={f.value}
              href={f.value ? `/leases?status=${f.value}` : "/leases"}
              className={`rounded-md px-2 py-1 ${(status ?? "") === f.value ? "bg-muted font-medium" : "hover:bg-muted"}`}
            >
              {f.label}
            </Link>
          ))}
        </nav>
      </div>
      {rows.length === 0 ? (
        <p className="mt-6 text-sm text-muted-foreground">No leases found.</p>
      ) : (
        <Table className="mt-4">
          <TableHeader>
            <TableRow>
              <TableHead>EFT ref</TableHead>
              <TableHead>Tenant</TableHead>
              <TableHead>Unit</TableHead>
              <TableHead>Term</TableHead>
              <TableHead className="text-right">Rent</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(({ lease: l, unitLabel, propertyName, primaryTenant }) => (
              <TableRow key={l.id}>
                <TableCell>
                  <Link href={`/leases/${l.id}`} className="font-mono font-medium hover:underline">
                    {l.eftReference}
                  </Link>
                </TableCell>
                <TableCell>{primaryTenant ?? "—"}</TableCell>
                <TableCell>
                  {propertyName} · {unitLabel}
                </TableCell>
                <TableCell className="whitespace-nowrap text-sm">
                  {l.startDate} → {l.endDate ?? "monthly"}
                </TableCell>
                <TableCell className="text-right tabular-nums">{formatCents(l.rentCents)}</TableCell>
                <TableCell>
                  <Badge variant={l.status === "active" ? "default" : "secondary"}>{LEASE_STATUS_LABEL[l.status]}</Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </>
  );
}
