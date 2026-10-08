import { PageHeader } from "@/components/shell/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import { requireCan } from "@/server/session";
import { TenantForm } from "../tenant-form";

export const metadata = { title: "New tenant" };

export default async function NewTenantPage() {
  await requireCan("records.edit");
  return (
    <>
      <PageHeader title="New tenant" description="Collect only what the lease needs. ID numbers are stored encrypted." />
      <Card className="max-w-3xl">
        <CardContent className="pt-6">
          <TenantForm />
        </CardContent>
      </Card>
    </>
  );
}
