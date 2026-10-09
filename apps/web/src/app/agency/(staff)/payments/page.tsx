import { formatCents } from "@awdrent/core/money";
import { listInbox } from "@awdrent/core/inbox";
import { candidateLines, listPops } from "@awdrent/core/pops";
import Link from "next/link";
import { PageHeader } from "@/components/shell/app-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { actorOf, load } from "@/server/actor";
import { requireCan } from "@/server/session";
import { ApproveWithLine, RejectPop } from "./pop-forms";

export const metadata = { title: "Proofs of payment" };

const when = new Intl.DateTimeFormat("en-ZA", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Johannesburg" });

/** The POP review queue (D33): each POP is approved by linking it to the bank line that shows the money. */
export default async function PaymentsPage() {
  const s = await requireCan("payments.approve");
  const actor = actorOf(s);
  const pending = await load(() => listPops(actor, { status: "pending" }));
  const candidates = await Promise.all(pending.map((p) => load(() => candidateLines(actor, p.pop.id))));
  const reviewed = (await load(() => listPops(actor))).filter((p) => p.pop.status !== "pending").slice(0, 30);
  const emailed = (await load(() => listInbox(actor))).length;

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Proofs of payment"
        description="A proof of payment never changes a balance by itself. Approve it by choosing the trust-account line that shows the money arrived."
        actions={
          <Link href="/payments/inbox" className="text-sm underline" data-testid="inbox-link">
            Emailed{emailed ? ` (${emailed} to do)` : ""}
          </Link>
        }
      />
      {pending.length === 0 ? <p className="text-sm text-muted-foreground">No proofs of payment waiting.</p> : null}
      {pending.map(({ pop, eftReference, tenantName, documentStatus, filename }, i) => (
        <Card key={pop.id} data-testid="pending-pop">
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2 text-base">
              <Link href={`/leases/${pop.leaseId}#pops`} className="font-mono underline">
                {eftReference}
              </Link>
              <span>{tenantName}</span>
              <span className="text-muted-foreground">
                claims {formatCents(pop.claimedCents)} paid {pop.claimedPaidOn}
                {pop.referenceGiven ? ` · ref ${pop.referenceGiven}` : ""}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <p className="text-sm">
              {documentStatus === "clean" ? (
                <a href={`/documents/${pop.documentId}/download`} className="underline">
                  Open {filename}
                </a>
              ) : documentStatus === "pending_scan" ? (
                <span className="text-muted-foreground">{filename}: checking for viruses…</span>
              ) : (
                <span className="text-destructive">{filename}: the file could not be used</span>
              )}
              <span className="ml-2 text-muted-foreground">
                sent {when.format(pop.createdAt)} via {pop.submittedVia}
              </span>
            </p>
            {candidates[i]!.length ? (
              <div className="grid gap-2">
                <p className="text-sm font-medium">Matching statement lines</p>
                {candidates[i]!.map((c) => (
                  <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2 text-sm">
                    <span>
                      {c.lineDate} · <span className="font-mono">{c.reference}</span> · {formatCents(c.amountCents)}
                      <span className="ml-2 text-xs text-muted-foreground">{c.reasons.join(", ")}</span>
                    </span>
                    <ApproveWithLine
                      popId={pop.id}
                      lineId={c.id}
                      label={c.amountCents >= pop.claimedCents ? "Approve with this line" : `Approve ${formatCents(c.amountCents)} (part)`}
                    />
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No matching line on the imported statements yet. Import the latest statement on{" "}
                <Link href="/banking" className="underline">
                  Banking
                </Link>
                , then come back.
              </p>
            )}
            <div>
              <RejectPop popId={pop.id} />
            </div>
          </CardContent>
        </Card>
      ))}
      {reviewed.length ? (
        <Card>
          <CardHeader>
            <CardTitle>Recently reviewed</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-1 text-sm">
              {reviewed.map(({ pop, eftReference, tenantName }) => (
                <li key={pop.id} className="flex flex-wrap items-center gap-2">
                  <Badge variant={pop.status === "rejected" ? "destructive" : "secondary"}>{pop.status}</Badge>
                  <span className="font-mono">{eftReference}</span> {tenantName} · claimed {formatCents(pop.claimedCents)}
                  {pop.approvedCents !== null ? ` · bank showed ${formatCents(pop.approvedCents)}` : ""}
                  {pop.rejectReason ? ` · ${pop.rejectReason}` : ""}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
