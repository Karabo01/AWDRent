import { logoSrc } from "@/lib/branding";
import { AuthCard } from "@/components/auth/auth-card";
import { currentAgency } from "@/server/session";

export const metadata = { title: "Account suspended" };

export default async function SuspendedPage() {
  const agency = await currentAgency();
  return (
    <AuthCard brand={agency.name} logo={logoSrc(agency)} title="This account is suspended">
      <p className="text-sm text-muted-foreground">
        Access for {agency.name} is paused. Your data is safe. Please contact AWDTECH support to restore access.
      </p>
    </AuthCard>
  );
}
