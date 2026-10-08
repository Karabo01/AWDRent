import { listAudit } from "@awdrent/core/staff";
import Link from "next/link";
import { PageHeader } from "@/components/shell/app-shell";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireCan } from "@/server/session";

export const metadata = { title: "Audit log" };

const PAGE = 50;
const dateTime = new Intl.DateTimeFormat("en-ZA", { dateStyle: "medium", timeStyle: "medium", timeZone: "Africa/Johannesburg" });

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ before?: string }> }) {
  const { ctx } = await requireCan("audit.view");
  const { before } = await searchParams;
  const beforeDate = before && !Number.isNaN(Date.parse(before)) ? new Date(before) : undefined;
  const rows = await listAudit({ ...ctx, readOnly: true }, { limit: PAGE, before: beforeDate });
  const last = rows.at(-1)?.entry.createdAt;
  return (
    <>
      <PageHeader
        title="Audit log"
        description="Every change to records, money, leases and settings, newest first. Entries cannot be edited or deleted."
      />
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>When</TableHead>
            <TableHead>Who</TableHead>
            <TableHead>What</TableHead>
            <TableHead>Details</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map(({ entry, userName, portalName }) => (
            <TableRow key={entry.id} className="align-top">
              <TableCell className="whitespace-nowrap">{dateTime.format(entry.createdAt)}</TableCell>
              <TableCell>{entry.supportSessionId ? "AWDTECH support" : (userName ?? (portalName ? `${portalName} (tenant portal)` : "System"))}</TableCell>
              <TableCell className="font-mono text-xs">{entry.action}</TableCell>
              <TableCell>
                {entry.before || entry.after ? (
                  <details>
                    <summary className="cursor-pointer text-sm text-muted-foreground">Show</summary>
                    <pre className="mt-2 max-w-xl overflow-x-auto rounded bg-muted p-2 text-xs">
                      {JSON.stringify({ before: entry.before, after: entry.after }, null, 2)}
                    </pre>
                  </details>
                ) : null}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {rows.length === PAGE && last ? (
        <Link href={`/audit?before=${encodeURIComponent(last.toISOString())}`} className="mt-4 inline-block text-sm underline">
          Older entries
        </Link>
      ) : null}
    </>
  );
}
