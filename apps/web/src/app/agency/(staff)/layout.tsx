import { AppShell, type NavItem } from "@/components/shell/app-shell";
import { requireStaff, type StaffRole } from "@/server/session";

const NAV: (NavItem & { roles?: StaffRole[] })[] = [{ href: "/", label: "Dashboard" }];

const ROLE_LABEL: Record<StaffRole, string> = { admin: "Admin", agent: "Rental agent", accounts: "Accounts" };

export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const { agency, user } = await requireStaff();
  return (
    <AppShell
      brand={agency.name}
      audience="staff"
      userLabel={`${user.name} · ${ROLE_LABEL[user.role]}`}
      nav={NAV.filter((n) => !n.roles || n.roles.includes(user.role))}
    >
      {children}
    </AppShell>
  );
}
