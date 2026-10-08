import { dashboardFigures } from "@awdrent/core/dashboard";
import Link from "next/link";
import { PageHeader } from "@/components/shell/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { actorOf, load } from "@/server/actor";
import { requireStaff } from "@/server/session";

export const metadata = { title: "Dashboard" };

function Figure({ label, value, href, testId }: { label: string; value: number; href?: string; testId?: string }) {
  const body = (
    <>
      <div className="text-3xl font-semibold tabular-nums" data-testid={testId}>
        {value}
      </div>
      <div className="text-sm text-muted-foreground">{label}</div>
    </>
  );
  return href ? (
    <Link href={href} className="rounded-md p-2 hover:bg-muted">
      {body}
    </Link>
  ) : (
    <div className="p-2">{body}</div>
  );
}

export default async function DashboardPage() {
  const s = await requireStaff();
  const f = await load(() => dashboardFigures(actorOf(s)));
  const occupancy = f.units.total ? Math.round(((f.units.occupied + f.units.notice) / f.units.total) * 100) : 0;
  return (
    <div className="grid gap-6">
      <PageHeader
        title={`Welcome, ${s.user.name.split(" ")[0]}`}
        description={s.user.role === "agent" ? "Your portfolio at a glance." : `${s.agency.name} at a glance.`}
      />
      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Units · {occupancy}% let</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Figure label="Occupied" value={f.units.occupied} testId="units-occupied" />
            <Figure label="Notice given" value={f.units.notice} />
            <Figure label="Vacant" value={f.units.vacant} testId="units-vacant" />
            <Figure label="Maintenance" value={f.units.maintenance} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Leases</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Figure label="Live" value={f.leases.live} href="/leases?status=active" testId="leases-live" />
            <Figure label="Ending in 30 days" value={f.leases.ending30} href="/leases?status=active" />
            <Figure label="31–60 days" value={f.leases.ending60} />
            <Figure label="61–90 days" value={f.leases.ending90} />
          </CardContent>
        </Card>
      </div>
      {f.leases.drafts || f.leases.escalationsDue || f.tenantsWithoutConsent ? (
        <Card>
          <CardHeader>
            <CardTitle>Needs attention</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-1 text-sm">
              {f.leases.drafts ? (
                <li>
                  <Link href="/leases?status=draft" className="underline">
                    {f.leases.drafts} draft lease{f.leases.drafts === 1 ? "" : "s"}
                  </Link>{" "}
                  waiting to be activated
                </li>
              ) : null}
              {f.leases.escalationsDue ? <li>{f.leases.escalationsDue} rent escalation(s) due within 60 days</li> : null}
              {f.tenantsWithoutConsent ? (
                <li>
                  {f.tenantsWithoutConsent} tenant(s) on live leases without recorded POPIA consent —{" "}
                  <Link href="/tenants" className="underline">
                    review tenants
                  </Link>
                </li>
              ) : null}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
