import { DOCUMENT_KINDS, listDocuments, type Subject } from "@awdrent/core/documents";
import { can } from "@awdrent/core/permissions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DOCUMENT_KIND_LABEL } from "@/lib/labels";
import { actorOf, load } from "@/server/actor";
import type { StaffSession } from "@/server/session";
import { DeleteDocumentButton } from "./delete-document-button";

const when = new Intl.DateTimeFormat("en-ZA", { dateStyle: "medium", timeZone: "Africa/Johannesburg" });

function size(bytes: number) {
  return bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const STATUS: Record<string, { label: string; variant: "secondary" | "destructive" | "outline" }> = {
  pending_scan: { label: "Checking for viruses…", variant: "outline" },
  infected: { label: "Blocked: virus found", variant: "destructive" },
  scan_failed: { label: "Could not be checked", variant: "destructive" },
};

/**
 * Documents for one record: list, upload (plain multipart form post) and,
 * for admins, delete. Only scanned, clean files get a download link.
 */
export async function DocumentsPanel({
  session,
  subject,
  returnTo,
  kinds,
  uploadResult,
}: {
  session: StaffSession;
  subject: Subject;
  returnTo: string;
  kinds?: readonly (typeof DOCUMENT_KINDS)[number][];
  uploadResult?: string;
}) {
  const docs = await load(() => listDocuments(actorOf(session), subject));
  const canUpload = can(session.user.role, "documents.upload");
  const canDelete = can(session.user.role, "documents.delete");
  const options = kinds ?? DOCUMENT_KINDS;
  return (
    <Card id="documents">
      <CardHeader>
        <CardTitle>Documents</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        {uploadResult ? (
          uploadResult === "ok" ? (
            <p role="status" className="text-sm text-green-700">
              Uploaded. It will be available once the virus check finishes, usually within a minute.
            </p>
          ) : (
            <p role="alert" className="text-sm text-destructive">
              {uploadResult}
            </p>
          )
        ) : null}
        {docs.length === 0 ? (
          <p className="text-sm text-muted-foreground">No documents yet.</p>
        ) : (
          <ul className="grid gap-2" data-testid="documents-list">
            {docs.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="min-w-0">
                  {d.status === "clean" ? (
                    <a href={`/documents/${d.id}/download`} className="font-medium underline">
                      {d.filename}
                    </a>
                  ) : (
                    <span className="font-medium">{d.filename}</span>
                  )}
                  <span className="ml-2 text-muted-foreground">
                    {DOCUMENT_KIND_LABEL[d.kind]} · {size(d.sizeBytes)} · {d.uploadedBy ?? "AWDTECH support"} · {when.format(d.createdAt)}
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  {STATUS[d.status] ? <Badge variant={STATUS[d.status]!.variant}>{STATUS[d.status]!.label}</Badge> : null}
                  {canDelete ? <DeleteDocumentButton documentId={d.id} filename={d.filename} /> : null}
                </span>
              </li>
            ))}
          </ul>
        )}
        {canUpload ? (
          <form action="/documents/upload" method="post" encType="multipart/form-data" className="grid gap-3 border-t pt-4 sm:grid-cols-[1fr_2fr_auto] sm:items-end">
            <input type="hidden" name="subjectType" value={subject.type} />
            <input type="hidden" name="subjectId" value={subject.id} />
            <input type="hidden" name="returnTo" value={returnTo} />
            <label className="grid gap-1.5 text-sm">
              Type
              <select name="kind" className="h-9 rounded-md border border-input bg-transparent px-3 text-sm">
                {options.map((k) => (
                  <option key={k} value={k}>
                    {DOCUMENT_KIND_LABEL[k]}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1.5 text-sm">
              File (PDF, JPG or PNG, up to 10 MB)
              <input type="file" name="file" accept="application/pdf,image/jpeg,image/png" required className="text-sm" />
            </label>
            <Button type="submit" variant="outline">
              Upload
            </Button>
          </form>
        ) : null}
      </CardContent>
    </Card>
  );
}
