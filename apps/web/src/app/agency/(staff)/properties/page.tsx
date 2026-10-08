import { can } from "@awdrent/core/permissions";
import { listProperties } from "@awdrent/core/properties";
import Link from "next/link";
import { PageHeader } from "@/components/shell/app-shell";
import { SearchBox } from "@/components/shell/search-box";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { actorOf, load } from "@/server/actor";
import { requireCan } from "@/server/session";

export const metadata = { title: "Properties" };

export default async function PropertiesPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const s = await requireCan("records.view");
  const { q } = await searchParams;
  const rows = await load(() => listProperties(actorOf(s), { q }));
  return (
    <>
      <PageHeader
        title="Properties"
        description={s.user.role === "agent" ? "Properties in your portfolio." : undefined}
        actions={
          can(s.user.role, "records.edit") ? (
            <Button asChild>
              <Link href="/properties/new">New property</Link>
            </Button>
          ) : null
        }
      />
      <SearchBox placeholder="Search by name, street or suburb" defaultValue={q} />
      {rows.length === 0 ? (
        <p className="mt-6 text-sm text-muted-foreground">{q ? "No properties match that search." : "No properties yet."}</p>
      ) : (
        <Table className="mt-4">
          <TableHeader>
            <TableRow>
              <TableHead>Property</TableHead>
              <TableHead>Address</TableHead>
              <TableHead>Owner</TableHead>
              <TableHead className="text-right">Units</TableHead>
              <TableHead className="text-right">Vacant</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(({ property: p, ownerName, unitCount, vacantCount }) => (
              <TableRow key={p.id}>
                <TableCell>
                  <Link href={`/properties/${p.id}`} className="font-medium hover:underline">
                    {p.name}
                  </Link>
                </TableCell>
                <TableCell className="text-sm">{[p.addressLine1, p.suburb, p.city].filter(Boolean).join(", ")}</TableCell>
                <TableCell>
                  <Link href={`/owners/${p.ownerId}`} className="hover:underline">
                    {ownerName}
                  </Link>
                </TableCell>
                <TableCell className="text-right tabular-nums">{unitCount}</TableCell>
                <TableCell className="text-right tabular-nums">{vacantCount}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </>
  );
}
