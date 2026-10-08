import Link from "next/link";
import { AuthCard } from "@/components/auth/auth-card";
import { ResetPasswordForm } from "@/components/auth/password-forms";
import { currentAgency } from "@/server/session";

export const metadata = { title: "Choose a password" };

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const agency = await currentAgency();
  const { token } = await searchParams;
  return (
    <AuthCard brand={agency.name} title="Choose a password">
      {token ? (
        <ResetPasswordForm token={token} />
      ) : (
        <p className="text-sm">
          This link is incomplete. <Link href="/forgot-password" className="underline">Ask for a new one</Link>.
        </p>
      )}
    </AuthCard>
  );
}
