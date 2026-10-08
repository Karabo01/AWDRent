import { escalatedRent, getLease } from "@awdrent/core/leases";
import { bpsToPercentString, formatCents } from "@awdrent/core/money";
import { can } from "@awdrent/core/permissions";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { PageHeader } from "@/components/shell/app-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LEASE_EVENT_LABEL, LEASE_STATUS_LABEL } from "@/lib/labels";
import { actorOf, load } from "@/server/actor";
import { requireCan } from "@/server/session";
import { AmendLeaseForm, LeaseStepButton, NoticeForm, RenewLeaseForm, TerminateForm } from "../lease-forms";

export const metadata = { title: "Lease" };

const when = new Intl.DateTimeFormat("en-ZA", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Johannesburg" });

/** Cents to the plain "7500.00" form fields expect. */
const toRand = (cents: number) => (cents / 100).toFixed(2);

export default async function LeasePage({ params }: { params: Promise<{ id: string }> }) {
  const s = await requireCan("records.view");
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const { lease: l, unitLabel, propertyId, propertyName, tenants, events } = await load(() => getLease(actorOf(s), id));
  const canEdit = can(s.user.role, "records.edit");
  const live = l.status === "active" || l.status === "notice_given";
  const closed = l.status === "ended" || l.status === "terminated";

  return (
    <div className="grid gap-6">
      <PageHeader
        title={`Lease ${l.eftReference}`}
        description={`${propertyName} · ${unitLabel}`}
        actions={<Badge variant={l.status === "active" ? "default" : "secondary"}>{LEASE_STATUS_LABEL[l.status]}</Badge>}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Terms</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
              <dt className="text-muted-foreground">EFT reference</dt>
              <dd className="font-mono text-base font-semibold" data-testid="eft-reference">
                {l.eftReference}
              </dd>
              <dt className="text-muted-foreground">Unit</dt>
              <dd>
                <Link href={`/properties/${propertyId}`} className="underline">
                  {propertyName}
                </Link>{" "}
                · {unitLabel}
              </dd>
              <dt className="text-muted-foreground">Term</dt>
              <dd>
                {l.startDate} → {l.endDate ?? "month-to-month"}
              </dd>
              <dt className="text-muted-foreground">Rent</dt>
              <dd>
                {formatCents(l.rentCents)} due on day {l.dueDay}
              </dd>
              <dt className="text-muted-foreground">Deposit</dt>
              <dd>{formatCents(l.depositCents)}</dd>
              <dt className="text-muted-foreground">Escalation</dt>
              <dd>{l.escalationBps !== null ? `${bpsToPercentString(l.escalationBps)}% on ${l.escalationDate}` : "None"}</dd>
              <dt className="text-muted-foreground">Notice period</dt>
              <dd>{l.noticeDays} days</dd>
              {l.noticeGivenOn ? (
                <>
                  <dt className="text-muted-foreground">Notice given</dt>
                  <dd>{l.noticeGivenOn}</dd>
                </>
              ) : null}
              {l.terminatedOn ? (
                <>
                  <dt className="text-muted-foreground">Terminated</dt>
                  <dd>
                    {l.terminatedOn}: {l.terminationReason}
                  </dd>
                </>
              ) : null}
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Tenants</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-2 text-sm">
              {tenants.map((t) => (
                <li key={t.id}>
                  <Link href={`/tenants/${t.id}`} className="underline">
                    {t.fullName}
                  </Link>
                  {t.isPrimary ? <span className="ml-2 text-muted-foreground">main tenant</span> : null}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      {canEdit && !closed ? (
        <Card>
          <CardHeader>
            <CardTitle>Next steps</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-6">
            {l.status === "draft" ? (
              <div className="grid gap-2">
                <p className="text-sm text-muted-foreground">Activate once the lease is signed. The unit is then marked occupied.</p>
                <div className="justify-self-start">
                  <LeaseStepButton leaseId={l.id} step="activate" label="Activate lease" />
                </div>
              </div>
            ) : null}
            {live && l.escalationBps !== null ? (
              <div className="grid gap-2">
                <p className="text-sm text-muted-foreground">
                  Apply the {bpsToPercentString(l.escalationBps)}% escalation due {l.escalationDate}: rent becomes{" "}
                  {formatCents(escalatedRent(l.rentCents, l.escalationBps))}.
                </p>
                <div className="justify-self-start">
                  <LeaseStepButton leaseId={l.id} step="escalate" label="Apply escalation" variant="outline" />
                </div>
              </div>
            ) : null}
            {live ? (
              <details>
                <summary className="cursor-pointer text-sm font-medium">Renew</summary>
                <div className="mt-4">
                  <RenewLeaseForm leaseId={l.id} rent={toRand(l.rentCents)} />
                </div>
              </details>
            ) : null}
            {l.status === "active" ? (
              <details>
                <summary className="cursor-pointer text-sm font-medium">Record notice to vacate</summary>
                <div className="mt-4">
                  <NoticeForm leaseId={l.id} />
                </div>
              </details>
            ) : null}
            {live && l.endDate ? (
              <div className="grid gap-2">
                <p className="text-sm text-muted-foreground">When the tenant has moved out on {l.endDate}, close the lease.</p>
                <div className="justify-self-start">
                  <LeaseStepButton leaseId={l.id} step="end" label="Mark lease ended" variant="outline" />
                </div>
              </div>
            ) : null}
            <details>
              <summary className="cursor-pointer text-sm font-medium">Amend terms</summary>
              <div className="mt-4">
                <AmendLeaseForm
                  leaseId={l.id}
                  values={{
                    startDate: l.startDate,
                    endDate: l.endDate,
                    rent: toRand(l.rentCents),
                    dueDay: l.dueDay,
                    deposit: toRand(l.depositCents),
                    escalationPercent: l.escalationBps !== null ? bpsToPercentString(l.escalationBps) : "",
                    escalationDate: l.escalationDate,
                    noticeDays: l.noticeDays,
                    notes: l.notes,
                  }}
                />
              </div>
            </details>
            <details>
              <summary className="cursor-pointer text-sm font-medium text-destructive">Terminate early</summary>
              <div className="mt-4">
                <TerminateForm leaseId={l.id} />
              </div>
            </details>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>History</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="grid gap-3">
            {events.map(({ event: e, userName }) => (
              <li key={e.id} className="text-sm">
                <span className="font-medium">{LEASE_EVENT_LABEL[e.type]}</span>{" "}
                <span className="text-muted-foreground">
                  effective {e.effectiveDate} · {userName ?? "system"} · {when.format(e.createdAt)}
                </span>
                {e.note ? <p className="text-muted-foreground">{e.note}</p> : null}
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}
