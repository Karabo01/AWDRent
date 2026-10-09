import { signingView } from "@awdrent/core/signing";
import { logoSrc } from "@/lib/branding";
import { currentAgency } from "@/server/session";
import { SigningFlow } from "./signing-flow";

export const metadata = { title: "Sign a document", robots: { index: false }, referrer: "no-referrer" as const };
export const dynamic = "force-dynamic";

const SIGNER: Record<string, string> = { waiting: "waiting their turn", invited: "asked to sign", signed: "signed", declined: "declined" };

/** A signer's personal link (D47): read the document, confirm a code, sign. Branded for the agency (D50). */
export default async function SignPage({ params }: { params: Promise<{ token: string }> }) {
  const agency = await currentAgency();
  const { token } = await params;
  const view = await signingView(agency.id, token);
  const logo = logoSrc(agency);
  return (
    <main className="min-h-screen bg-muted/40 p-4">
      <div className="mx-auto grid max-w-2xl gap-4">
        <header className="flex items-center justify-center py-4">
          {logo ? <img src={logo} alt={agency.name} className="h-14 max-w-56 object-contain" /> : <p className="text-lg font-semibold text-primary">{agency.name}</p>}
        </header>
        <section className="grid gap-4 rounded-lg border bg-background p-5">
          {!view ? (
            <>
              <h1 className="text-xl font-semibold">Link not recognised</h1>
              <p className="text-sm text-muted-foreground">This signing link is not valid. Please contact {agency.name}.</p>
            </>
          ) : (
            <>
              <div>
                <h1 className="text-xl font-semibold">{view.title}</h1>
                <p className="text-sm text-muted-foreground">
                  For {view.signer.name}, signing as {view.signer.capacity}
                </p>
              </div>
              {view.envelopeStatus === "cancelled" ? (
                <p role="status">{agency.name} has withdrawn this document. They will send a new one if needed.</p>
              ) : view.envelopeStatus === "declined" ? (
                <p role="status">This document was declined and has been withdrawn.</p>
              ) : view.signer.status === "signed" ? (
                <p role="status" data-testid="signed-already">
                  You have signed this document.{" "}
                  {view.envelopeStatus === "completed" ? "Everyone has signed; " : "When everyone has signed, "}we
                  {view.envelopeStatus === "completed" ? " have sent" : " will send"} you the signed copy.
                </p>
              ) : view.expired ? (
                <p role="status">This link has expired. Ask {agency.name} to send you a new one.</p>
              ) : null}
              {view.envelopeStatus !== "cancelled" && !view.expired ? (
                <a href={`/s/${token}/document`} target="_blank" rel="noopener noreferrer" className="text-sm font-medium underline" data-testid="read-document">
                  {view.envelopeStatus === "completed" ? "Download the signed copy (PDF)" : "Read the document (PDF)"}
                </a>
              ) : null}
              {view.canSign ? <SigningFlow token={token} name={view.signer.name} codeSentTo={view.signer.codeSentTo} verified={view.signer.verified} /> : null}
              {view.others.length ? (
                <div className="text-sm">
                  <p className="font-medium">Other signers</p>
                  <ul className="text-muted-foreground">
                    {view.others.map((o) => (
                      <li key={`${o.name}-${o.capacity}`}>
                        {o.name} ({o.capacity}): {SIGNER[o.status]}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <p className="break-all font-mono text-xs text-muted-foreground" title="SHA-256 of the document">
                Document fingerprint: {view.documentSha256}
              </p>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
