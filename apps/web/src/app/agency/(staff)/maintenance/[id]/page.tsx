import { getRequest, listContractors, PRIORITY_LABEL, STATUS_LABEL } from "@awdrent/core/maintenance";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { DocumentsPanel } from "@/components/documents/documents-panel";
import { PageHeader } from "@/components/shell/app-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { actorOf, load } from "@/server/actor";
import { requireCan } from "@/server/session";
import { UpdateRequestForm } from "../maintenance-forms";

export const metadata = { title: "Maintenance request" };

const when = new Intl.DateTimeFormat("en-ZA", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Johannesburg" });

export default async function MaintenanceRequestPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ upload?: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const s = await requireCan("maintenance.manage");
  const { request: r, reference, unitName, address, tenant, updates } = await load(() => getRequest(actorOf(s), id));
  const contractors = await listContractors(actorOf(s), { activeOnly: true });
  return (
    <div className="grid gap-6">
      <PageHeader
        title={r.title}
        description={`${reference} · ${address}`}
        actions={<Badge variant={r.status === "completed" ? "default" : "secondary"}>{STATUS_LABEL[r.status]}</Badge>}
      />
      <p className="text-sm">
        <Link href="/maintenance" className="underline">
          Back to maintenance
        </Link>
        {r.leaseId ? (
          <>
            {" · "}
            <Link href={`/leases/${r.leaseId}`} className="underline">
              Lease
            </Link>
          </>
        ) : null}
      </p>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Request</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm">
            <p className="whitespace-pre-wrap">{r.description}</p>
            <dl className="mt-2 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1">
              <dt className="text-muted-foreground">Unit</dt>
              <dd>{unitName}</dd>
              <dt className="text-muted-foreground">Priority</dt>
              <dd>{PRIORITY_LABEL[r.priority]}</dd>
              <dt className="text-muted-foreground">Tenant</dt>
              <dd>{tenant ? `${tenant.name}${tenant.phone ? ` · ${tenant.phone}` : ""}` : "No current tenant"}</dd>
              <dt className="text-muted-foreground">Logged</dt>
              <dd>
                {when.format(r.createdAt)} {r.reportedVia === "portal" ? "by the tenant in the portal" : "by staff"}
              </dd>
            </dl>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Update</CardTitle>
          </CardHeader>
          <CardContent>
            <UpdateRequestForm
              requestId={r.id}
              status={r.status}
              priority={r.priority}
              contractorId={r.contractorId}
              contractors={contractors.map((c) => ({ value: c.id, label: `${c.name}${c.trade ? ` (${c.trade})` : ""}` }))}
            />
          </CardContent>
        </Card>
      </div>
      <DocumentsPanel session={s} subject={{ type: "maintenance_request", id: r.id }} returnTo={`/maintenance/${r.id}`} kinds={["maintenance_photo", "other"] as const} uploadResult={(await searchParams).upload} />
      <Card>
        <CardHeader>
          <CardTitle>Timeline</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="grid gap-3 text-sm" data-testid="maintenance-timeline">
            {updates.map(({ update: u, by }) => (
              <li key={u.id} className="border-l-2 pl-3">
                <div className="text-xs text-muted-foreground">
                  {when.format(u.createdAt)} · {u.portalUserId ? "Tenant" : (by ?? "System")}
                  {u.visibleToTenant ? "" : " · internal"}
                </div>
                {u.status ? <div className="font-medium">{STATUS_LABEL[u.status]}</div> : null}
                {u.note ? <div className="whitespace-pre-wrap">{u.note}</div> : null}
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}
