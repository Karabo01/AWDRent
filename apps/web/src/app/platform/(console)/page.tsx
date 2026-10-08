import { PageHeader } from "@/components/shell/app-shell";
import { requirePlatformAdmin } from "@/server/session";

export const metadata = { title: "Agencies" };

export default async function AgenciesPage() {
  await requirePlatformAdmin();
  return <PageHeader title="Agencies" />;
}
