import { getAgencySettings } from "@awdrent/core/agency-settings";
import { can } from "@awdrent/core/permissions";
import { listEnvelopes, signingStaff } from "@awdrent/core/signing";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { actorOf, load } from "@/server/actor";
import type { StaffSession } from "@/server/session";
import { CancelEnvelopeForm, PrepareForm } from "./signing-forms";
import { finishEnvelopeAction, resendInvitationAction } from "./signing-actions";

const STATUS: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  out_for_signing: { label: "Out for signing", variant: "secondary" },
  completed: { label: "Signed", variant: "default" },
  declined: { label: "Declined", variant: "destructive" },
  cancelled: { label: "Cancelled", variant: "outline" },
};
const SIGNER: Record<string, string> = { waiting: "waiting their turn", invited: "invited", signed: "signed", declined: "declined" };
const when = new Intl.DateTimeFormat("en-ZA", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Johannesburg" });

/** Lease agreement and confirmation letter: prepare, send for signing, follow progress (D47–D49, D54). */
export async function SigningCard({ session, leaseId, leaseStatus }: { session: StaffSession; leaseId: string; leaseStatus: string }) {
  const actor = actorOf(session);
  const envelopes = await load(() => listEnvelopes(actor, leaseId));
  const canPrepare = can(session.user.role, "documents.prepare");
  const staff = canPrepare ? await signingStaff(actor) : [];
  const settings = canPrepare ? await getAgencySettings({ ...session.ctx, readOnly: true }) : null;
  const gaps = settings
    ? [
        !settings.legalName && "registered name",
        !settings.registrationNo && "registration number",
        !settings.ffcNumber && "Fidelity Fund Certificate number",
        !settings.physicalAddress && "office address",
        !settings.trustBankName && "trust account bank",
        !settings.trustAccountNoLast4 && "trust account number",
        !settings.trustBranchCode && "branch code",
      ].filter(Boolean)
    : [];
  const live = ["active", "notice_given"].includes(leaseStatus);
  const open = (kind: string) => envelopes.some((e) => e.kind === kind && e.status === "out_for_signing");
  const defaultAgent = session.user.role === "agent" ? session.user.id : (staff.find((u) => u.role === "agent")?.id ?? session.user.id);
  return (
    <Card id="signing">
      <CardHeader>
        <CardTitle>Lease documents</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-6 text-sm">
        {envelopes.length ? (
          <ul className="grid gap-4" data-testid="envelopes">
            {envelopes.map((e) => {
              const st = STATUS[e.status]!;
              const allSigned = e.signers.every((x) => x.status === "signed");
              return (
                <li key={e.id} className="grid gap-2 rounded-md border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">{e.title}</span>
                    <Badge variant={st.variant}>{st.label}</Badge>
                  </div>
                  <ol className="grid gap-1">
                    {e.signers.map((x) => (
                      <li key={x.id} className="flex flex-wrap items-center gap-2">
                        <span>
                          {x.name} <span className="text-muted-foreground">({x.capacity})</span>: {SIGNER[x.status]}
                          {x.signedAt ? ` ${when.format(x.signedAt)}` : ""}
                          {x.declineReason ? `: ${x.declineReason}` : ""}
                        </span>
                        {canPrepare && e.status === "out_for_signing" && x.status === "invited" ? (
                          <form action={resendInvitationAction.bind(null, leaseId, x.id)}>
                            <button type="submit" className="text-xs underline">
                              Send a new link
                            </button>
                          </form>
                        ) : null}
                      </li>
                    ))}
                  </ol>
                  <div className="flex flex-wrap items-center gap-4">
                    <a href={`/documents/${e.signedDocumentId ?? e.unsignedDocumentId}/download`} className="underline">
                      {e.signedDocumentId ? "Signed copy (PDF)" : "Document sent for signing (PDF)"}
                    </a>
                    <span className="font-mono text-xs text-muted-foreground" title="SHA-256 of the document sent for signing">
                      {e.documentSha256.slice(0, 16)}…
                    </span>
                    {canPrepare && e.status === "out_for_signing" && allSigned ? (
                      <form action={finishEnvelopeAction.bind(null, leaseId, e.id)}>
                        <Button type="submit" size="sm" variant="outline">
                          Finish: build the signed copy
                        </Button>
                      </form>
                    ) : null}
                    {canPrepare && e.status === "out_for_signing" ? <CancelEnvelopeForm leaseId={leaseId} envelopeId={e.id} /> : null}
                  </div>
                  {e.cancelReason ? <p className="text-muted-foreground">Cancelled: {e.cancelReason}</p> : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-muted-foreground">No documents yet.</p>
        )}
        {canPrepare ? (
          <>
            {gaps.length ? (
              <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-900">
                Your documents will show &quot;(not set)&quot; for the agency&apos;s {gaps.join(", ")}. Add them in Settings first.
              </p>
            ) : null}
            <div className="grid gap-6 md:grid-cols-2">
              <div className="grid gap-2">
                <p className="font-medium">Lease agreement</p>
                <p className="text-muted-foreground">
                  From your lease template. Signed by the tenants, then the owner (or the agent under mandate), then the agent.
                </p>
                {open("lease_agreement") ? (
                  <p className="text-muted-foreground">One is out for signing.</p>
                ) : ["draft", "active", "notice_given"].includes(leaseStatus) ? (
                  <PrepareForm leaseId={leaseId} kind="lease_agreement" staff={staff} defaultAgentId={defaultAgent} />
                ) : null}
              </div>
              <div className="grid gap-2">
                <p className="font-medium">Lease confirmation letter</p>
                <p className="text-muted-foreground">Confirms the address, agent, dates and tenants. Signed by the agent, then an admin.</p>
                {open("confirmation_letter") ? (
                  <p className="text-muted-foreground">One is out for signing.</p>
                ) : live ? (
                  <PrepareForm leaseId={leaseId} kind="confirmation_letter" staff={staff} defaultAgentId={defaultAgent} />
                ) : (
                  <p className="text-muted-foreground">Available once the lease is active.</p>
                )}
              </div>
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
