import { todayInSouthAfrica } from "@awdrent/core/billing";
import { formatCents } from "@awdrent/core/money";
import { can } from "@awdrent/core/permissions";
import { listPops } from "@awdrent/core/pops";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { actorOf, load } from "@/server/actor";
import type { StaffSession } from "@/server/session";

const STATUS: Record<string, string> = { pending: "Waiting for bank", approved: "Approved", partial: "Part paid", rejected: "Rejected" };

/** Proofs of payment for one lease, and staff upload on the tenant's behalf. */
export async function PopsCard({ session, leaseId, result }: { session: StaffSession; leaseId: string; result?: string }) {
  const pops = await load(() => listPops(actorOf(session), { leaseId }));
  const canSubmit = can(session.user.role, "pop.submit");
  return (
    <Card id="pops">
      <CardHeader>
        <CardTitle>Proofs of payment</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        {result ? (
          result === "ok" ? (
            <p role="status" className="text-sm text-green-700">
              Sent to accounts for checking against the bank statement.
            </p>
          ) : (
            <p role="alert" className="text-sm text-destructive">
              {result}
            </p>
          )
        ) : null}
        {pops.length ? (
          <ul className="grid gap-2 text-sm" data-testid="lease-pops">
            {pops.map(({ pop, documentStatus, filename }) => (
              <li key={pop.id} className="flex flex-wrap items-center gap-2">
                <Badge variant={pop.status === "rejected" ? "destructive" : "secondary"}>{STATUS[pop.status]}</Badge>
                {formatCents(pop.claimedCents)} paid {pop.claimedPaidOn}
                {documentStatus === "clean" ? (
                  <a href={`/documents/${pop.documentId}/download`} className="underline">
                    {filename}
                  </a>
                ) : (
                  <span className="text-muted-foreground">{filename}</span>
                )}
                {pop.rejectReason ? <span className="text-muted-foreground">· {pop.rejectReason}</span> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">None yet.</p>
        )}
        {canSubmit ? (
          <form action="/pops/upload" method="post" encType="multipart/form-data" className="grid gap-3 border-t pt-4 sm:grid-cols-4 sm:items-end">
            <input type="hidden" name="leaseId" value={leaseId} />
            <label className="grid gap-1.5 text-sm">
              Amount paid (R)
              <Input name="amount" inputMode="decimal" required />
            </label>
            <label className="grid gap-1.5 text-sm">
              Date paid
              <Input name="paidOn" type="date" defaultValue={todayInSouthAfrica()} required />
            </label>
            <label className="grid gap-1.5 text-sm">
              Reference used
              <Input name="reference" />
            </label>
            <label className="grid gap-1.5 text-sm">
              File (PDF, JPG, PNG)
              <input type="file" name="file" accept="application/pdf,image/jpeg,image/png" required className="text-sm" />
            </label>
            <Button type="submit" variant="outline" className="sm:col-start-4">
              Upload proof of payment
            </Button>
          </form>
        ) : null}
      </CardContent>
    </Card>
  );
}
