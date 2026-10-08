import { can } from "@awdrent/core/permissions";
import { listTenants } from "@awdrent/core/tenants";
import Link from "next/link";
import { PageHeader } from "@/components/shell/app-shell";
import { SearchBox } from "@/components/shell/search-box";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { actorOf, load } from "@/server/actor";
import { requireCan } from "@/server/session";

export const metadata = { title: "Tenants" };

export default async function TenantsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const s = await requireCan("records.view");
  const { q } = await searchParams;
  const tenants = await load(() => listTenants(actorOf(s), { q }));
  return (
    <>
      <PageHeader
        title="Tenants"
        actions={
          can(s.user.role, "records.edit") ? (
            <Button asChild>
              <Link href="/tenants/new">New tenant</Link>
            </Button>
          ) : null
        }
      />
      <SearchBox placeholder="Search by name, email or phone" defaultValue={q} />
      {tenants.length === 0 ? (
        <p className="mt-6 text-sm text-muted-foreground">{q ? "No tenants match that search." : "No tenants yet."}</p>
      ) : (
        <Table className="mt-4">
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Contact</TableHead>
              <TableHead>Current lease</TableHead>
              <TableHead>Consent</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tenants.map((t) => (
              <TableRow key={t.id}>
                <TableCell>
                  <Link href={`/tenants/${t.id}`} className="font-medium hover:underline">
                    {t.fullName}
                  </Link>
                </TableCell>
                <TableCell className="text-sm">{[t.phone, t.email].filter(Boolean).join(" · ") || "—"}</TableCell>
                <TableCell className="font-mono text-sm">{t.currentLease ?? "—"}</TableCell>
                <TableCell className="text-sm">{t.consentAt ? "Recorded" : <span className="text-amber-700">Missing</span>}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </>
  );
}
