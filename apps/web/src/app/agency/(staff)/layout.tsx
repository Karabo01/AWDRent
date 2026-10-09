import { type Action, can } from "@awdrent/core/permissions";
import { AppShell, type NavItem } from "@/components/shell/app-shell";
import { SupportBanner } from "@/components/shell/support-banner";
import { logoSrc } from "@/lib/branding";
import { requireStaff, type StaffRole } from "@/server/session";

const NAV: (NavItem & { needs?: Action })[] = [
  { href: "/", label: "Dashboard" },
  { href: "/owners", label: "Owners", needs: "records.view" },
  { href: "/properties", label: "Properties", needs: "records.view" },
  { href: "/tenants", label: "Tenants", needs: "records.view" },
  { href: "/leases", label: "Leases", needs: "records.view" },
  { href: "/payments", label: "Proofs of payment", needs: "payments.approve" },
  { href: "/banking", label: "Banking", needs: "payments.approve" },
  { href: "/maintenance", label: "Maintenance", needs: "maintenance.manage" },
  { href: "/statements", label: "Owner statements", needs: "statements.manage" },
  { href: "/messages", label: "Messages", needs: "messages.view" },
  { href: "/import", label: "Import", needs: "import.run" },
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
      logo={logoSrc(agency)}
      audience="staff"
      userLabel={support ? user.name : `${user.name} · ${ROLE_LABEL[user.role]}`}
      nav={NAV.filter((n) => !n.needs || can(user.role, n.needs))}
      banner={support ? <SupportBanner support={support} /> : undefined}
    >
      {children}
    </AppShell>
  );
}
