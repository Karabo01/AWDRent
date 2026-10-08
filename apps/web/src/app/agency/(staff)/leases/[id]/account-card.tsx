import { todayInSouthAfrica } from "@awdrent/core/billing";
import { getLedger } from "@awdrent/core/ledger";
import { listReceipts } from "@awdrent/core/receipts";
import { formatCents } from "@awdrent/core/money";
import { can } from "@awdrent/core/permissions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { actorOf, load } from "@/server/actor";
import type { StaffSession } from "@/server/session";
import { AddChargeForm, VoidChargeButton } from "./account-forms";

/** The lease's statement: charges, payments, running balance and arrears. */
export async function AccountCard({ session, leaseId, isDraft }: { session: StaffSession; leaseId: string; isDraft: boolean }) {
  const ledger = await load(() => getLedger(actorOf(session), leaseId));
  const receipts = await load(() => listReceipts(actorOf(session), leaseId));
  const canCharge = can(session.user.role, "ledger.charge") && !isDraft;
  const canVoid = can(session.user.role, "ledger.void");
  return (
    <Card id="account">
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          Account
          {!isDraft ? (
            <a href={`/leases/${leaseId}/statement`} className="text-sm font-normal underline" data-testid="statement-pdf">
              Statement (PDF)
            </a>
          ) : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        <dl className="grid grid-cols-3 gap-4">
          <div>
            <dt className="text-sm text-muted-foreground">Balance</dt>
            <dd className="text-2xl font-semibold tabular-nums" data-testid="lease-balance">
              {formatCents(ledger.balanceCents)}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">Overdue</dt>
            <dd className={`text-2xl font-semibold tabular-nums ${ledger.overdueCents > 0 ? "text-destructive" : ""}`} data-testid="lease-overdue">
              {formatCents(ledger.overdueCents)}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">Credit</dt>
            <dd className="text-2xl font-semibold tabular-nums">{formatCents(ledger.creditCents)}</dd>
          </div>
        </dl>
        {isDraft ? <p className="text-sm text-muted-foreground">Rent is charged once the lease is activated.</p> : null}
        {ledger.lines.length ? (
          <Table data-testid="statement">
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="text-right">Charge</TableHead>
                <TableHead className="text-right">Payment</TableHead>
                <TableHead className="text-right">Balance</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {ledger.lines.map((l) => (
                <TableRow key={l.id} className={l.counts ? "" : "text-muted-foreground"}>
                  <TableCell className="whitespace-nowrap">{l.date}</TableCell>
                  <TableCell>
                    <span className={l.counts ? "" : "line-through"}>{l.description}</span>
                    {l.note ? <span className="ml-2 text-xs">{l.note}</span> : null}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{l.debitCents ? formatCents(l.debitCents) : ""}</TableCell>
                  <TableCell className="text-right tabular-nums">{l.creditCents ? formatCents(l.creditCents) : ""}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCents(l.balanceCents)}</TableCell>
                  <TableCell className="text-right">
                    {canVoid && l.kind === "charge" && l.counts ? <VoidChargeButton leaseId={leaseId} chargeId={l.id} /> : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : null}
        {receipts.length ? (
          <div className="grid gap-1" data-testid="receipts">
            <p className="text-sm font-medium">Receipts</p>
            <ul className="grid gap-1 text-sm">
              {receipts.map((r) => (
                <li key={r.id} className={r.cancelledAt ? "text-muted-foreground" : ""}>
                  <a href={`/documents/${r.documentId}/download`} className="font-mono underline">
                    {r.receiptNumber}
                  </a>{" "}
                  {formatCents(r.amountCents)}
                  {r.cancelledAt ? ` · cancelled: ${r.cancelReason}` : ""}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {canCharge ? (
          <details>
            <summary className="cursor-pointer text-sm font-medium">Add a charge</summary>
            <div className="mt-4">
              <AddChargeForm leaseId={leaseId} today={todayInSouthAfrica()} />
            </div>
          </details>
        ) : null}
      </CardContent>
    </Card>
  );
}
