import { logoSrc } from "@/lib/branding";
import { AuthCard } from "@/components/auth/auth-card";
import { TwoFactorForm } from "@/components/auth/two-factor-form";
import { currentAgency } from "@/server/session";

export const metadata = { title: "Two-factor code" };

export default async function TwoFactorPage() {
  const agency = await currentAgency();
  return (
    <AuthCard brand={agency.name} logo={logoSrc(agency)} title="Enter your code" description="Open your authenticator app for the current code.">
      <TwoFactorForm audience="staff" />
    </AuthCard>
  );
}
