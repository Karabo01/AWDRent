import { formatCents } from "@awdrent/core/money";
import { lastEndedMonth, listRuns, periodLabel } from "@awdrent/core/statements";
import Link from "next/link";
import { PageHeader } from "@/components/shell/app-shell";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { actorOf, load } from "@/server/actor";
import { requireCan } from "@/server/session";
import { PrepareRunForm } from "./statement-forms";

export const metadata = { title: "Owner statements" };

/** Monthly owner statements (spec 5; D91–D96). */
export default async function StatementsPage() {
  const s = await requireCan("statements.manage");
  const runs = await load(() => listRuns(actorOf(s)));
  const last = lastEndedMonth().slice(0, 7);
  return (
    <>
      <PageHeader
        title="Owner statements"
        description="Each month's statements pay owners the rent that reached the trust account, less the agency's commission. Prepare them after the month ends, check them, then approve to email them."
      />
      <div className="mb-6">
        <PrepareRunForm defaultMonth={last} maxMonth={last} />
      </div>
      {runs.length === 0 ? (
        <p className="text-sm text-muted-foreground">No statements yet.</p>
      ) : (
        <Table data-testid="statement-runs">
          <TableHeader>
            <TableRow>
              <TableHead>Month</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Owners</TableHead>
              <TableHead className="text-right">Payable</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {runs.map(({ run, owners, payable, unissued }) => (
              <TableRow key={run.id}>
                <TableCell>
                  <Link href={`/statements/${run.id}`} className="font-medium underline">
                    {periodLabel(run.period)}
                  </Link>
                </TableCell>
                <TableCell>
                  <Badge variant={run.status === "approved" ? "default" : "secondary"}>{run.status === "approved" ? "Approved" : "Draft"}</Badge>
                  {run.status === "approved" && unissued > 0 ? <span className="ml-2 text-xs text-destructive">{unissued} not sent</span> : null}
                </TableCell>
                <TableCell className="text-right tabular-nums">{owners}</TableCell>
                <TableCell className="text-right tabular-nums">{formatCents(Number(payable))}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </>
  );
}
