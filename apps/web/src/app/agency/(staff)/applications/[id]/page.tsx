import { mask } from "@awdrent/core/crypto";
import { formatCents } from "@awdrent/core/money";
import { APPLICANT_TYPE_LABEL, getApplication } from "@awdrent/core/onboarding";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { PageHeader } from "@/components/shell/app-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { APPLICATION_STATUS_LABEL } from "@/lib/labels";
import { actorOf, load } from "@/server/actor";
import { requireCan } from "@/server/session";
import { DecisionForms, ReviewFileButtons } from "../application-forms";

export const metadata = { title: "Application" };

const when = new Intl.DateTimeFormat("en-ZA", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Johannesburg" });
const FILE_STATUS: Record<string, string> = { pending: "To review", accepted: "Accepted", rejected: "Rejected" };

export default async function ApplicationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const s = await requireCan("applications.manage");
  const { app, unit, items, canApprove } = await load(() => getApplication(actorOf(s), id));
  const open = app.status === "invited" || app.status === "in_progress" || app.status === "submitted";
  return (
    <div className="grid gap-6">
      <PageHeader
        title={app.fullName}
        description={`${APPLICANT_TYPE_LABEL[app.applicantType]} applicant for ${unit} · ${formatCents(app.proposedRentCents)} a month from ${app.proposedStart}`}
        actions={<Badge variant={app.status === "submitted" ? "default" : "outline"}>{APPLICATION_STATUS_LABEL[app.status]}</Badge>}
      />
      <p className="text-sm">
        <Link href="/applications" className="underline">
          Back to applications
        </Link>
        {app.leaseId ? (
          <>
            {" · "}
            <Link href={`/leases/${app.leaseId}`} className="underline">
              Draft lease
            </Link>
          </>
        ) : null}
      </p>
      {app.purgedAt ? <p className="text-sm text-muted-foreground">The documents and personal details were deleted on {when.format(app.purgedAt)}, after the retention period.</p> : null}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Applicant</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1 text-sm">
              <dt className="text-muted-foreground">Email</dt>
              <dd>{app.email ?? "—"}</dd>
              <dt className="text-muted-foreground">Mobile</dt>
              <dd>{app.phone ?? "—"}</dd>
              <dt className="text-muted-foreground">{app.idKind === "passport" ? "Passport" : "ID number"}</dt>
              <dd className="font-mono">{app.idNumberLast4 ? mask(app.idNumberLast4) : "not given yet"}</dd>
              <dt className="text-muted-foreground">Employer</dt>
              <dd>{app.employer ?? "—"}</dd>
              <dt className="text-muted-foreground">Current address</dt>
              <dd>{app.currentAddress ?? "—"}</dd>
              <dt className="text-muted-foreground">POPIA consent</dt>
              <dd>{app.consentAt ? when.format(app.consentAt) : "not given yet"}</dd>
              <dt className="text-muted-foreground">Link valid until</dt>
              <dd>{when.format(app.expiresAt)}</dd>
              {app.declineReason ? (
                <>
                  <dt className="text-muted-foreground">Declined (internal)</dt>
                  <dd>{app.declineReason}</dd>
                </>
              ) : null}
            </dl>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Decision</CardTitle>
          </CardHeader>
          <CardContent>
            <DecisionForms applicationId={app.id} canApprove={canApprove} open={open} />
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Documents</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="grid gap-4 text-sm" data-testid="application-items">
            {items.map((item) => (
              <li key={item.key} className="grid gap-2 rounded-md border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">
                    {item.label}
                    {item.required ? "" : " (optional)"}
                  </span>
                  <span className={item.accepted ? "text-green-700" : item.missing ? "text-muted-foreground" : ""}>
                    {item.accepted ? "Done" : item.missing ? "Nothing yet" : "To review"}
                  </span>
                </div>
                {item.files.map((f) => (
                  <div key={f.file.id} className="flex flex-wrap items-center justify-between gap-2 border-t pt-2">
                    <span>
                      {f.documentStatus === "clean" ? (
                        <a href={`/documents/${f.file.documentId}/download`} className="underline">
                          {f.filename}
                        </a>
                      ) : f.documentStatus === "pending_scan" ? (
                        <span className="text-muted-foreground">{f.filename}: checking for viruses…</span>
                      ) : (
                        <span className="text-destructive">{f.filename}: the file could not be used</span>
                      )}{" "}
                      · {FILE_STATUS[f.file.status]}
                      {f.file.rejectReason ? ` (${f.file.rejectReason})` : ""}
                    </span>
                    {open && f.file.status === "pending" ? <ReviewFileButtons applicationId={app.id} fileId={f.file.id} canAccept={f.documentStatus === "clean"} /> : null}
                  </div>
                ))}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
