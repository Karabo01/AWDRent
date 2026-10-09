import { leaseTemplate } from "@awdrent/core/signing";
import { LEASE_FIELDS } from "@awdrent/core/signing/standard-lease";
import Link from "next/link";
import { PageHeader } from "@/components/shell/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { actorOf, load } from "@/server/actor";
import { requireCan } from "@/server/session";
import { resetLeaseTemplateAction } from "./actions";
import { TemplateEditor } from "./template-editor";

export const metadata = { title: "Lease template" };

/** The agency's lease agreement, starting from the standard South African lease (D51). */
export default async function LeaseTemplatePage() {
  const s = await requireCan("settings.manage");
  const { sections, custom } = await load(() => leaseTemplate(actorOf(s)));
  return (
    <>
      <PageHeader
        title="Lease template"
        description={custom ? "Your agency's lease agreement." : "The standard South African residential lease that AWDRent provides. Change it to make it your own."}
      />
      <p className="mb-4 text-sm">
        <Link href="/settings" className="underline">
          Back to settings
        </Link>
      </p>
      <div className="grid gap-6 lg:grid-cols-[1fr_18rem]">
        <div className="grid gap-4">
          <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            Have your attorney review the lease before you use it. The standard lease follows the Rental Housing Act and the Consumer
            Protection Act, but it is a starting point, not legal advice. Leases already sent for signing keep the wording they were sent with.
          </p>
          <TemplateEditor initial={sections} />
          {custom ? (
            <form action={resetLeaseTemplateAction}>
              <Button type="submit" variant="ghost">
                Go back to the standard lease
              </Button>
            </form>
          ) : null}
        </div>
        <Card className="h-fit">
          <CardHeader>
            <CardTitle className="text-base">Fields</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-3 text-sm text-muted-foreground">Filled in from the lease when you prepare it:</p>
            <dl className="grid gap-2 text-xs">
              {Object.entries(LEASE_FIELDS).map(([k, v]) => (
                <div key={k}>
                  <dt className="font-mono">{`{${k}}`}</dt>
                  <dd className="text-muted-foreground">{v}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
