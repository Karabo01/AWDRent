"use client";

import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient, type AuthAudience } from "@/lib/auth-client";
import { FormError } from "./auth-card";

type Step = { kind: "password" } | { kind: "scan"; qr: string; secret: string; backupCodes: string[] };

export function SetupTwoFactor({ audience }: { audience: AuthAudience }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>({ kind: "password" });
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function start(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    const password = String(new FormData(event.currentTarget).get("password"));
    const { data, error } = await authClient(audience).twoFactor.enable({ password });
    setPending(false);
    if (error || !data || data.method !== "totp") {
      setError("That password is not correct.");
      return;
    }
    const secret = new URL(data.totpURI).searchParams.get("secret") ?? "";
    setStep({ kind: "scan", qr: await QRCode.toDataURL(data.totpURI, { margin: 1, width: 200 }), secret, backupCodes: data.backupCodes });
  }

  async function confirm(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    const code = String(new FormData(event.currentTarget).get("code")).replace(/\s/g, "");
    const { error } = await authClient(audience).twoFactor.verifyTotp({ code });
    setPending(false);
    if (error) {
      setError("That code didn't match. Make sure your phone's clock is correct and try the newest code.");
      return;
    }
    router.replace("/");
    router.refresh();
  }

  if (step.kind === "password") {
    return (
      <form onSubmit={start} className="grid gap-4">
        <p className="text-sm text-muted-foreground">
          Two-factor authentication is required. You need an authenticator app such as Google Authenticator, Microsoft
          Authenticator or 1Password.
        </p>
        <div className="grid gap-2">
          <Label htmlFor="password">Confirm your password</Label>
          <Input id="password" name="password" type="password" autoComplete="current-password" required autoFocus />
        </div>
        <FormError message={error} />
        <Button type="submit" disabled={pending}>
          Continue
        </Button>
      </form>
    );
  }

  return (
    <form onSubmit={confirm} className="grid gap-4">
      <p className="text-sm">1. Scan this code with your authenticator app.</p>
      <img src={step.qr} alt="QR code for your authenticator app" className="mx-auto size-48" />
      <p className="text-xs text-muted-foreground">
        Can&apos;t scan? Enter this key instead: <code className="break-all font-mono" data-testid="totp-secret">{step.secret}</code>
      </p>
      <div className="grid gap-2">
        <p className="text-sm">2. Save these backup codes somewhere safe. Each works once if you lose your phone.</p>
        <ul className="grid grid-cols-2 gap-1 rounded-md bg-muted p-3 font-mono text-sm">
          {step.backupCodes.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="code">3. Enter the 6-digit code from the app</Label>
        <Input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" required />
      </div>
      <FormError message={error} />
      <Button type="submit" disabled={pending}>
        Turn on two-factor
      </Button>
    </form>
  );
}
