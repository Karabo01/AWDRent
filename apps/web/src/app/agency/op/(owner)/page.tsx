import { formatCents } from "@awdrent/core/money";
import { ownerProperties } from "@awdrent/core/owner-portal";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireOwner } from "@/server/portal-session";

export const metadata = { title: "My properties" };

const day = new Intl.DateTimeFormat("en-ZA", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const fmt = (iso: string) => day.format(new Date(`${iso}T00:00:00Z`));

export default async function OwnerHome() {
  const o = await requireOwner("/op");
  const properties = await ownerProperties(o.actor);
  return (
    <div className="grid gap-4">
      <h1 className="text-xl font-semibold">My properties</h1>
      {properties.length === 0 ? <p className="text-sm text-muted-foreground">No properties are listed for you yet.</p> : null}
      {properties.map((p) => (
        <Card key={p.id} data-testid="owner-property">
          <CardHeader>
            <CardTitle className="text-base">
              {p.name}
              <span className="block text-sm font-normal text-muted-foreground">{p.address}</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-3 text-sm">
              {p.units.map((u) => (
                <li key={u.id} className="rounded-md border p-3">
                  <div className="font-medium">{u.label}</div>
                  {u.lease ? (
                    <div className="text-muted-foreground">
                      Let to {u.lease.tenants.join(" and ")} at {formatCents(u.lease.rentCents)} a month, from {fmt(u.lease.startDate)}
                      {u.lease.endDate ? ` to ${fmt(u.lease.endDate)}` : " (month to month)"}
                      {u.lease.status === "notice_given" ? ". Notice given." : "."}
                      {u.lease.overdueCents > 0 ? <span className="block text-destructive">Rent overdue: {formatCents(u.lease.overdueCents)}</span> : null}
                    </div>
                  ) : (
                    <div className="text-muted-foreground">Vacant</div>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
