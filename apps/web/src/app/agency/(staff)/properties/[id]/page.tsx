import { listOwners } from "@awdrent/core/owners";
import { can } from "@awdrent/core/permissions";
import { getProperty, listAgents } from "@awdrent/core/properties";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { DocumentsPanel } from "@/components/documents/documents-panel";
import { PageHeader } from "@/components/shell/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { actorOf, load } from "@/server/actor";
import { requireCan } from "@/server/session";
import { setPropertyArchivedAction } from "../actions";
import { UNIT_STATUS_LABEL as STATUS } from "@/lib/labels";
import { AgentsForm, PropertyForm, UnitForm } from "../property-forms";

export const metadata = { title: "Property" };

export default async function PropertyPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ upload?: string }>;
}) {
  const s = await requireCan("records.view");
  const { id } = await params;
  const { upload } = await searchParams;
  if (!z.uuid().safeParse(id).success) notFound();
  const actor = actorOf(s);
  const { property: p, ownerName, units, agents } = await load(() => getProperty(actor, id));
  const canEdit = can(s.user.role, "records.edit");
  const canAssign = can(s.user.role, "portfolio.assign");
  const owners = canEdit ? await load(() => listOwners(actor)) : [];
  const allAgents = canAssign ? await load(() => listAgents(actor)) : [];

  return (
    <div className="grid gap-6">
      <PageHeader
        title={p.name}
        description={[p.addressLine1, p.suburb, p.city].filter(Boolean).join(", ")}
        actions={p.archivedAt ? <Badge variant="outline">Archived</Badge> : null}
      />
      <p className="-mt-4 text-sm">
        Owner:{" "}
        <Link href={`/owners/${p.ownerId}`} className="underline">
          {ownerName}
        </Link>
        {agents.length ? ` · Agents: ${agents.map((a) => a.name).join(", ")}` : null}
      </p>

      <Card>
        <CardHeader>
          <CardTitle>Units</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          {units.length === 0 ? <p className="text-sm text-muted-foreground">No units yet. A house usually has one unit.</p> : null}
          {canEdit
            ? units.map((u) => (
                <UnitForm
                  key={u.id}
                  propertyId={p.id}
                  unitId={u.id}
                  values={{ label: u.label, bedrooms: u.bedrooms, bathrooms: u.bathrooms, status: u.status, notes: u.notes }}
                />
              ))
            : units.map((u) => (
                <div key={u.id} className="flex justify-between text-sm">
                  <span>{u.label}</span>
                  <span className="text-muted-foreground">
                    {u.bedrooms ?? "?"} bed · {STATUS[u.status]}
                  </span>
                </div>
              ))}
          {canEdit ? (
            <div className="border-t pt-4">
              <UnitForm propertyId={p.id} />
            </div>
          ) : null}
        </CardContent>
      </Card>

      {canAssign ? (
        <Card>
          <CardHeader>
            <CardTitle>Agent portfolio</CardTitle>
          </CardHeader>
          <CardContent>
            <AgentsForm propertyId={p.id} agents={allAgents} assigned={agents.map((a) => a.id)} />
          </CardContent>
        </Card>
      ) : null}

      {canEdit ? (
        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent>
            <PropertyForm propertyId={p.id} owners={owners.map((o) => ({ id: o.id, name: o.name }))} values={p} />
          </CardContent>
        </Card>
      ) : null}

      <DocumentsPanel session={s} subject={{ type: "property", id: p.id }} returnTo={`/properties/${p.id}`} kinds={["title_deed", "inspection_report", "photo", "other"] as const} uploadResult={upload} />

      {canEdit ? (
        <form action={setPropertyArchivedAction.bind(null, p.id, !p.archivedAt)}>
          <Button type="submit" variant="ghost" size="sm">
            {p.archivedAt ? "Restore property" : "Archive property"}
          </Button>
        </form>
      ) : null}
    </div>
  );
}
