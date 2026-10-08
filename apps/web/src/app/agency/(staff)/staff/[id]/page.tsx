import { getStaff } from "@awdrent/core/staff";
import { notFound } from "next/navigation";
import { z } from "zod";
import { PageHeader } from "@/components/shell/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import { requireCan } from "@/server/session";
import { EditStaffForm } from "../staff-forms";

export const metadata = { title: "Edit staff member" };

export default async function EditStaffPage({ params }: { params: Promise<{ id: string }> }) {
  const { ctx } = await requireCan("staff.manage");
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  // RLS returns nothing for another agency's user, so this 404s
  const user = await getStaff({ ...ctx, readOnly: true }, id);
  if (!user) notFound();
  return (
    <>
      <PageHeader title={user.name} description={user.email} />
      <Card className="max-w-xl">
        <CardContent className="pt-6">
          <EditStaffForm userId={user.id} values={{ name: user.name, role: user.role, phone: user.phone, active: user.active }} />
        </CardContent>
      </Card>
    </>
  );
}
