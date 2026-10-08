"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient, type AuthAudience } from "@/lib/auth-client";
import { FormError } from "./auth-card";

export function TwoFactorForm({ audience }: { audience: AuthAudience }) {
  const router = useRouter();
  const [useBackup, setUseBackup] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    const code = String(new FormData(event.currentTarget).get("code")).replace(/\s/g, "");
    const client = authClient(audience);
    const { error } = useBackup
      ? await client.twoFactor.verifyBackupCode({ code })
      : await client.twoFactor.verifyTotp({ code });
    setPending(false);
    if (error) {
      setError(
        error.status === 429
          ? "Too many attempts. Wait a few minutes and try again."
          : "That code didn't work. Check your authenticator app and try again.",
      );
      return;
    }
    router.replace("/");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-4">
      <div className="grid gap-2">
        <Label htmlFor="code">{useBackup ? "Backup code" : "6-digit code"}</Label>
        <Input
          id="code"
          name="code"
          autoComplete="one-time-code"
          inputMode={useBackup ? "text" : "numeric"}
          pattern={useBackup ? undefined : "[0-9 ]{6,7}"}
          required
          autoFocus
        />
      </div>
      <FormError message={error} />
      <Button type="submit" disabled={pending}>
        {pending ? "Checking…" : "Continue"}
      </Button>
      <button
        type="button"
        className="text-sm text-muted-foreground underline-offset-4 hover:underline"
        onClick={() => setUseBackup(!useBackup)}
      >
        {useBackup ? "Use your authenticator app instead" : "Use a backup code instead"}
      </button>
    </form>
  );
}
