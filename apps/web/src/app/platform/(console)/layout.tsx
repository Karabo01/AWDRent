import { AppShell, type NavItem } from "@/components/shell/app-shell";
import { requirePlatformAdmin } from "@/server/session";

const NAV: NavItem[] = [{ href: "/", label: "Agencies" }];

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const { admin } = await requirePlatformAdmin();
  return (
    <AppShell brand="AWDRent Platform" audience="platform" userLabel={admin.name} nav={NAV}>
      {children}
    </AppShell>
  );
}
