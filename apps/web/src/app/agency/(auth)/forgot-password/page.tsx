import { logoSrc } from "@/lib/branding";
import { AuthCard } from "@/components/auth/auth-card";
import { ForgotPasswordForm } from "@/components/auth/password-forms";
import { currentAgency } from "@/server/session";

export const metadata = { title: "Forgot password" };

export default async function ForgotPasswordPage() {
  const agency = await currentAgency();
  return (
    <AuthCard brand={agency.name} logo={logoSrc(agency)} title="Reset your password">
      <ForgotPasswordForm />
    </AuthCard>
  );
}
