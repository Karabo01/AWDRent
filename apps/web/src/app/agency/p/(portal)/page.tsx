import { dueDateFor, monthStart, todayInSouthAfrica } from "@awdrent/core/billing";
import { formatCents } from "@awdrent/core/money";
import { portalLeases } from "@awdrent/core/portal";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireTenant } from "@/server/portal-session";

export const metadata = { title: "My rent" };

const day = new Intl.DateTimeFormat("en-ZA", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const fmt = (iso: string) => day.format(new Date(`${iso}T00:00:00Z`));
const STATUS: Record<string, string> = { active: "Current", notice_given: "Notice given", ended: "Ended", terminated: "Ended early" };

/** Portal home: each lease the tenant is on, with what they owe. */
export default async function PortalHome() {
  const t = await requireTenant("/p");
  const leases = await portalLeases(t.actor);
  const today = todayInSouthAfrica();
  return (
    <div className="grid gap-4">
      <h1 className="text-xl font-semibold">Hi {t.name.split(/\s+/)[0]}</h1>
      {leases.length === 0 ? <p className="text-sm text-muted-foreground">There are no leases on your account.</p> : null}
      {leases.map((l) => {
        const thisMonthDue = dueDateFor(monthStart(today), l.dueDay);
        return (
          <Card key={l.id} data-testid="portal-lease">
            <CardHeader>
              <CardTitle className="flex flex-wrap items-baseline justify-between gap-2 text-base">
                <span>{l.unit}</span>
                <span className="text-sm font-normal text-muted-foreground">{STATUS[l.status] ?? l.status}</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                <div>
                  <dt className="text-sm text-muted-foreground">{l.balanceCents < 0 ? "In credit" : "Balance"}</dt>
                  <dd className="text-2xl font-semibold tabular-nums" data-testid="portal-balance">
                    {formatCents(Math.abs(l.balanceCents))}
                  </dd>
                </div>
                <div>
                  <dt className="text-sm text-muted-foreground">Overdue</dt>
                  <dd className={`text-2xl font-semibold tabular-nums ${l.overdueCents > 0 ? "text-destructive" : ""}`}>{formatCents(l.overdueCents)}</dd>
                </div>
                <div>
                  <dt className="text-sm text-muted-foreground">Payment reference</dt>
                  <dd className="font-mono text-lg font-semibold">{l.eftReference}</dd>
                </div>
              </dl>
              {l.status === "active" || l.status === "notice_given" ? (
                <p className="text-sm text-muted-foreground">
                  Rent of {formatCents(l.rentCents)} is due on day {l.dueDay} of each month
                  {thisMonthDue >= today ? ` (next: ${fmt(thisMonthDue)})` : ""}
                  {l.endDate ? `. The lease ends on ${fmt(l.endDate)}.` : "."}
                </p>
              ) : null}
              <div className="flex flex-wrap gap-3 text-sm">
                <Link href={`/p/leases/${l.id}`} className="underline">
                  Statement and receipts
                </Link>
                <Link href={`/p/leases/${l.id}#pop`} className="underline">
                  Send proof of payment
                </Link>
                <Link href="/p/pay" className="underline">
                  How to pay
                </Link>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
