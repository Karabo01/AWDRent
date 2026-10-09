"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useHydrated } from "@/lib/use-hydrated";

async function call(token: string, body: Record<string, unknown>): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  const res = await fetch(`/s/${token}/api`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, data };
}

/** A drawing box for the signature; reports whether anything has been drawn. */
function SignaturePad({ onChange }: { onChange: (dataUrl: string | null) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const drawn = useRef(false);
  useEffect(() => {
    const ctx = canvas.current?.getContext("2d");
    if (!ctx) return;
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#111111";
  }, []);
  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * e.currentTarget.width, y: ((e.clientY - r.top) / r.height) * e.currentTarget.height };
  };
  return (
    <div className="grid gap-1">
      <canvas
        ref={canvas}
        width={600}
        height={200}
        aria-label="Signature box: draw your signature"
        data-testid="signature-pad"
        className="h-40 w-full touch-none rounded-md border bg-white"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          const ctx = e.currentTarget.getContext("2d")!;
          const p = point(e);
          drawing.current = true;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return;
          const ctx = e.currentTarget.getContext("2d")!;
          const p = point(e);
          ctx.lineTo(p.x, p.y);
          ctx.stroke();
          drawn.current = true;
        }}
        onPointerUp={(e) => {
          drawing.current = false;
          if (drawn.current) onChange(e.currentTarget.toDataURL("image/png"));
        }}
      />
      <button
        type="button"
        className="justify-self-start text-xs text-muted-foreground underline"
        onClick={() => {
          const c = canvas.current!;
          c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
          drawn.current = false;
          onChange(null);
        }}
      >
        Clear and draw again
      </button>
    </div>
  );
}

export function SigningFlow({ token, name, codeSentTo, verified }: { token: string; name: string; codeSentTo: string | null; verified: boolean }) {
  const [step, setStep] = useState<"start" | "code" | "sign" | "decline" | "done" | "declined">(verified ? "sign" : "start");
  const [sentTo, setSentTo] = useState(codeSentTo);
  const [code, setCode] = useState("");
  const [typed, setTyped] = useState(name);
  const [consent, setConsent] = useState(false);
  const [signature, setSignature] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const hydrated = useHydrated();
  const busy = pending || !hydrated;
  const ids = { code: useId(), name: useId(), consent: useId(), reason: useId() };

  async function run(body: Record<string, unknown>, next: (data: Record<string, unknown>) => void) {
    setPending(true);
    setError(null);
    const { ok, data } = await call(token, body);
    setPending(false);
    if (ok) next(data);
    else setError(typeof data.message === "string" ? data.message : "Something went wrong. Please try again.");
  }

  const errorText = error ? (
    <p role="alert" className="text-sm text-destructive">
      {error}
    </p>
  ) : null;

  if (step === "done") {
    return (
      <p role="status" className="rounded-md bg-green-50 p-3 text-green-800" data-testid="signed-done">
        Thank you, you have signed.{" "}
        {result === "completed" ? "Everyone has now signed; we are sending you the signed copy." : "We will send you the signed copy once everyone has signed."}
      </p>
    );
  }
  if (step === "declined") {
    return (
      <p role="status" className="rounded-md bg-muted p-3">
        You declined to sign. The agent has been told and will be in touch.
      </p>
    );
  }
  if (step === "start") {
    return (
      <div className="grid gap-3">
        <p className="text-sm">Read the document first. To sign, we will send a one-time code to {sentTo ?? "you"} to confirm it is you.</p>
        {errorText}
        <Button disabled={busy} onClick={() => run({ action: "code" }, (d) => (setSentTo(String(d.sentTo ?? sentTo)), setStep("code")))}>
          Send me a code
        </Button>
      </div>
    );
  }
  if (step === "code") {
    return (
      <form
        className="grid gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void run({ action: "verify", code }, () => setStep("sign"));
        }}
      >
        <p role="status" className="text-sm">
          We have sent a 6-digit code to {sentTo}. It is valid for 10 minutes.
        </p>
        <div className="grid gap-1.5">
          <Label htmlFor={ids.code}>Code</Label>
          <Input
            id={ids.code}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            inputMode="numeric"
            autoComplete="one-time-code"
            required
          />
        </div>
        {errorText}
        <Button type="submit" disabled={busy}>
          Confirm
        </Button>
        <button type="button" className="text-sm text-muted-foreground underline" onClick={() => void run({ action: "code" }, () => setError(null))}>
          Send a new code
        </button>
      </form>
    );
  }
  if (step === "decline") {
    return (
      <form
        className="grid gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void run({ action: "decline", reason }, () => setStep("declined"));
        }}
      >
        <div className="grid gap-1.5">
          <Label htmlFor={ids.reason}>Why are you declining?</Label>
          <Textarea id={ids.reason} value={reason} onChange={(e) => setReason(e.target.value)} required maxLength={500} />
          <p className="text-xs text-muted-foreground">The agent will see this, so they can correct the document.</p>
        </div>
        {errorText}
        <div className="flex gap-2">
          <Button type="submit" variant="destructive" disabled={busy}>
            Decline to sign
          </Button>
          <Button type="button" variant="ghost" onClick={() => setStep("sign")}>
            Back
          </Button>
        </div>
      </form>
    );
  }
  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!signature) return setError("Draw your signature in the box.");
        void run({ action: "sign", signedName: typed, consent, signature }, (d) => (setResult(String(d.result)), setStep("done")));
      }}
    >
      <div className="grid gap-1.5">
        <Label htmlFor={ids.name}>Your full name</Label>
        <Input id={ids.name} value={typed} onChange={(e) => setTyped(e.target.value)} required maxLength={120} autoComplete="name" />
      </div>
      <div className="grid gap-1.5">
        <p className="text-sm font-medium">Your signature</p>
        <SignaturePad onChange={setSignature} />
      </div>
      <label htmlFor={ids.consent} className="flex items-start gap-2 text-sm">
        <input id={ids.consent} type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1" />
        I have read the document and agree to sign it electronically. My electronic signature has the same effect as my handwritten one.
      </label>
      {errorText}
      <Button type="submit" disabled={busy || !consent}>
        Sign
      </Button>
      <button type="button" className="justify-self-start text-sm text-muted-foreground underline" onClick={() => setStep("decline")}>
        I do not want to sign
      </button>
    </form>
  );
}
