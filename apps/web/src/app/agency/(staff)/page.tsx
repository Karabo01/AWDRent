import { PageHeader } from "@/components/shell/app-shell";
import { requireStaff } from "@/server/session";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const { user } = await requireStaff();
  return <PageHeader title={`Welcome, ${user.name.split(" ")[0]}`} description="Your agency at a glance." />;
}
