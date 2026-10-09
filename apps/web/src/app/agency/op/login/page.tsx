import { redirect } from "next/navigation";
import { AuthCard } from "@/components/auth/auth-card";
import { logoSrc } from "@/lib/branding";
import { optionalOwner, safeNext } from "@/server/portal-session";
import { currentAgency } from "@/server/session";
import { PortalLoginForm } from "../../p/login/login-form";

export const metadata = { title: "Owner sign-in", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function OwnerLoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const agency = await currentAgency();
  const wanted = safeNext((await searchParams).next);
  const next = wanted.startsWith("/op") ? wanted : "/op";
  if (agency.status !== "active") redirect("/suspended");
  if (await optionalOwner()) redirect(next);
  return (
    <AuthCard brand={agency.name} logo={logoSrc(agency)} title="Owner sign-in" description={`Your properties, statements and maintenance with ${agency.name}.`}>
      <PortalLoginForm next={next} audience="owner" />
    </AuthCard>
  );
}
