import Link from "next/link";
import { SignOutButton } from "@/components/auth/sign-out-button";
import type { AuthAudience } from "@/lib/auth-client";

export interface NavItem {
  href: string;
  label: string;
}

/** Top bar + side navigation shared by the staff back office and the platform console. */
export function AppShell({
  brand,
  nav,
  userLabel,
  audience,
  banner,
  children,
}: {
  brand: string;
  nav: NavItem[];
  userLabel: string;
  audience: AuthAudience;
  banner?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen">
      {banner}
      <header className="flex h-14 items-center justify-between border-b px-4">
        <Link href="/" className="font-semibold text-primary">
          {brand}
        </Link>
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <span data-testid="current-user">{userLabel}</span>
          <SignOutButton audience={audience} />
        </div>
      </header>
      <div className="flex">
        <nav aria-label="Main" className="hidden w-52 shrink-0 border-r p-3 md:block">
          <ul className="grid gap-1">
            {nav.map((item) => (
              <li key={item.href}>
                <Link href={item.href} className="block rounded-md px-3 py-2 text-sm hover:bg-muted">
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <main className="min-w-0 flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold">{title}</h1>
        {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions}
    </div>
  );
}
