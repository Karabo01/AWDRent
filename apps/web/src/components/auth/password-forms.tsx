"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { staffClient } from "@/lib/auth-client";
import { FormError } from "./auth-card";

export function ForgotPasswordForm() {
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    await staffClient.requestPasswordReset({
      email: String(new FormData(event.currentTarget).get("email")),
      redirectTo: "/reset-password",
    });
    setPending(false);
    // Same answer whether or not the address exists
    setSent(true);
  }

  if (sent) {
    return <p className="text-sm">If that address belongs to a staff account here, we&apos;ve emailed a reset link. It expires in an hour.</p>;
  }
  return (
    <form onSubmit={onSubmit} className="grid gap-4">
      <div className="grid gap-2">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" required autoFocus />
      </div>
      <Button type="submit" disabled={pending}>
        Send reset link
      </Button>
      <Link href="/login" className="text-center text-sm text-muted-foreground hover:underline">
        Back to sign in
      </Link>
    </form>
  );
}

export function ResetPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const newPassword = String(form.get("password"));
    if (newPassword !== String(form.get("confirm"))) {
      setError("The passwords don't match.");
      return;
    }
    setError(null);
    setPending(true);
    const { error } = await staffClient.resetPassword({ newPassword, token });
    setPending(false);
    if (error) {
      setError(
        error.code === "PASSWORD_TOO_SHORT"
          ? "Use at least 12 characters."
          : "This link has expired or was already used. Ask for a new one.",
      );
      return;
    }
    router.replace("/login?reset=1");
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-4">
      <div className="grid gap-2">
        <Label htmlFor="password">New password</Label>
        <Input id="password" name="password" type="password" autoComplete="new-password" minLength={12} required autoFocus />
        <p className="text-xs text-muted-foreground">At least 12 characters. A short sentence works well.</p>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="confirm">Confirm new password</Label>
        <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required />
      </div>
      <FormError message={error} />
      <Button type="submit" disabled={pending}>
        Set password
      </Button>
    </form>
  );
}
