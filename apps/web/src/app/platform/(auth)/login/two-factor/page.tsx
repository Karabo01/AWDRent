import { AuthCard } from "@/components/auth/auth-card";
import { TwoFactorForm } from "@/components/auth/two-factor-form";

export const metadata = { title: "Two-factor code" };

export default function PlatformTwoFactorPage() {
  return (
    <AuthCard brand="AWDRent Platform" title="Enter your code">
      <TwoFactorForm audience="platform" />
    </AuthCard>
  );
}
