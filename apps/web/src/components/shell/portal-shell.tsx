import Link from "next/link";

/** The tenant portal's frame: agency branding, a short nav that fits a phone, and sign-out. */
export function PortalShell({
  brand,
  logo,
  name,
  signOut,
  children,
}: {
  brand: string;
  logo?: string;
  name: string;
  signOut: () => Promise<void>;
  children: React.ReactNode;
}) {
  const nav = [
    { href: "/p", label: "My rent" },
    { href: "/p/pay", label: "How to pay" },
    { href: "/p/messages", label: "Messages" },
  ];
  return (
    <div className="min-h-screen bg-muted/30">
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3">
          <Link href="/p" className="flex min-w-0 items-center gap-2 font-semibold text-primary">
            {logo ? <img src={logo} alt="" className="h-8 max-w-32 object-contain" /> : null}
            <span className="truncate">{brand}</span>
          </Link>
          <form action={signOut} className="flex items-center gap-3 text-sm text-muted-foreground">
            <span className="hidden sm:inline" data-testid="portal-user">
              {name}
            </span>
            <button type="submit" className="underline">
              Sign out
            </button>
          </form>
        </div>
        <nav aria-label="Portal" className="mx-auto flex max-w-3xl gap-1 overflow-x-auto px-2 pb-2 text-sm">
          {nav.map((n) => (
            <Link key={n.href} href={n.href} className="whitespace-nowrap rounded-md px-3 py-1.5 hover:bg-muted">
              {n.label}
            </Link>
          ))}
        </nav>
      </header>
      <main className="mx-auto max-w-3xl p-4">{children}</main>
    </div>
  );
}
