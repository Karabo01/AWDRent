import { redirect } from "next/navigation";
import { logoSrc } from "@/lib/branding";
import { AuthCard } from "@/components/auth/auth-card";
import { LoginForm } from "@/components/auth/login-form";
import { currentAgency, optionalStaffSession } from "@/server/session";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ reset?: string }> }) {
  const agency = await currentAgency();
  if (await optionalStaffSession()) redirect("/");
  const { reset } = await searchParams;
  return (
    <AuthCard brand={agency.name} logo={logoSrc(agency)} title="Sign in" description="Staff sign-in">
      <LoginForm audience="staff" notice={reset ? "Your password is set. Sign in to continue." : undefined} />
    </AuthCard>
  );
}
