import { agencyOrigin } from "@awdrent/core/hosts";
import { getAgency } from "@awdrent/core/platform";
import { notFound } from "next/navigation";
import { z } from "zod";
import { PageHeader } from "@/components/shell/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { devEmailLink } from "@/server/dev-email";
import { agencyAdmins } from "@/server/platform-queries";
import { requirePlatformAdmin } from "@/server/session";
import { endSupportAction, reopenSupportAction, resendInviteAction } from "../../actions";
import { AgencySettingsForm, AgencyStatusForm, EnableWriteForm, SupportStartForm } from "./forms";

export const metadata = { title: "Agency" };

const dateTime = new Intl.DateTimeFormat("en-ZA", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Africa/Johannesburg",
});
const month = new Intl.DateTimeFormat("en-ZA", { month: "long", year: "numeric" });

export default async function AgencyPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ created?: string }>;
}) {
  await requirePlatformAdmin();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const details = await getAgency(id);
  if (!details) notFound();
  const { agency, usage, support, log } = details;
  const admins = await agencyAdmins(agency.id);
  const { created } = await searchParams;
  const now = Date.now();

  return (
    <div className="grid gap-6">
      <PageHeader
        title={agency.name}
        description={`${agency.subdomain} · EFT prefix ${agency.eftPrefix}`}
        actions={
          <div className="flex items-center gap-2">
            <Badge variant={agency.status === "active" ? "secondary" : "destructive"}>{agency.status}</Badge>
            <Button asChild variant="outline" size="sm">
              <a href={`${agencyOrigin(agency.subdomain)}/login`} target="_blank" rel="noreferrer">
                Open sign-in page
              </a>
            </Button>
          </div>
        }
      />

      {created ? (
        <p role="status" className="rounded-md bg-green-50 p-3 text-sm text-green-900">
          Agency created. The first admin has been emailed a link to set their password.
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Admins</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableBody>
              {admins.map((a) => {
                const devLink = !a.lastLoginAt ? devEmailLink(a.email) : null;
                return (
                  <TableRow key={a.id}>
                    <TableCell>{a.name}</TableCell>
                    <TableCell>{a.email}</TableCell>
                    <TableCell>{a.lastLoginAt ? `Last sign-in ${dateTime.format(a.lastLoginAt)}` : "Invite pending"}</TableCell>
                    <TableCell className="text-right">
                      {!a.lastLoginAt ? (
                        <div className="flex flex-col items-end gap-1">
                          <form action={resendInviteAction.bind(null, a.id)}>
                            <Button type="submit" variant="outline" size="sm">
                              Resend invite
                            </Button>
                          </form>
                          {devLink ? (
                            <a href={devLink} className="text-xs underline" data-testid="dev-invite-link">
                              Dev only: open invite link
                            </a>
                          ) : null}
                        </div>
                      ) : null}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Plan and settings</CardTitle>
          </CardHeader>
          <CardContent>
            <AgencySettingsForm
              id={agency.id}
              values={{
                name: agency.name,
                plan: agency.plan,
                includedUnits: agency.includedUnits,
                includedSms: agency.includedSms,
                smsSenderName: agency.smsSenderName,
              }}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Status</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            {agency.status === "suspended" ? (
              <p className="text-sm">Suspended: {agency.suspendedReason}</p>
            ) : (
              <p className="text-sm text-muted-foreground">Active. Suspending blocks all staff sign-ins; no data is deleted.</p>
            )}
            <AgencyStatusForm id={agency.id} status={agency.status} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Support access</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-6">
          <SupportStartForm id={agency.id} />
          {support.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Started</TableHead>
                  <TableHead>By</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Access</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {support.map(({ session: s, adminName }) => {
                  const live = !s.endedAt && s.expiresAt.getTime() > now;
                  return (
                    <TableRow key={s.id}>
                      <TableCell className="whitespace-nowrap">{dateTime.format(s.startedAt)}</TableCell>
                      <TableCell>{adminName}</TableCell>
                      <TableCell className="max-w-xs">{s.reason}</TableCell>
                      <TableCell>
                        {s.writeAccess ? <Badge variant="destructive">write</Badge> : <Badge variant="secondary">read-only</Badge>}
                        {live ? null : <span className="ml-2 text-xs text-muted-foreground">ended</span>}
                      </TableCell>
                      <TableCell className="text-right">
                        {live ? (
                          <div className="flex flex-col items-end gap-2">
                            <div className="flex gap-2">
                              <form action={reopenSupportAction.bind(null, s.id)}>
                                <Button type="submit" size="sm">
                                  Open
                                </Button>
                              </form>
                              <form action={endSupportAction.bind(null, s.id)}>
                                <Button type="submit" size="sm" variant="outline">
                                  End now
                                </Button>
                              </form>
                            </div>
                            {!s.writeAccess ? <EnableWriteForm sessionId={s.id} subdomain={agency.subdomain} /> : null}
                          </div>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Usage</CardTitle>
        </CardHeader>
        <CardContent>
          {usage.length === 0 ? (
            <p className="text-sm text-muted-foreground">No usage recorded yet. Counts are updated nightly.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Month</TableHead>
                  <TableHead className="text-right">Active units</TableHead>
                  <TableHead className="text-right">SMS</TableHead>
                  <TableHead className="text-right">Email</TableHead>
                  <TableHead className="text-right">WhatsApp</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {usage.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell>{month.format(new Date(u.month))}</TableCell>
                    <TableCell className="text-right tabular-nums">{u.activeUnits}</TableCell>
                    <TableCell className="text-right tabular-nums">{u.smsSent}</TableCell>
                    <TableCell className="text-right tabular-nums">{u.emailsSent}</TableCell>
                    <TableCell className="text-right tabular-nums">{u.whatsappSent}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Platform log</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableBody>
              {log.map(({ entry, adminName }) => (
                <TableRow key={entry.id}>
                  <TableCell className="whitespace-nowrap">{dateTime.format(entry.createdAt)}</TableCell>
                  <TableCell>{adminName ?? "system"}</TableCell>
                  <TableCell className="font-mono text-xs">{entry.action}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
