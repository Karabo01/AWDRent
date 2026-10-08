import { redirect } from "next/navigation";
import { AuthCard } from "@/components/auth/auth-card";
import { SetupTwoFactor } from "@/components/auth/setup-two-factor";
import { optionalPlatformSession } from "@/server/session";

export const metadata = { title: "Set up two-factor" };

export default async function PlatformSetupTwoFactorPage() {
  const s = await optionalPlatformSession();
  if (!s) redirect("/login");
  if (s.twoFactorEnabled) redirect("/");
  return (
    <AuthCard brand="AWDRent Platform" title="Set up two-factor authentication">
      <SetupTwoFactor audience="platform" />
    </AuthCard>
  );
}
