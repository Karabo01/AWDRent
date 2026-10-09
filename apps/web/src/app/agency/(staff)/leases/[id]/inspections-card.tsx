import { todayInSouthAfrica } from "@awdrent/core/billing";
import { KIND_LABEL, listInspections } from "@awdrent/core/inspections";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { actorOf, load } from "@/server/actor";
import type { StaffSession } from "@/server/session";
import { StartInspectionForm } from "../../inspections/inspection-forms";

const day = new Intl.DateTimeFormat("en-ZA", { dateStyle: "medium", timeZone: "Africa/Johannesburg" });

/** Ingoing and outgoing inspections for the lease (D118–D121). */
export async function InspectionsCard({ session, leaseId, canStart }: { session: StaffSession; leaseId: string; canStart: boolean }) {
  const inspections = await load(() => listInspections(actorOf(session), leaseId));
  const missing = (["ingoing", "outgoing"] as const).filter((k) => !inspections.some((i) => i.kind === k));
  return (
    <Card id="inspections">
      <CardHeader>
        <CardTitle>Inspections</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 text-sm">
        {inspections.length ? (
          <ul className="grid gap-2">
            {inspections.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-3">
                <Link href={`/inspections/${i.id}`} className="font-medium underline">
                  {KIND_LABEL[i.kind]} inspection
                </Link>
                <span className="text-muted-foreground">{day.format(new Date(`${i.inspectedOn}T00:00:00Z`))}</span>
                <Badge variant={i.status === "completed" ? "default" : "secondary"}>{i.status === "completed" ? "Completed" : "Draft"}</Badge>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground">
            No inspections yet. Inspect the unit with the tenant before they move in and again when they move out; the report goes to the
            tenant and is kept with the lease.
          </p>
        )}
        {canStart && missing.length ? (
          <StartInspectionForm leaseId={leaseId} kinds={missing.map((k) => ({ value: k, label: KIND_LABEL[k] }))} today={todayInSouthAfrica()} />
        ) : null}
      </CardContent>
    </Card>
  );
}
