import { listContractors } from "@awdrent/core/maintenance";
import Link from "next/link";
import { PageHeader } from "@/components/shell/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { actorOf, load } from "@/server/actor";
import { requireCan } from "@/server/session";
import { ContractorForm } from "../maintenance-forms";

export const metadata = { title: "Contractors" };

export default async function ContractorsPage() {
  const s = await requireCan("maintenance.manage");
  const contractors = await load(() => listContractors(actorOf(s)));
  return (
    <div className="grid gap-6">
      <PageHeader title="Contractors" description="The contractors your agents can assign to maintenance requests. Owners pay them directly." />
      <p className="text-sm">
        <Link href="/maintenance" className="underline">
          Back to maintenance
        </Link>
      </p>
      <Card>
        <CardHeader>
          <CardTitle>Add a contractor</CardTitle>
        </CardHeader>
        <CardContent>
          <ContractorForm contractorId={null} />
        </CardContent>
      </Card>
      {contractors.map((c) => (
        <details key={c.id} className="rounded-md border p-3" data-testid="contractor">
          <summary className="cursor-pointer text-sm">
            <span className="font-medium">{c.name}</span>
            {c.trade ? ` · ${c.trade}` : ""}
            {c.email ? ` · ${c.email}` : " · no email"}
            {c.active ? "" : " · inactive"}
          </summary>
          <div className="mt-3">
            <ContractorForm contractorId={c.id} values={c} />
          </div>
        </details>
      ))}
    </div>
  );
}
