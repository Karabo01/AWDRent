import { redirect } from "next/navigation";
import { logoSrc } from "@/lib/branding";
import { AuthCard } from "@/components/auth/auth-card";
import { SetupTwoFactor } from "@/components/auth/setup-two-factor";
import { currentAgency, optionalStaffSession } from "@/server/session";

export const metadata = { title: "Set up two-factor" };

export default async function SetupTwoFactorPage() {
  const agency = await currentAgency();
  const s = await optionalStaffSession();
  if (!s) redirect("/login");
  if (s.twoFactorEnabled) redirect("/");
  return (
    <AuthCard brand={agency.name} logo={logoSrc(agency)} title="Set up two-factor authentication">
      <SetupTwoFactor audience="staff" />
    </AuthCard>
  );
}
