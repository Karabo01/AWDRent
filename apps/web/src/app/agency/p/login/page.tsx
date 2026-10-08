import { redirect } from "next/navigation";
import { AuthCard } from "@/components/auth/auth-card";
import { logoSrc } from "@/lib/branding";
import { optionalTenant, safeNext } from "@/server/portal-session";
import { currentAgency } from "@/server/session";
import { PortalLoginForm } from "./login-form";

export const metadata = { title: "Tenant sign-in", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function PortalLoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const agency = await currentAgency();
  const next = safeNext((await searchParams).next);
  if (agency.status !== "active") redirect("/suspended");
  if (await optionalTenant()) redirect(next);
  return (
    <AuthCard
      brand={agency.name}
      logo={logoSrc(agency)}
      title="Tenant sign-in"
      description={`See your rent account with ${agency.name}, download receipts and send proof of payment.`}
    >
      <PortalLoginForm next={next} />
    </AuthCard>
  );
}
