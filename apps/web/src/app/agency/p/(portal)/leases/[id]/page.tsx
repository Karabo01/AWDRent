import { todayInSouthAfrica } from "@awdrent/core/billing";
import { formatCents } from "@awdrent/core/money";
import { portalLedger, portalPops, portalReceipts, portalSignedDocuments } from "@awdrent/core/portal";
import { NotFoundError } from "@awdrent/core/portfolio";
import { notFound } from "next/navigation";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireTenant } from "@/server/portal-session";

export const metadata = { title: "Statement" };

const POP_STATUS: Record<string, string> = {
  pending: "Being checked",
  approved: "Confirmed",
  partial: "Confirmed (part)",
  rejected: "Not accepted",
};
const day = new Intl.DateTimeFormat("en-ZA", { dateStyle: "medium", timeZone: "Africa/Johannesburg" });

async function orNotFound<T>(p: Promise<T>): Promise<T> {
  try {
    return await p;
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }
}

export default async function PortalLeasePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ pop?: string }> }) {
  const { id } = await params;
  const { pop } = await searchParams;
  if (!z.uuid().safeParse(id).success) notFound();
  const t = await requireTenant(`/p/leases/${id}`);
  const ledger = await orNotFound(portalLedger(t.actor, id));
  const receipts = await portalReceipts(t.actor, id);
  const pops = await portalPops(t.actor, id);
  const signed = await portalSignedDocuments(t.actor, id);
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-semibold">{ledger.unit}</h1>
        <a href={`/p/leases/${id}/statement`} className="text-sm underline" data-testid="portal-statement-pdf">
          Download statement (PDF)
        </a>
      </div>
      <Card>
        <CardContent className="grid gap-4 pt-6">
          <dl className="grid grid-cols-2 gap-4">
            <div>
              <dt className="text-sm text-muted-foreground">{ledger.balanceCents < 0 ? "In credit" : "Balance"}</dt>
              <dd className="text-2xl font-semibold tabular-nums">{formatCents(Math.abs(ledger.balanceCents))}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">Overdue</dt>
              <dd className={`text-2xl font-semibold tabular-nums ${ledger.overdueCents > 0 ? "text-destructive" : ""}`}>{formatCents(ledger.overdueCents)}</dd>
            </div>
          </dl>
          <div className="overflow-x-auto">
            <Table data-testid="portal-statement">
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Charged</TableHead>
                  <TableHead className="text-right">Paid</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ledger.lines
                  .filter((l) => l.counts || l.note)
                  .slice(-24)
                  .map((l) => (
                    <TableRow key={l.id} className={l.counts ? "" : "text-muted-foreground"}>
                      <TableCell className="whitespace-nowrap">{l.date}</TableCell>
                      <TableCell>
                        <span className={l.counts ? "" : "line-through"}>{l.description}</span>
                        {l.note ? <span className="ml-2 text-xs">{l.note}</span> : null}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{l.debitCents ? formatCents(l.debitCents) : ""}</TableCell>
                      <TableCell className="text-right tabular-nums">{l.creditCents ? formatCents(l.creditCents) : ""}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatCents(l.balanceCents)}</TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </div>
          <p className="text-xs text-muted-foreground">The last 24 entries; the PDF statement has the full history.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Receipts</CardTitle>
        </CardHeader>
        <CardContent>
          {receipts.length === 0 ? (
            <p className="text-sm text-muted-foreground">Receipts appear here once a payment reflects in our account.</p>
          ) : (
            <ul className="grid gap-2 text-sm" data-testid="portal-receipts">
              {receipts.map((r) => (
                <li key={r.id} className={r.cancelledAt ? "text-muted-foreground" : ""}>
                  <a href={`/p/receipts/${encodeURIComponent(r.receiptNumber)}`} className="font-mono underline">
                    {r.receiptNumber}
                  </a>{" "}
                  · {formatCents(r.amountCents)} · {day.format(r.issuedAt)}
                  {r.cancelledAt ? " · cancelled" : ""}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {signed.length ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Signed documents</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-2 text-sm" data-testid="portal-signed-documents">
              {signed.map((d) => (
                <li key={d.id}>
                  <a href={`/p/documents/${d.id}`} className="underline">
                    {d.title}
                  </a>
                  {d.completedAt ? ` · signed ${day.format(d.completedAt)}` : ""}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <Card id="pop">
        <CardHeader>
          <CardTitle className="text-base">Send proof of payment</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          {pop === "ok" ? (
            <p role="status" className="text-sm text-green-700">
              Thank you. We will confirm once the payment reflects in our account.
            </p>
          ) : pop ? (
            <p role="alert" className="text-sm text-destructive">
              {pop}
            </p>
          ) : null}
          <form action={`/p/leases/${id}/pop`} method="post" encType="multipart/form-data" className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="pop-amount">Amount paid (R)</Label>
              <Input id="pop-amount" name="amount" inputMode="decimal" required />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="pop-date">Date paid</Label>
              <Input id="pop-date" name="paidOn" type="date" defaultValue={todayInSouthAfrica()} max={todayInSouthAfrica()} required />
            </div>
            <div className="grid gap-1.5 sm:col-span-2">
              <Label htmlFor="pop-ref">Reference you used (optional)</Label>
              <Input id="pop-ref" name="reference" maxLength={80} />
            </div>
            <div className="grid gap-1.5 sm:col-span-2">
              <Label htmlFor="pop-file">Proof of payment (PDF, JPG or PNG, up to 10 MB)</Label>
              <input id="pop-file" type="file" name="file" accept="application/pdf,image/jpeg,image/png" required className="text-sm" />
            </div>
            <Button type="submit" className="sm:col-span-2">
              Send proof of payment
            </Button>
          </form>
          {pops.length ? (
            <ul className="grid gap-1 text-sm" data-testid="portal-pops">
              {pops.map((p) => (
                <li key={p.id}>
                  {formatCents(p.claimedCents)} paid {p.claimedPaidOn}: {POP_STATUS[p.status] ?? p.status}
                  {p.status === "rejected" && p.rejectReason ? ` (${p.rejectReason})` : ""}
                </li>
              ))}
            </ul>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
