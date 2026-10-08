import { PageHeader } from "@/components/shell/app-shell";
import { requirePlatformAdmin } from "@/server/session";
import { NewAgencyForm } from "./new-agency-form";

export const metadata = { title: "New agency" };

export default async function NewAgencyPage() {
  await requirePlatformAdmin();
  return (
    <>
      <PageHeader
        title="New agency"
        description="Creates the agency and its first admin, and emails the admin a link to set a password."
      />
      <NewAgencyForm />
    </>
  );
}
