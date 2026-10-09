import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { PortalShell } from "@/components/shell/portal-shell";
import { logoSrc } from "@/lib/branding";
import { portalAuth } from "@/server/auth/portal";
import { requireOwner } from "@/server/portal-session";

export const dynamic = "force-dynamic";

async function signOut() {
  "use server";
  await portalAuth().api.signOut({ headers: await headers() });
  redirect("/op/login");
}

const NAV = [
  { href: "/op", label: "My properties" },
  { href: "/op/statements", label: "Statements" },
  { href: "/op/maintenance", label: "Maintenance" },
];

/** The owner portal (D104): read-only. */
export default async function OwnerLayout({ children }: { children: React.ReactNode }) {
  const o = await requireOwner((await headers()).get("x-awd-path") ?? undefined);
  return (
    <PortalShell brand={o.agency.name} logo={logoSrc(o.agency)} name={o.name} signOut={signOut} nav={NAV} home="/op">
      {children}
    </PortalShell>
  );
}
