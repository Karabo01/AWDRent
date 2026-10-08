import { AuthCard } from "@/components/auth/auth-card";
import { logoSrc } from "@/lib/branding";
import { currentAgency } from "@/server/session";

export const metadata = { title: "Tenant portal" };

/** Where portal links in messages land. Replaced by the tenant portal (Phase 2 step 8). */
export default async function PortalPage() {
  const agency = await currentAgency();
  return (
    <AuthCard brand={agency.name} logo={logoSrc(agency)} title="Tenant portal">
      <p className="text-sm text-muted-foreground">
        The {agency.name} tenant portal opens soon. Your receipts are emailed to you; for anything else, please contact your agent.
      </p>
    </AuthCard>
  );
}
