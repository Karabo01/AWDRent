import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function AuthCard({
  brand,
  logo,
  title,
  description,
  children,
}: {
  brand: string;
  /** Agency logo URL (D50); the name is shown when there is none. */
  logo?: string;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <div className="w-full max-w-sm">
        {logo ? (
          <img src={logo} alt={brand} className="mx-auto mb-4 h-14 max-w-56 object-contain" />
        ) : (
          <p className="mb-4 text-center text-sm font-semibold tracking-wide text-primary">{brand}</p>
        )}
        <Card>
          <CardHeader>
            <CardTitle className="text-xl">{title}</CardTitle>
            {description ? <CardDescription>{description}</CardDescription> : null}
          </CardHeader>
          <CardContent>{children}</CardContent>
        </Card>
      </div>
    </main>
  );
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="text-sm text-destructive">
      {message}
    </p>
  );
}
