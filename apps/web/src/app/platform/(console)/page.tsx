import { listAgencies } from "@awdrent/core/platform";
import Link from "next/link";
import { PageHeader } from "@/components/shell/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requirePlatformAdmin } from "@/server/session";

export const metadata = { title: "Agencies" };

export default async function AgenciesPage() {
  await requirePlatformAdmin();
  const rows = await listAgencies();
  return (
    <>
      <PageHeader
        title="Agencies"
        description="Usage shown is for the current month."
        actions={
          <Button asChild>
            <Link href="/agencies/new">New agency</Link>
          </Button>
        }
      />
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No agencies yet.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Agency</TableHead>
              <TableHead>Address</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Plan</TableHead>
              <TableHead className="text-right">Active units</TableHead>
              <TableHead className="text-right">SMS sent</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(({ agency, usage }) => (
              <TableRow key={agency.id}>
                <TableCell>
                  <Link href={`/agencies/${agency.id}`} className="font-medium hover:underline">
                    {agency.name}
                  </Link>
                </TableCell>
                <TableCell className="font-mono text-xs">{agency.subdomain}</TableCell>
                <TableCell>
                  <Badge variant={agency.status === "active" ? "secondary" : "destructive"}>{agency.status}</Badge>
                </TableCell>
                <TableCell>{agency.plan}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {usage?.activeUnits ?? 0} / {agency.includedUnits}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {usage?.smsSent ?? 0} / {agency.includedSms}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </>
  );
}
