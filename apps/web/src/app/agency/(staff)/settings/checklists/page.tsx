import { APPLICANT_TYPE_LABEL, listChecklists } from "@awdrent/core/onboarding";
import Link from "next/link";
import { PageHeader } from "@/components/shell/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { actorOf, load } from "@/server/actor";
import { requireCan } from "@/server/session";
import { resetChecklistAction } from "./actions";
import { ChecklistEditor } from "./checklist-editor";

export const metadata = { title: "Application checklists" };

/** The documents each kind of applicant uploads (spec 8; D107). Applications already sent keep their checklist. */
export default async function ChecklistsPage() {
  const s = await requireCan("settings.manage");
  const lists = await load(() => listChecklists(actorOf(s)));
  return (
    <>
      <PageHeader title="Application checklists" description="What applicants are asked to upload. Applications already sent keep the checklist they were sent with." />
      <p className="mb-4 text-sm">
        <Link href="/settings" className="underline">
          Back to settings
        </Link>
      </p>
      <div className="grid max-w-3xl gap-6">
        {lists.map((l) => (
          <Card key={l.type}>
            <CardHeader>
              <CardTitle>{APPLICANT_TYPE_LABEL[l.type]} applicants</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3">
              <ChecklistEditor type={l.type} initial={l.items} />
              {l.custom ? (
                <form action={resetChecklistAction.bind(null, l.type)}>
                  <Button type="submit" variant="ghost" size="sm">
                    Use the standard checklist
                  </Button>
                </form>
              ) : null}
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}
