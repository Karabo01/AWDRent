import { listMessages } from "@awdrent/core/messages";
import { CATALOGUE } from "@awdrent/core/messaging/catalogue";
import Link from "next/link";
import { z } from "zod";
import { PageHeader } from "@/components/shell/app-shell";
import { SearchBox } from "@/components/shell/search-box";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { actorOf, load } from "@/server/actor";
import { requireCan } from "@/server/session";

export const metadata = { title: "Messages" };

const FILTERS = [
  { value: "", label: "All" },
  { value: "queued", label: "Waiting" },
  { value: "sent", label: "Sent" },
  { value: "delivered", label: "Delivered" },
  { value: "failed", label: "Failed" },
  { value: "suppressed", label: "Not sent" },
];

const STATUS: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  queued: { label: "Waiting", variant: "outline" },
  sent: { label: "Sent", variant: "secondary" },
  delivered: { label: "Delivered", variant: "default" },
  read: { label: "Opened", variant: "default" },
  failed: { label: "Failed", variant: "destructive" },
  suppressed: { label: "Not sent", variant: "outline" },
};

const CHANNEL: Record<string, string> = { email: "Email", sms: "SMS", whatsapp: "WhatsApp" };
const dateTime = new Intl.DateTimeFormat("en-ZA", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Johannesburg" });

/** The notification log (spec): what was sent, to whom, on which channel, delivered or failed. */
export default async function MessagesPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; lease?: string }> }) {
  const s = await requireCan("messages.view");
  const { q, status, lease } = await searchParams;
  const leaseId = lease && z.uuid().safeParse(lease).success ? lease : undefined;
  const statusFilter = FILTERS.some((f) => f.value === status) ? status : undefined;
  const rows = await load(() => listMessages(actorOf(s), { q, status: statusFilter || undefined, leaseId }));
  const href = (value: string) => {
    const p = new URLSearchParams();
    if (value) p.set("status", value);
    if (leaseId) p.set("lease", leaseId);
    const qs = p.toString();
    return qs ? `/messages?${qs}` : "/messages";
  };
  return (
    <>
      <PageHeader
        title="Messages"
        description="Every email and SMS sent to tenants, newest first. Messages wait until after your quiet hours, are retried three times, and a failed SMS is sent by email instead."
      />
      <div className="flex flex-wrap items-center gap-4">
        <SearchBox placeholder="Search by name, email, number or message" defaultValue={q} />
        <nav aria-label="Filter by status" className="flex flex-wrap gap-1 text-sm">
          {FILTERS.map((f) => (
            <Link
              key={f.value}
              href={href(f.value)}
              className={`rounded-md px-2 py-1 ${(statusFilter ?? "") === f.value ? "bg-muted font-medium" : "hover:bg-muted"}`}
            >
              {f.label}
            </Link>
          ))}
        </nav>
        {leaseId ? (
          <p className="text-sm">
            For one lease ·{" "}
            <Link href="/messages" className="underline">
              show all
            </Link>
          </p>
        ) : null}
      </div>
      {rows.length === 0 ? (
        <p className="mt-6 text-sm text-muted-foreground">No messages yet.</p>
      ) : (
        <Table className="mt-4" data-testid="messages">
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>To</TableHead>
              <TableHead>Message</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((m) => {
              const st = STATUS[m.status] ?? { label: m.status, variant: "outline" as const };
              return (
                <TableRow key={m.id} className="align-top">
                  <TableCell className="whitespace-nowrap">{dateTime.format(m.createdAt)}</TableCell>
                  <TableCell>
                    <div>{m.recipientName}</div>
                    <div className="text-xs text-muted-foreground">{m.toAddress || "—"}</div>
                  </TableCell>
                  <TableCell className="max-w-md">
                    <div>
                      <span className="font-medium">{CATALOGUE.get(m.templateKey)?.label ?? m.templateKey}</span>{" "}
                      <span className="text-xs text-muted-foreground">
                        {CHANNEL[m.channel]}
                        {m.hasAttachment ? " · with attachment" : ""}
                        {m.fallbackOf ? " · instead of a failed SMS" : ""}
                      </span>
                    </div>
                    <details>
                      <summary className="cursor-pointer text-xs text-muted-foreground">Show text</summary>
                      {m.subject ? <p className="mt-2 text-sm font-medium">{m.subject}</p> : null}
                      <p className="mt-1 whitespace-pre-wrap text-sm">{m.body}</p>
                    </details>
                    {m.leaseId && !leaseId ? (
                      <Link href={`/leases/${m.leaseId}`} className="text-xs underline">
                        Lease
                      </Link>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <Badge variant={st.variant}>{st.label}</Badge>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {m.status === "queued" && m.nextAttemptAt > new Date() ? <div>Sends {dateTime.format(m.nextAttemptAt)}</div> : null}
                      {m.status === "queued" && m.attempts > 0 ? <div>Attempt {m.attempts + 1} of 3</div> : null}
                      {m.sentAt && m.status !== "queued" ? <div>Sent {dateTime.format(m.sentAt)}</div> : null}
                      {m.error ? <div className={m.status === "failed" ? "text-destructive" : ""}>{m.error}</div> : null}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </>
  );
}
