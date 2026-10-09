import { leaseFormOptions } from "@awdrent/core/leases";
import Link from "next/link";
import { PageHeader } from "@/components/shell/app-shell";
import { actorOf, load } from "@/server/actor";
import { requireCan } from "@/server/session";
import { LogRequestForm } from "../maintenance-forms";

export const metadata = { title: "Log a maintenance request" };

export default async function NewMaintenancePage() {
  const s = await requireCan("maintenance.manage");
  const { units } = await load(() => leaseFormOptions(actorOf(s)));
  return (
    <>
      <PageHeader title="Log a maintenance request" description="For a problem reported by phone or found on an inspection. Tenants can also log requests in the portal." />
      <p className="mb-4 text-sm">
        <Link href="/maintenance" className="underline">
          Back to maintenance
        </Link>
      </p>
      <LogRequestForm units={units.map((u) => ({ value: u.id, label: `${u.label}, ${u.propertyName}` }))} />
    </>
  );
}
