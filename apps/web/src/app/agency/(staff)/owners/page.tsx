import { can } from "@awdrent/core/permissions";
import { listOwners } from "@awdrent/core/owners";
import { bpsToPercentString } from "@awdrent/core/money";
import Link from "next/link";
import { PageHeader } from "@/components/shell/app-shell";
import { SearchBox } from "@/components/shell/search-box";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { actorOf, load } from "@/server/actor";
import { requireCan } from "@/server/session";

export const metadata = { title: "Owners" };

const KIND: Record<string, string> = { individual: "Individual", company: "Company", trust: "Trust" };

export default async function OwnersPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const s = await requireCan("records.view");
  const { q } = await searchParams;
  const owners = await load(() => listOwners(actorOf(s), { q }));
  return (
    <>
      <PageHeader
        title="Owners"
        description={s.user.role === "agent" ? "Owners of properties in your portfolio." : "Landlords whose properties you manage."}
        actions={
          can(s.user.role, "records.edit") ? (
            <Button asChild>
              <Link href="/owners/new">New owner</Link>
            </Button>
          ) : null
        }
      />
      <SearchBox placeholder="Search by name or email" defaultValue={q} />
      {owners.length === 0 ? (
        <p className="mt-6 text-sm text-muted-foreground">{q ? "No owners match that search." : "No owners yet."}</p>
      ) : (
        <Table className="mt-4">
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Contact</TableHead>
              <TableHead className="text-right">Properties</TableHead>
              <TableHead className="text-right">Commission</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {owners.map((o) => (
              <TableRow key={o.id}>
                <TableCell>
                  <Link href={`/owners/${o.id}`} className="font-medium hover:underline">
                    {o.name}
                  </Link>
                </TableCell>
                <TableCell>{KIND[o.kind]}</TableCell>
                <TableCell className="text-sm">{[o.email, o.phone].filter(Boolean).join(" · ") || "—"}</TableCell>
                <TableCell className="text-right tabular-nums">{o.propertyCount}</TableCell>
                <TableCell className="text-right tabular-nums">{bpsToPercentString(o.commissionBps)}%</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </>
  );
}
