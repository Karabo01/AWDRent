import { type Action, can } from "@awdrent/core/permissions";
import { AppShell, type NavItem } from "@/components/shell/app-shell";
import { SupportBanner } from "@/components/shell/support-banner";
import { requireStaff, type StaffRole } from "@/server/session";

const NAV: (NavItem & { needs?: Action })[] = [
  { href: "/", label: "Dashboard" },
  { href: "/owners", label: "Owners", needs: "records.view" },
  { href: "/properties", label: "Properties", needs: "records.view" },
  { href: "/staff", label: "Staff", needs: "staff.manage" },
  { href: "/settings", label: "Settings", needs: "settings.manage" },
  { href: "/audit", label: "Audit log", needs: "audit.view" },
];

const ROLE_LABEL: Record<StaffRole, string> = { admin: "Admin", agent: "Rental agent", accounts: "Accounts" };

export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const { agency, user, support } = await requireStaff();
  return (
    <AppShell
      brand={agency.name}
      audience="staff"
      userLabel={support ? user.name : `${user.name} · ${ROLE_LABEL[user.role]}`}
      nav={NAV.filter((n) => !n.needs || can(user.role, n.needs))}
      banner={support ? <SupportBanner support={support} /> : undefined}
    >
      {children}
    </AppShell>
  );
}
