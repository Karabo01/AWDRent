import { ownerMaintenance } from "@awdrent/core/owner-portal";
import { Card, CardContent } from "@/components/ui/card";
import { requireOwner } from "@/server/portal-session";

export const metadata = { title: "Maintenance" };

const day = new Intl.DateTimeFormat("en-ZA", { dateStyle: "medium", timeZone: "Africa/Johannesburg" });

export default async function OwnerMaintenancePage() {
  const o = await requireOwner("/op/maintenance");
  const rows = await ownerMaintenance(o.actor);
  return (
    <div className="grid gap-4">
      <h1 className="text-xl font-semibold">Maintenance</h1>
      <p className="text-sm text-muted-foreground">Repairs reported on your properties. Contractors are paid by you directly, as agreed with your agent.</p>
      {rows.length === 0 ? <p className="text-sm text-muted-foreground">No maintenance requests.</p> : null}
      {rows.map((r) => (
        <Card key={r.id} data-testid="owner-maintenance">
          <CardContent className="grid gap-1 pt-6 text-sm">
            <div className="flex flex-wrap justify-between gap-2">
              <span className="font-medium">{r.title}</span>
              <span className="text-muted-foreground">
                {r.reference} · {r.status}
              </span>
            </div>
            <div className="text-muted-foreground">
              {r.where} · logged {day.format(r.createdAt)}
              {r.contractor ? ` · ${r.contractor}` : ""}
              {r.completedAt ? ` · completed ${day.format(r.completedAt)}` : ""}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
