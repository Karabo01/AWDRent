import { leaseFormOptions } from "@awdrent/core/leases";
import Link from "next/link";
import { PageHeader } from "@/components/shell/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import { actorOf, load } from "@/server/actor";
import { requireCan } from "@/server/session";
import { NewLeaseForm } from "../lease-forms";

export const metadata = { title: "New lease" };

export default async function NewLeasePage({ searchParams }: { searchParams: Promise<{ unitId?: string; tenantId?: string }> }) {
  const s = await requireCan("records.edit");
  const defaults = await searchParams;
  const { units, tenants } = await load(() => leaseFormOptions(actorOf(s)));
  return (
    <>
      <PageHeader title="New lease" />
      {units.length === 0 || tenants.length === 0 ? (
        <p className="text-sm">
          You need at least one{" "}
          <Link href="/properties" className="underline">
            unit
          </Link>{" "}
          and one{" "}
          <Link href="/tenants/new" className="underline">
            tenant
          </Link>{" "}
          first.
        </p>
      ) : (
        <Card className="max-w-3xl">
          <CardContent className="pt-6">
            <NewLeaseForm units={units} tenants={tenants} defaults={defaults} />
          </CardContent>
        </Card>
      )}
    </>
  );
}
