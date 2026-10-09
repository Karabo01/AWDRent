import { can } from "@awdrent/core/permissions";
import { CONDITION_LABEL, getInspection, KIND_LABEL } from "@awdrent/core/inspections";
import { getLease } from "@awdrent/core/leases";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { PageHeader } from "@/components/shell/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { actorOf, load } from "@/server/actor";
import { requireCan } from "@/server/session";
import { AddItemForm, DeleteInspectionButton, FileReportButton, InspectionSheet } from "../inspection-forms";

export const metadata = { title: "Inspection" };

const day = new Intl.DateTimeFormat("en-ZA", { dateStyle: "medium", timeZone: "Africa/Johannesburg" });
const isoDay = (d: string) => day.format(new Date(`${d}T00:00:00Z`));

export default async function InspectionPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ upload?: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const s = await requireCan("inspections.manage");
  const { inspection: insp, items } = await load(() => getInspection(actorOf(s), id));
  const { lease, unitLabel, propertyName } = await load(() => getLease(actorOf(s), insp.leaseId));
  const { upload } = await searchParams;
  const outgoing = insp.kind === "outgoing";
  const done = insp.status === "completed";
  const rooms = [...new Set(items.map((i) => i.room))];
  const label = (c: keyof typeof CONDITION_LABEL | null) => (c ? CONDITION_LABEL[c] : null);
  return (
    <div className="grid gap-6">
      <PageHeader
        title={`${KIND_LABEL[insp.kind]} inspection`}
        description={`${unitLabel}, ${propertyName} · ${lease.eftReference}`}
        actions={<Badge variant={done ? "default" : "secondary"}>{done ? "Completed" : "Draft"}</Badge>}
      />
      <p className="text-sm">
        <Link href={`/leases/${lease.id}#inspections`} className="underline">
          Back to the lease
        </Link>
      </p>

      {done ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Report</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 text-sm">
              <p>
                Inspected on {isoDay(insp.inspectedOn)}, completed on {day.format(insp.completedAt!)}.
                {insp.attendees ? ` Present: ${insp.attendees}.` : ""}
              </p>
              {insp.notes ? <p className="whitespace-pre-wrap">{insp.notes}</p> : null}
              {insp.reportDocumentId ? (
                <p>
                  <Button asChild size="sm">
                    <a href={`/documents/${insp.reportDocumentId}/download`}>Download the report</a>
                  </Button>
                  <span className="ml-3 text-muted-foreground">Filed with the lease documents and emailed to the tenants.</span>
                </p>
              ) : (
                <>
                  <p className="text-destructive">The report could not be built when the inspection was completed.</p>
                  <FileReportButton inspectionId={insp.id} />
                </>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Items</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              {rooms.map((room) => (
                <table key={room} className="w-full text-sm">
                  <caption className="mb-1 text-left font-semibold">{room}</caption>
                  <thead className="text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="w-1/4 font-normal">Item</th>
                      <th className="w-1/6 font-normal">Condition</th>
                      {outgoing ? <th className="w-1/6 font-normal">At move-in</th> : null}
                      <th className="font-normal">Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items
                      .filter((i) => i.room === room)
                      .map((i) => (
                        <tr key={i.id} className="border-t align-top">
                          <td className="py-1">{i.item}</td>
                          <td className={i.worse ? "py-1 font-medium text-destructive" : "py-1"}>{label(i.condition)}</td>
                          {outgoing ? <td className="py-1">{label(i.ingoing?.condition ?? null) ?? ""}</td> : null}
                          <td className="py-1">
                            {i.notes}
                            {i.photos
                              .filter((p) => p.status === "clean")
                              .map((p) => (
                                <a key={p.id} href={`/documents/${p.id}/download`} className="ml-2 text-xs underline">
                                  {p.filename}
                                </a>
                              ))}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              ))}
            </CardContent>
          </Card>
        </>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Rooms and items</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="mb-4 text-sm text-muted-foreground">
                Rate every item (N/A where it does not apply) and note any marks, damage or missing parts.
                {outgoing ? " Each item shows its condition at move-in; anything worse is shown in red on the report." : ""} Saving keeps a draft;
                completing freezes the inspection, files the report with the lease and emails it to the tenants.
              </p>
              <InspectionSheet
                inspectionId={insp.id}
                outgoing={outgoing}
                details={{ inspectedOn: insp.inspectedOn, attendees: insp.attendees, notes: insp.notes }}
                items={items.map((i) => ({
                  id: i.id,
                  room: i.room,
                  item: i.item,
                  condition: i.condition,
                  notes: i.notes,
                  ingoing: label(i.ingoing?.condition ?? null),
                  ingoingNotes: i.ingoing?.notes ?? null,
                  worse: i.worse,
                  photos: i.photos.map((p) => ({ id: p.id, filename: p.filename, clean: p.status === "clean" })),
                }))}
              />
            </CardContent>
          </Card>
          {can(s.user.role, "documents.upload") ? (
            <Card id="documents">
              <CardHeader>
                <CardTitle>Photos</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3 text-sm">
                <p className="text-muted-foreground">Save your ratings first: uploading reloads the page. JPG and PNG photos are added to the report.</p>
                {upload ? (
                  upload === "ok" ? (
                    <p role="status" className="text-green-700">
                      Uploaded. It will be available once the virus check finishes, usually within a minute.
                    </p>
                  ) : (
                    <p role="alert" className="text-destructive">
                      {upload}
                    </p>
                  )
                ) : null}
                <form action="/documents/upload" method="post" encType="multipart/form-data" className="grid gap-3 sm:grid-cols-[1fr_2fr_auto] sm:items-end">
                  <input type="hidden" name="subjectType" value="inspection_item" />
                  <input type="hidden" name="kind" value="inspection_photo" />
                  <input type="hidden" name="returnTo" value={`/inspections/${insp.id}`} />
                  <label className="grid gap-1.5">
                    Item
                    <select name="subjectId" className="h-9 rounded-md border border-input bg-transparent px-3 text-sm">
                      {items.map((i) => (
                        <option key={i.id} value={i.id}>
                          {i.room}: {i.item}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="grid gap-1.5">
                    Photo (JPG or PNG, up to 10 MB)
                    <input type="file" name="file" accept="image/jpeg,image/png" required className="text-sm" />
                  </label>
                  <Button type="submit" variant="outline">
                    Upload
                  </Button>
                </form>
              </CardContent>
            </Card>
          ) : null}
          <Card>
            <CardHeader>
              <CardTitle>Add an item</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-6">
              <AddItemForm inspectionId={insp.id} rooms={rooms} />
              <DeleteInspectionButton inspectionId={insp.id} leaseId={lease.id} />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
