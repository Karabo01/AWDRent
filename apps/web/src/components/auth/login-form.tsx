"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient, type AuthAudience } from "@/lib/auth-client";
import { FormError } from "./auth-card";

export function LoginForm({ audience, notice }: { audience: AuthAudience; notice?: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    const form = new FormData(event.currentTarget);
    const { data, error } = await authClient(audience).signIn.email({
      email: String(form.get("email")),
      password: String(form.get("password")),
    });
    setPending(false);
    if (error) {
      setError(error.status === 429 ? "Too many attempts. Wait a few minutes and try again." : "Invalid email or password.");
      return;
    }
    // Enrolled users must enter a code; everyone else is sent to set up 2FA
    router.replace(data && "twoFactorRedirect" in data && data.twoFactorRedirect ? "/login/two-factor" : "/");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-4">
      {notice ? <p className="rounded-md bg-muted p-3 text-sm">{notice}</p> : null}
      <div className="grid gap-2">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" autoComplete="username" required autoFocus />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="password">Password</Label>
        <Input id="password" name="password" type="password" autoComplete="current-password" required />
      </div>
      <FormError message={error} />
      <Button type="submit" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </Button>
      {audience === "staff" ? (
        <Link href="/forgot-password" className="text-center text-sm text-muted-foreground underline-offset-4 hover:underline">
          Forgot your password?
        </Link>
      ) : null}
    </form>
  );
}
