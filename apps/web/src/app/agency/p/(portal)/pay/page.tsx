import { formatCents } from "@awdrent/core/money";
import { portalPaymentDetails } from "@awdrent/core/portal";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireTenant } from "@/server/portal-session";

export const metadata = { title: "How to pay" };

/** The agency's trust account and the tenant's own reference (D77). Only after sign-in. */
export default async function PayPage() {
  const t = await requireTenant("/p/pay");
  const d = await portalPaymentDetails(t.actor);
  const complete = d.bank && d.accountNumber;
  return (
    <div className="grid gap-4">
      <h1 className="text-xl font-semibold">How to pay</h1>
      {complete ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Pay by EFT into {t.agency.name}&apos;s trust account</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm" data-testid="pay-details">
              <dt className="text-muted-foreground">Bank</dt>
              <dd>{d.bank}</dd>
              <dt className="text-muted-foreground">Account holder</dt>
              <dd>{d.holder}</dd>
              <dt className="text-muted-foreground">Account number</dt>
              <dd className="font-mono">{d.accountNumber}</dd>
              {d.branchCode ? (
                <>
                  <dt className="text-muted-foreground">Branch code</dt>
                  <dd className="font-mono">{d.branchCode}</dd>
                </>
              ) : null}
            </dl>
          </CardContent>
        </Card>
      ) : (
        <p className="text-sm">Please contact {t.agency.name} for their bank details.</p>
      )}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Always use your reference</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm">
          <p>Your payment is matched to your account by this reference. Without it, it can take longer to show.</p>
          <ul className="grid gap-2">
            {d.leases.map((l) => (
              <li key={l.id} className="flex flex-wrap items-baseline justify-between gap-2 rounded-md border p-3">
                <span>{l.unit}</span>
                <span className="font-mono text-lg font-semibold">{l.eftReference}</span>
                {l.balanceCents > 0 ? <span className="w-full text-muted-foreground">Balance due: {formatCents(l.balanceCents)}</span> : null}
              </li>
            ))}
          </ul>
          <p className="text-muted-foreground">After paying, you can send us the proof of payment from your statement page.</p>
        </CardContent>
      </Card>
    </div>
  );
}
