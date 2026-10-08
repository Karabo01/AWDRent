import { PageHeader } from "@/components/shell/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import { requireCan } from "@/server/session";
import { OwnerForm } from "../owner-forms";

export const metadata = { title: "New owner" };

export default async function NewOwnerPage() {
  await requireCan("records.edit");
  return (
    <>
      <PageHeader title="New owner" description="Bank details for payouts are added by an admin after the owner is created." />
      <Card className="max-w-3xl">
        <CardContent className="pt-6">
          <OwnerForm />
        </CardContent>
      </Card>
    </>
  );
}
