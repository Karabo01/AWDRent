import { listOwners } from "@awdrent/core/owners";
import Link from "next/link";
import { PageHeader } from "@/components/shell/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import { actorOf, load } from "@/server/actor";
import { requireCan } from "@/server/session";
import { PropertyForm } from "../property-forms";

export const metadata = { title: "New property" };

export default async function NewPropertyPage({ searchParams }: { searchParams: Promise<{ ownerId?: string }> }) {
  const s = await requireCan("records.edit");
  const { ownerId } = await searchParams;
  const owners = await load(() => listOwners(actorOf(s)));
  return (
    <>
      <PageHeader title="New property" description="Add units after the property is created." />
      {owners.length === 0 ? (
        <p className="text-sm">
          Create the <Link href="/owners/new" className="underline">owner</Link> first.
        </p>
      ) : (
        <Card className="max-w-3xl">
          <CardContent className="pt-6">
            <PropertyForm owners={owners.map((o) => ({ id: o.id, name: o.name }))} values={{ ownerId: ownerId ?? "" }} />
          </CardContent>
        </Card>
      )}
    </>
  );
}
