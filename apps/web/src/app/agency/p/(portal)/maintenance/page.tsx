import { portalMaintenanceUnits, portalRequests, STATUS_LABEL } from "@awdrent/core/maintenance";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { requireTenant } from "@/server/portal-session";

export const metadata = { title: "Maintenance" };

const when = new Intl.DateTimeFormat("en-ZA", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Johannesburg" });

/** Tenants log repairs and follow them (spec 6). */
export default async function PortalMaintenancePage({ searchParams }: { searchParams: Promise<{ logged?: string; error?: string }> }) {
  const t = await requireTenant("/p/maintenance");
  const { logged, error } = await searchParams;
  const units = await portalMaintenanceUnits(t.actor);
  const requests = await portalRequests(t.actor);
  return (
    <div className="grid gap-4">
      <h1 className="text-xl font-semibold">Maintenance</h1>
      {units.length ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Report a problem</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            {logged ? (
              <p role="status" className="text-sm text-green-700">
                Thank you. Your agent has been told and will be in touch.
              </p>
            ) : error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
            <p className="text-sm text-muted-foreground">For a burst pipe, gas leak or anything dangerous, also phone your agent straight away.</p>
            <form action="/p/maintenance/new" method="post" encType="multipart/form-data" className="grid gap-3">
              {units.length > 1 ? (
                <div className="grid gap-1.5">
                  <Label htmlFor="m-lease">Where</Label>
                  <select id="m-lease" name="leaseId" className="h-9 rounded-md border bg-transparent px-3 text-sm">
                    {units.map((u) => (
                      <option key={u.leaseId} value={u.leaseId}>
                        {u.unitName}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <input type="hidden" name="leaseId" value={units[0]!.leaseId} />
              )}
              <div className="grid gap-1.5">
                <Label htmlFor="m-title">What is wrong</Label>
                <Input id="m-title" name="title" required minLength={3} maxLength={120} placeholder="e.g. Leaking geyser" />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="m-description">Details</Label>
                <Textarea id="m-description" name="description" required minLength={3} maxLength={3000} placeholder="Where it is, when it started, anything that helps" />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="m-photos">Photos (optional, up to 5)</Label>
                <input id="m-photos" type="file" name="photos" accept="image/jpeg,image/png,application/pdf" multiple className="text-sm" />
              </div>
              <Button type="submit" className="justify-self-start">
                Send to my agent
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : (
        <p className="text-sm text-muted-foreground">You can report problems here while your lease is current.</p>
      )}
      {requests.map((r) => (
        <Card key={r.id} data-testid="portal-maintenance">
          <CardHeader>
            <CardTitle className="flex flex-wrap items-baseline justify-between gap-2 text-base">
              <span>{r.title}</span>
              <span className="text-sm font-normal text-muted-foreground">
                {r.reference} · {STATUS_LABEL[r.status]}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="grid gap-2 text-sm">
              {r.updates.map((u) => (
                <li key={u.id}>
                  <span className="text-xs text-muted-foreground">{when.format(u.createdAt)}</span>
                  {u.status ? ` · ${STATUS_LABEL[u.status]}` : ""}
                  {u.note ? <div>{u.note}</div> : null}
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
