import { mask } from "@awdrent/core/crypto";
import { bpsToPercentString } from "@awdrent/core/money";
import { getOwner } from "@awdrent/core/owners";
import { can } from "@awdrent/core/permissions";
import { listProperties } from "@awdrent/core/properties";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { RevealValue } from "@/components/form/reveal";
import { DocumentsPanel } from "@/components/documents/documents-panel";
import { PageHeader } from "@/components/shell/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { actorOf, load } from "@/server/actor";
import { requireCan } from "@/server/session";
import { revealOwnerBankAction, setOwnerArchivedAction } from "../actions";
import { OwnerBankForm, OwnerForm, OwnerPortalToggle } from "../owner-forms";

export const metadata = { title: "Owner" };

export default async function OwnerPage({
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
  const owner = await load(() => getOwner(actor, id));
  const properties = await load(() => listProperties(actor, { ownerId: id }));
  const canEdit = can(s.user.role, "records.edit");
  const canBank = can(s.user.role, "owner.bank.view");

  return (
    <div className="grid gap-6">
      <PageHeader
        title={owner.name}
        description={[owner.email, owner.phone].filter(Boolean).join(" · ")}
        actions={
          <div className="flex items-center gap-2">
            {owner.archivedAt ? <Badge variant="outline">Archived</Badge> : null}
            {canEdit ? (
              <Button asChild variant="outline">
                <Link href={`/properties/new?ownerId=${owner.id}`}>Add property</Link>
              </Button>
            ) : null}
          </div>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Properties</CardTitle>
        </CardHeader>
        <CardContent>
          {properties.length === 0 ? (
            <p className="text-sm text-muted-foreground">No properties yet.</p>
          ) : (
            <ul className="grid gap-2">
              {properties.map(({ property, unitCount, vacantCount }) => (
                <li key={property.id} className="flex justify-between gap-4 text-sm">
                  <Link href={`/properties/${property.id}`} className="font-medium hover:underline">
                    {property.name}
                  </Link>
                  <span className="text-muted-foreground">
                    {unitCount} unit{unitCount === 1 ? "" : "s"} · {vacantCount} vacant
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Payout bank details</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1 text-sm">
            <dt className="text-muted-foreground">Bank</dt>
            <dd>{owner.bankName ?? "—"}</dd>
            <dt className="text-muted-foreground">Account holder</dt>
            <dd>{owner.bankAccountHolder ?? "—"}</dd>
            <dt className="text-muted-foreground">Account number</dt>
            <dd>
              {canBank && owner.bankAccountNoLast4 ? (
                <RevealValue masked={mask(owner.bankAccountNoLast4)} reveal={revealOwnerBankAction.bind(null, owner.id)} testId="bank-account" />
              ) : (
                <span className="font-mono">{mask(owner.bankAccountNoLast4)}</span>
              )}
            </dd>
          </dl>
          {can(s.user.role, "owner.bank.edit") ? (
            <details>
              <summary className="cursor-pointer text-sm font-medium">Edit bank details</summary>
              <div className="mt-4">
                <OwnerBankForm
                  ownerId={owner.id}
                  values={{
                    bankName: owner.bankName,
                    bankBranchCode: owner.bankBranchCode,
                    bankAccountHolder: owner.bankAccountHolder,
                    accountMasked: mask(owner.bankAccountNoLast4),
                  }}
                />
              </div>
            </details>
          ) : (
            <p className="text-xs text-muted-foreground">Only admins can view or change bank details.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent>
          {canEdit ? (
            <OwnerForm
              ownerId={owner.id}
              values={{
                kind: owner.kind,
                name: owner.name,
                idOrRegNoMasked: owner.idOrRegNoLast4 ? mask(owner.idOrRegNoLast4) : null,
                email: owner.email,
                phone: owner.phone,
                postalAddress: owner.postalAddress,
                commissionModel: owner.commissionModel,
                commissionPercent: owner.commissionModel === "percent" ? bpsToPercentString(owner.commissionBps) : "",
                vatRegistered: owner.vatRegistered,
                vatNumber: owner.vatNumber,
                notes: owner.notes,
              }}
            />
          ) : (
            <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1 text-sm">
              <dt className="text-muted-foreground">ID / registration</dt>
              <dd className="font-mono">{mask(owner.idOrRegNoLast4)}</dd>
              <dt className="text-muted-foreground">Commission</dt>
              <dd>{owner.commissionModel === "percent" ? `${bpsToPercentString(owner.commissionBps)}% of rent collected` : "First month's rent of each new lease"}</dd>
              <dt className="text-muted-foreground">VAT</dt>
              <dd>{owner.vatRegistered ? `Registered (${owner.vatNumber})` : "Not registered"}</dd>
            </dl>
          )}
        </CardContent>
      </Card>

      <Card id="owner-portal">
        <CardHeader>
          <CardTitle>Owner portal</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm">
          <p className="text-muted-foreground" data-testid="owner-portal-status">
            {owner.portalEnabled
              ? `On. ${owner.name} signs in at your site's /op page with a code sent to ${owner.email ?? owner.phone}, and can see their properties, statements and maintenance.`
              : "Off. Switch it on to let the owner see their properties, statements and maintenance online; they sign in with a code, no password."}
          </p>
          {canEdit ? <OwnerPortalToggle ownerId={owner.id} enabled={owner.portalEnabled} /> : null}
        </CardContent>
      </Card>

      <DocumentsPanel session={s} subject={{ type: "owner", id: owner.id }} returnTo={`/owners/${owner.id}`} kinds={["id_document", "proof_of_address", "bank_statement", "other"] as const} uploadResult={upload} />

      {canEdit ? (
        <form action={setOwnerArchivedAction.bind(null, owner.id, !owner.archivedAt)}>
          <Button type="submit" variant="ghost" size="sm">
            {owner.archivedAt ? "Restore owner" : "Archive owner"}
          </Button>
        </form>
      ) : null}
    </div>
  );
}
