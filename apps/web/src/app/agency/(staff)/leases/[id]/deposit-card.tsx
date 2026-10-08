import { todayInSouthAfrica } from "@awdrent/core/billing";
import { getDeposit } from "@awdrent/core/deposits";
import { formatCents } from "@awdrent/core/money";
import { can } from "@awdrent/core/permissions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { actorOf, load } from "@/server/actor";
import type { StaffSession } from "@/server/session";
import { DepositDeductionForm, DepositMoneyForm, VoidDepositEntryButton } from "./deposit-forms";

const TYPE_LABEL = { received: "Received", interest: "Interest", deduction: "Deduction", refund: "Refund" } as const;

/** Deposit held for the lease, kept apart from rent (spec, D40). */
export async function DepositCard({ session, leaseId }: { session: StaffSession; leaseId: string }) {
  const d = await load(() => getDeposit(actorOf(session), leaseId));
  const canManage = can(session.user.role, "deposits.manage");
  const today = todayInSouthAfrica();
  const closed = d.leaseStatus === "ended" || d.leaseStatus === "terminated";
  const ending = d.leaseStatus === "notice_given" || closed;
  return (
    <Card id="deposit">
      <CardHeader>
        <CardTitle>Deposit</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div>
            <dt className="text-sm text-muted-foreground">Required</dt>
            <dd className="text-xl font-semibold tabular-nums">{formatCents(d.requiredCents)}</dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">Still to receive</dt>
            <dd className={`text-xl font-semibold tabular-nums ${d.outstandingCents > 0 ? "text-destructive" : ""}`}>{formatCents(d.outstandingCents)}</dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">Interest earned</dt>
            <dd className="text-xl font-semibold tabular-nums">{formatCents(d.interestCents)}</dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">Held now</dt>
            <dd className="text-xl font-semibold tabular-nums" data-testid="deposit-held">
              {formatCents(d.heldCents)}
            </dd>
          </div>
        </dl>
        {d.entries.length ? (
          <Table data-testid="deposit-entries">
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Entry</TableHead>
                <TableHead>Reference</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {d.entries.map((e) => (
                <TableRow key={e.id} className={e.voidedAt ? "text-muted-foreground" : ""}>
                  <TableCell className="whitespace-nowrap">{e.entryDate}</TableCell>
                  <TableCell>
                    <span className={e.voidedAt ? "line-through" : ""}>
                      {TYPE_LABEL[e.type]}: {e.description}
                    </span>
                    {e.voidedAt ? <span className="ml-2 text-xs">Voided: {e.voidReason}</span> : null}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{e.reference ?? ""}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {e.type === "deduction" || e.type === "refund" ? "−" : ""}
                    {formatCents(e.amountCents)}
                  </TableCell>
                  <TableCell className="text-right">{canManage && !e.voidedAt ? <VoidDepositEntryButton leaseId={leaseId} entryId={e.id} /> : null}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : null}
        {canManage ? (
          <div className="grid gap-3">
            {!closed ? (
              <details>
                <summary className="cursor-pointer text-sm font-medium">Record deposit received</summary>
                <div className="mt-3">
                  <DepositMoneyForm leaseId={leaseId} kind="received" today={today} amount={d.outstandingCents ? (d.outstandingCents / 100).toFixed(2) : undefined} />
                </div>
              </details>
            ) : null}
            {d.receivedCents > 0 ? (
              <details>
                <summary className="cursor-pointer text-sm font-medium">Record interest</summary>
                <div className="mt-3">
                  <DepositMoneyForm leaseId={leaseId} kind="interest" today={today} />
                </div>
              </details>
            ) : null}
            {ending && d.heldCents > 0 ? (
              <details>
                <summary className="cursor-pointer text-sm font-medium">Record a deduction</summary>
                <div className="mt-3">
                  <DepositDeductionForm leaseId={leaseId} today={today} />
                </div>
              </details>
            ) : null}
            {closed && d.heldCents > 0 ? (
              <details>
                <summary className="cursor-pointer text-sm font-medium">Record refund paid</summary>
                <div className="mt-3">
                  <DepositMoneyForm leaseId={leaseId} kind="refund" today={today} amount={(d.heldCents / 100).toFixed(2)} />
                </div>
              </details>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
