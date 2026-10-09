import { formatCents } from "@awdrent/core/money";
import { ownerStatements } from "@awdrent/core/owner-portal";
import { periodLabel } from "@awdrent/core/statements";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireOwner } from "@/server/portal-session";

export const metadata = { title: "Statements" };

export default async function OwnerStatementsPage() {
  const o = await requireOwner("/op/statements");
  const rows = await ownerStatements(o.actor);
  return (
    <div className="grid gap-4">
      <h1 className="text-xl font-semibold">Statements</h1>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Your monthly statements appear here once they are issued.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border bg-background">
          <Table data-testid="owner-statements-list">
            <TableHeader>
              <TableRow>
                <TableHead>Month</TableHead>
                <TableHead className="text-right">Rent collected</TableHead>
                <TableHead className="text-right">Commission</TableHead>
                <TableHead className="text-right">Payable</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ statement: s }) => (
                <TableRow key={s.id}>
                  <TableCell>{periodLabel(s.period)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCents(s.rentCents)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCents(s.commissionCents)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCents(s.payableCents)}</TableCell>
                  <TableCell className="text-right">
                    {s.documentId ? (
                      <a href={`/op/statements/${s.id}`} className="underline">
                        PDF
                      </a>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
