import { addMonths, monthStart, todayInSouthAfrica } from "@awdrent/core/billing";
import { leaseFormOptions } from "@awdrent/core/leases";
import Link from "next/link";
import { PageHeader } from "@/components/shell/app-shell";
import { actorOf, load } from "@/server/actor";
import { requireCan } from "@/server/session";
import { InviteForm } from "../application-forms";

export const metadata = { title: "Invite an applicant" };

export default async function NewApplicationPage() {
  const s = await requireCan("applications.manage");
  const { units } = await load(() => leaseFormOptions(actorOf(s)));
  return (
    <>
      <PageHeader title="Invite an applicant" />
      <p className="mb-4 text-sm">
        <Link href="/applications" className="underline">
          Back to applications
        </Link>
      </p>
      <InviteForm units={units.map((u) => ({ value: u.id, label: `${u.label}, ${u.propertyName}${u.status === "vacant" ? "" : ` (${u.status.replace("_", " ")})`}` }))} defaultStart={addMonths(monthStart(todayInSouthAfrica()), 1)} />
    </>
  );
}
