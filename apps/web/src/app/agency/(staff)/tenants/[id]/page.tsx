import { mask } from "@awdrent/core/crypto";
import { can } from "@awdrent/core/permissions";
import { getTenant } from "@awdrent/core/tenants";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { RevealValue } from "@/components/form/reveal";
import { DocumentsPanel } from "@/components/documents/documents-panel";
import { PageHeader } from "@/components/shell/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LEASE_STATUS_LABEL } from "@/lib/labels";
import { actorOf, load } from "@/server/actor";
import { requireCan } from "@/server/session";
import { revealTenantIdAction } from "../actions";
import { TenantForm } from "../tenant-form";

export const metadata = { title: "Tenant" };

const date = new Intl.DateTimeFormat("en-ZA", { dateStyle: "medium", timeZone: "Africa/Johannesburg" });

export default async function TenantPage({
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
  const t = await load(() => getTenant(actorOf(s), id));
  const canEdit = can(s.user.role, "records.edit");

  return (
    <div className="grid gap-6">
      <PageHeader
        title={t.fullName}
        description={[t.phone, t.email].filter(Boolean).join(" · ")}
        actions={
          canEdit ? (
            <Button asChild variant="outline">
              <Link href={`/leases/new?tenantId=${t.id}`}>New lease for this tenant</Link>
            </Button>
          ) : null
        }
      />
      <dl className="-mt-2 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1 text-sm">
        <dt className="text-muted-foreground">{t.idKind === "sa_id" ? "SA ID" : "Passport"}</dt>
        <dd>
          {t.idNumberLast4 && can(s.user.role, "tenant.id.view") ? (
            <RevealValue masked={mask(t.idNumberLast4)} reveal={revealTenantIdAction.bind(null, t.id)} testId="tenant-id" />
          ) : (
            <span className="font-mono">{mask(t.idNumberLast4)}</span>
          )}
        </dd>
        <dt className="text-muted-foreground">Consent</dt>
        <dd>{t.consentAt ? `Recorded ${date.format(t.consentAt)}` : "Not recorded"}</dd>
        <dt className="text-muted-foreground">Messages by</dt>
        <dd>
          {[t.emailOptIn && "email", t.smsOptIn && "SMS", t.whatsappOptIn && "WhatsApp"].filter(Boolean).join(", ") || "none"}
        </dd>
      </dl>

      <Card>
        <CardHeader>
          <CardTitle>Leases</CardTitle>
        </CardHeader>
        <CardContent>
          {t.leases.length === 0 ? (
            <p className="text-sm text-muted-foreground">No leases yet.</p>
          ) : (
            <ul className="grid gap-2">
              {t.leases.map((l) => (
                <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <Link href={`/leases/${l.id}`} className="font-mono font-medium hover:underline">
                    {l.eftReference}
                  </Link>
                  <span>
                    {l.propertyName} · {l.unitLabel}
                  </span>
                  <span className="text-muted-foreground">
                    {l.startDate} → {l.endDate ?? "monthly"}
                  </span>
                  <Badge variant="secondary">{LEASE_STATUS_LABEL[l.status]}</Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <DocumentsPanel session={s} subject={{ type: "tenant", id: t.id }} returnTo={`/tenants/${t.id}`} kinds={["id_document", "payslip", "bank_statement", "proof_of_address", "other"] as const} uploadResult={upload} />

      {canEdit ? (
        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent>
            <TenantForm
              tenantId={t.id}
              values={{
                ...t,
                idNumberMasked: t.idNumberLast4 ? mask(t.idNumberLast4) : null,
                consentAt: t.consentAt ? date.format(t.consentAt) : null,
              }}
            />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
