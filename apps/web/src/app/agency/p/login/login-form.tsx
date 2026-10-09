"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

async function post(path: string, body: unknown): Promise<string | null> {
  const res = await fetch(`/api/portal-auth${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.ok) return null;
  if (res.status === 429) return "Too many attempts. Please wait a few minutes and try again.";
  const data = (await res.json().catch(() => null)) as { message?: string } | null;
  return data?.message ?? "Something went wrong. Please try again.";
}

/** Step 1: email or mobile number. Step 2: the 6-digit code sent there. */
export function PortalLoginForm({ next, audience = "tenant" }: { next: string; audience?: "tenant" | "owner" }) {
  const [identifier, setIdentifier] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"identify" | "code">("identify");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const idField = useId();
  const codeField = useId();
  const isPhone = !identifier.includes("@");

  async function sendCode(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const problem = await post("/otp/send", { identifier, audience });
    setPending(false);
    if (problem) setError(problem);
    else setStep("code");
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const problem = await post("/otp/verify", { identifier, code, audience });
    if (problem) {
      setPending(false);
      setError(problem);
      return;
    }
    window.location.assign(next);
  }

  if (step === "identify") {
    return (
      <form onSubmit={sendCode} className="grid gap-4">
        <div className="grid gap-1.5">
          <Label htmlFor={idField}>Email address or mobile number</Label>
          <Input
            id={idField}
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            autoComplete="username"
            inputMode="email"
            required
            maxLength={254}
          />
          <p className="text-xs text-muted-foreground">The one your agent has for you. We will send you a code; no password needed.</p>
        </div>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <Button type="submit" disabled={pending}>
          Send me a code
        </Button>
      </form>
    );
  }

  return (
    <form onSubmit={verify} className="grid gap-4">
      <p role="status" className="text-sm">
        If {identifier} belongs to one of our {audience === "owner" ? "owners" : "tenants"}, we have sent a 6-digit code {isPhone ? "by SMS" : "by email"}. It is valid for 10 minutes.
      </p>
      <div className="grid gap-1.5">
        <Label htmlFor={codeField}>Code</Label>
        <Input
          id={codeField}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          autoComplete="one-time-code"
          inputMode="numeric"
          pattern="[0-9]{6}"
          required
        />
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <Button type="submit" disabled={pending}>
        Sign in
      </Button>
      <button
        type="button"
        className="text-sm text-muted-foreground underline"
        onClick={() => {
          setStep("identify");
          setCode("");
          setError(null);
        }}
      >
        Use a different address or number, or send a new code
      </button>
    </form>
  );
}
