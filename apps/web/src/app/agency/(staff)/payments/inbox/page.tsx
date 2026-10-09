import { todayInSouthAfrica } from "@awdrent/core/billing";
import { inboxAddressFor, listInbox } from "@awdrent/core/inbox";
import { formatCents } from "@awdrent/core/money";
import Link from "next/link";
import { PageHeader } from "@/components/shell/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { actorOf, load } from "@/server/actor";
import { requireCan } from "@/server/session";
import { ConvertEmailForm, DismissEmailForm } from "./inbox-forms";

export const metadata = { title: "Emailed proofs of payment" };

const when = new Intl.DateTimeFormat("en-ZA", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Johannesburg" });
const FILTERS = [
  { value: "new", label: "To do" },
  { value: "converted", label: "Made into POPs" },
  { value: "dismissed", label: "Dismissed" },
] as const;

/** Emails the POP inbox could not place by itself (D88): accounts choose the lease and amount, or dismiss. */
export default async function PopInboxPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const s = await requireCan("payments.approve");
  const wanted = (await searchParams).status;
  const status = FILTERS.find((f) => f.value === wanted)?.value ?? "new";
  const items = await load(() => listInbox(actorOf(s), status));
  return (
    <div className="grid gap-6">
      <PageHeader
        title="Emailed proofs of payment"
        description={`Tenants' emails to your pop@ address, forwarded to ${inboxAddressFor(s.agency.subdomain)}. Emails naming one lease and one amount become proofs of payment by themselves; these need you.`}
      />
      <nav aria-label="Filter" className="flex flex-wrap gap-1 text-sm">
        <Link href="/payments" className="rounded-md px-2 py-1 hover:bg-muted">
          Back to the review queue
        </Link>
        {FILTERS.map((f) => (
          <Link
            key={f.value}
            href={f.value === "new" ? "/payments/inbox" : `/payments/inbox?status=${f.value}`}
            className={`rounded-md px-2 py-1 ${status === f.value ? "bg-muted font-medium" : "hover:bg-muted"}`}
          >
            {f.label}
          </Link>
        ))}
      </nav>
      {items.length === 0 ? <p className="text-sm text-muted-foreground">Nothing here.</p> : null}
      {items.map((m) => (
        <Card key={m.id} data-testid="inbox-email">
          <CardHeader>
            <CardTitle className="grid gap-1 text-base">
              <span>{m.subject}</span>
              <span className="text-sm font-normal text-muted-foreground">
                From {m.fromName ? `${m.fromName} <${m.fromAddress}>` : m.fromAddress} · {when.format(m.receivedAt)}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 text-sm">
            {m.excerpt ? <p className="max-h-32 overflow-y-auto whitespace-pre-wrap rounded bg-muted p-2 text-xs">{m.excerpt}</p> : null}
            {m.attachments.length ? (
              <ul className="grid gap-1">
                {m.attachments.map((d) => (
                  <li key={d.id}>
                    {d.status === "clean" ? (
                      <a href={`/documents/${d.id}/download`} className="underline">
                        Open {d.filename}
                      </a>
                    ) : d.status === "pending_scan" ? (
                      <span className="text-muted-foreground">{d.filename}: checking for viruses…</span>
                    ) : (
                      <span className="text-destructive">{d.filename}: the file could not be used</span>
                    )}
                  </li>
                ))}
              </ul>
            ) : status === "new" ? (
              <p className="text-muted-foreground">No PDF or image was attached, so this cannot become a proof of payment. Ask the tenant to send the file.</p>
            ) : null}
            {m.matchReason ? <p className="text-muted-foreground">{m.matchReason}.</p> : null}
            {status === "new" ? (
              <>
                {m.attachments.length ? (
                  <ConvertEmailForm
                    emailId={m.id}
                    eftReference={m.suggestedRef ?? ""}
                    amount={m.suggestedCents ? (m.suggestedCents / 100).toFixed(2) : ""}
                    paidOn={todayInSouthAfrica(m.receivedAt)}
                  />
                ) : null}
                <DismissEmailForm emailId={m.id} />
              </>
            ) : status === "converted" ? (
              <p>
                Made into a proof of payment{m.suggestedCents ? ` (the email said ${formatCents(m.suggestedCents)})` : ""}.{" "}
                <Link href="/payments" className="underline">
                  Review queue
                </Link>
              </p>
            ) : (
              <p className="text-muted-foreground">Dismissed: {m.note}</p>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
