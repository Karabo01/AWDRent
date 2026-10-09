import { formatCents } from "@awdrent/core/money";
import { can } from "@awdrent/core/permissions";
import { listBatches } from "@awdrent/core/payouts";
import { getRun, periodLabel } from "@awdrent/core/statements";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { PageHeader } from "@/components/shell/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { actorOf, load } from "@/server/actor";
import { requireCan } from "@/server/session";
import { batchStatusAction, issueMissingAction } from "../actions";
import { ApproveRunForm, CreateBatchForm, PrepareRunForm } from "../statement-forms";

export const metadata = { title: "Owner statements" };

const when = new Intl.DateTimeFormat("en-ZA", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Johannesburg" });

export default async function StatementRunPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  if (!z.uuid().safeParse(runId).success) notFound();
  const s = await requireCan("statements.manage");
  const { run, statements } = await load(() => getRun(actorOf(s), runId));
  const draft = run.status === "draft";
  const total = (pick: (x: (typeof statements)[number]["statement"]) => number) => statements.reduce((sum, x) => sum + pick(x.statement), 0);
  const unissued = statements.filter((x) => !x.statement.documentId).length;
  const batches = draft ? [] : await load(() => listBatches(actorOf(s), run.id));
  const inBatch = new Set(batches.flatMap((b) => b.items.map((i) => i.statementId)));
  const unpaid = statements.filter((x) => x.statement.payableCents > 0 && !inBatch.has(x.statement.id)).length;
  const canDownload = can(s.user.role, "owner.bank.view");
  return (
    <>
      <PageHeader
        title={`Owner statements: ${periodLabel(run.period)}`}
        description={
          draft
            ? "A draft. Check each owner's figures; prepare it again after importing late bank statements. Approving freezes it and emails each owner."
            : `Approved ${when.format(run.approvedAt!)}. Payments that arrive late or are reversed appear on next month's statements.`
        }
        actions={<Badge variant={draft ? "secondary" : "default"}>{draft ? "Draft" : "Approved"}</Badge>}
      />
      <p className="mb-4 text-sm">
        <Link href="/statements" className="underline">
          All months
        </Link>
      </p>
      {statements.length === 0 ? <p className="text-sm text-muted-foreground">No owner has rent or a shortfall this month.</p> : null}
      {statements.length ? (
        <Table data-testid="owner-statements">
          <TableHeader>
            <TableRow>
              <TableHead>Owner</TableHead>
              <TableHead className="text-right">Brought forward</TableHead>
              <TableHead className="text-right">Rent collected</TableHead>
              <TableHead className="text-right">Commission</TableHead>
              <TableHead className="text-right">VAT</TableHead>
              <TableHead className="text-right">Payable</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {statements.map(({ statement: st, ownerName, ownerEmail, lines }) => (
              <TableRow key={st.id} className="align-top">
                <TableCell>
                  <Link href={`/owners/${st.ownerId}`} className="font-medium underline">
                    {ownerName}
                  </Link>
                  {!ownerEmail ? <div className="text-xs text-destructive">No email address: the statement will not be emailed</div> : null}
                  <details>
                    <summary className="cursor-pointer text-xs text-muted-foreground">{lines.length} lease{lines.length === 1 ? "" : "s"}</summary>
                    <ul className="mt-1 grid gap-1 text-xs">
                      {lines.map((l) => (
                        <li key={l.id}>
                          {l.label}: rent {formatCents(l.rentCents)}, commission {formatCents(l.commissionCents)}
                          {l.vatCents ? `, VAT ${formatCents(l.vatCents)}` : ""}
                          {l.commissionNote ? <span className="text-muted-foreground"> ({l.commissionNote})</span> : null}
                        </li>
                      ))}
                    </ul>
                  </details>
                </TableCell>
                <TableCell className="text-right tabular-nums">{st.openingCents ? formatCents(st.openingCents) : ""}</TableCell>
                <TableCell className="text-right tabular-nums">{formatCents(st.rentCents)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatCents(st.commissionCents)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatCents(st.vatCents)}</TableCell>
                <TableCell className={`text-right font-medium tabular-nums ${st.payableCents < 0 ? "text-destructive" : ""}`}>
                  {formatCents(st.payableCents)}
                  {st.payableCents < 0 ? <div className="text-xs font-normal">carried forward</div> : null}
                </TableCell>
                <TableCell className="text-right">
                  {st.documentId ? (
                    <a href={`/documents/${st.documentId}/download`} className="text-xs underline">
                      PDF
                    </a>
                  ) : (
                    <a href={`/statements/preview/${st.id}`} target="_blank" rel="noopener" className="text-xs underline">
                      Preview
                    </a>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell>Total</TableCell>
              <TableCell className="text-right tabular-nums">{formatCents(total((x) => x.openingCents))}</TableCell>
              <TableCell className="text-right tabular-nums">{formatCents(total((x) => x.rentCents))}</TableCell>
              <TableCell className="text-right tabular-nums">{formatCents(total((x) => x.commissionCents))}</TableCell>
              <TableCell className="text-right tabular-nums">{formatCents(total((x) => x.vatCents))}</TableCell>
              <TableCell className="text-right tabular-nums">{formatCents(total((x) => Math.max(x.payableCents, 0)))}</TableCell>
              <TableCell />
            </TableRow>
          </TableFooter>
        </Table>
      ) : null}
      <div className="mt-6 flex flex-wrap items-start gap-6">
        {draft ? (
          <>
            <ApproveRunForm runId={run.id} owners={statements.length} />
            <PrepareRunForm defaultMonth={run.period.slice(0, 7)} maxMonth={run.period.slice(0, 7)} label="Prepare again" />
          </>
        ) : unissued > 0 ? (
          <form action={issueMissingAction.bind(null, run.id)}>
            <Button type="submit" variant="outline">
              Send the {unissued} statement{unissued === 1 ? "" : "s"} not sent yet
            </Button>
          </form>
        ) : null}
      </div>
      {!draft ? (
        <section className="mt-10 grid gap-4" data-testid="payouts">
          <h2 className="text-lg font-semibold">Payouts</h2>
          <p className="text-sm text-muted-foreground">
            A batch pays every owner owed money this month who is not in a batch yet. Download it as a CSV for your bank&apos;s bulk-payment
            import (admins only: it holds full account numbers), then mark it paid once the bank has processed it.
          </p>
          {unpaid > 0 ? <CreateBatchForm runId={run.id} /> : <p className="text-sm">Every owner owed money is in a batch.</p>}
          {batches.map((b) => (
            <div key={b.id} className="grid gap-2 rounded-md border p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">
                  {b.items.length} owner{b.items.length === 1 ? "" : "s"} · {formatCents(b.totalCents)} · made {when.format(b.createdAt)}
                </span>
                <Badge variant={b.status === "paid" ? "default" : "secondary"}>{b.status === "paid" ? `Paid ${when.format(b.paidAt!)}` : "Not paid yet"}</Badge>
              </div>
              <ul className="grid gap-1">
                {b.items.map((i) => (
                  <li key={i.id}>
                    {i.ownerName}: {formatCents(i.amountCents)} to {i.bankName} ••••{i.accountNoLast4}
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap items-center gap-4">
                {canDownload ? (
                  <a href={`/statements/payouts/${b.id}/csv`} className="underline" data-testid="payout-csv">
                    Download CSV for the bank
                  </a>
                ) : (
                  <span className="text-muted-foreground">An admin downloads the CSV.</span>
                )}
                {b.status !== "paid" ? (
                  <>
                    <form action={batchStatusAction.bind(null, run.id, b.id, "paid")}>
                      <Button type="submit" size="sm" variant="outline">
                        Mark as paid
                      </Button>
                    </form>
                    <form action={batchStatusAction.bind(null, run.id, b.id, "cancel")}>
                      <button type="submit" className="text-xs text-muted-foreground underline">
                        Cancel batch
                      </button>
                    </form>
                  </>
                ) : null}
              </div>
            </div>
          ))}
        </section>
      ) : null}
    </>
  );
}
