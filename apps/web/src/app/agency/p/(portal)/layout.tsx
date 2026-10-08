import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { PortalShell } from "@/components/shell/portal-shell";
import { logoSrc } from "@/lib/branding";
import { portalAuth } from "@/server/auth/portal";
import { requireTenant } from "@/server/portal-session";

export const dynamic = "force-dynamic";

async function signOut() {
  "use server";
  await portalAuth().api.signOut({ headers: await headers() });
  redirect("/p/login");
}

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const t = await requireTenant((await headers()).get("x-awd-path") ?? undefined);
  return (
    <PortalShell brand={t.agency.name} logo={logoSrc(t.agency)} name={t.name} signOut={signOut}>
      {children}
    </PortalShell>
  );
}
