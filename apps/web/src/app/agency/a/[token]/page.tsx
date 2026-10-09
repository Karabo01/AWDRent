import { applicationForApplicant } from "@awdrent/core/onboarding";
import { Button } from "@/components/ui/button";
import { logoSrc } from "@/lib/branding";
import { currentAgency } from "@/server/session";
import { consentAction } from "./actions";
import { DetailsForm, SubmitForm } from "./applicant-forms";

export const metadata = { title: "Your application", robots: { index: false }, referrer: "same-origin" as const };
export const dynamic = "force-dynamic";

const day = new Intl.DateTimeFormat("en-ZA", { dateStyle: "long", timeZone: "Africa/Johannesburg" });
const FILE_STATUS: Record<string, string> = { pending: "received", accepted: "accepted", rejected: "please send a new one" };

/** The applicant's personal page (spec "Tenant onboarding"; D108): mobile first, save and come back. */
export default async function ApplicationPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ upload?: string }> }) {
  const agency = await currentAgency();
  const { token } = await params;
  const { upload } = await searchParams;
  const view = await applicationForApplicant(agency.id, token);
  const logo = logoSrc(agency);
  return (
    <main className="min-h-screen bg-muted/40 p-4">
      <div className="mx-auto grid max-w-2xl gap-4">
        <header className="flex items-center justify-center py-4">
          {logo ? <img src={logo} alt={agency.name} className="h-14 max-w-56 object-contain" /> : <p className="text-lg font-semibold text-primary">{agency.name}</p>}
        </header>
        <section className="grid gap-5 rounded-lg border bg-background p-5">
          {!view ? (
            <>
              <h1 className="text-xl font-semibold">Link not recognised</h1>
              <p className="text-sm text-muted-foreground">This application link is not valid. Please contact {agency.name}.</p>
            </>
          ) : (
            <>
              <div>
                <h1 className="text-xl font-semibold">Application for {view.unit}</h1>
                <p className="text-sm text-muted-foreground">
                  For {view.fullName}
                  {view.usable ? ` · this link works until ${day.format(view.expiresAt)}` : ""}
                </p>
              </div>
              {view.status === "approved" ? (
                <p role="status">Your application has been approved. {agency.name} will be in touch about the lease.</p>
              ) : view.status === "declined" ? (
                <p role="status">Your application was not successful this time. Thank you for applying.</p>
              ) : !view.usable ? (
                <p role="status">This link can no longer be used. Please ask {agency.name} for a new one.</p>
              ) : !view.consented ? (
                <form action={consentAction.bind(null, token)} className="grid gap-3 text-sm">
                  <p>
                    To apply, {agency.name} needs your personal information and documents to assess your application and, if it succeeds, to
                    prepare and manage your lease. They are kept securely, seen only by {agency.name}, and deleted if your application does not go
                    ahead, as the Protection of Personal Information Act requires. {agency.name} makes its own decision; no credit check is run
                    through this page.
                  </p>
                  <Button type="submit" className="justify-self-start">
                    I agree: start my application
                  </Button>
                </form>
              ) : (
                <>
                  {view.status === "submitted" ? (
                    <p role="status" className="rounded-md bg-green-50 p-3 text-sm text-green-800" data-testid="application-submitted">
                      Thank you, your application has been submitted. {agency.name} will review it and let you know.
                    </p>
                  ) : null}
                  <div className="grid gap-2">
                    <h2 className="font-medium">Your details</h2>
                    <DetailsForm token={token} values={{ fullName: view.fullName, email: view.email, phone: view.phone, ...view.details }} />
                  </div>
                  <div className="grid gap-3">
                    <h2 className="font-medium">Your documents</h2>
                    <p className="text-xs text-muted-foreground">A photo or PDF for each item, up to 10 MB each. You can save and come back later with this link.</p>
                    {upload && upload !== "ok" ? (
                      <p role="alert" className="text-sm text-destructive">
                        {upload}
                      </p>
                    ) : null}
                    <ul className="grid gap-3" data-testid="applicant-items">
                      {view.items.map((item) => (
                        <li key={item.key} className="grid gap-2 rounded-md border p-3 text-sm">
                          <div className="flex flex-wrap justify-between gap-2">
                            <span className="font-medium">
                              {item.label}
                              {item.required ? "" : " (optional)"}
                            </span>
                            <span className={item.accepted ? "text-green-700" : item.missing ? "text-muted-foreground" : ""}>
                              {item.accepted ? "Accepted" : item.missing ? (item.required ? "Needed" : "") : "Received"}
                            </span>
                          </div>
                          {item.files.map((f) => (
                            <div key={f.id} className={f.status === "rejected" ? "text-destructive" : "text-muted-foreground"}>
                              {f.filename}: {FILE_STATUS[f.status]}
                              {f.rejectReason ? ` (${f.rejectReason})` : ""}
                            </div>
                          ))}
                          {!item.accepted ? (
                            <form action={`/a/${token}/upload`} method="post" encType="multipart/form-data" className="flex flex-wrap items-center gap-2">
                              <input type="hidden" name="itemKey" value={item.key} />
                              <input type="file" name="file" accept="application/pdf,image/jpeg,image/png" required aria-label={`File for ${item.label}`} className="text-sm" />
                              <Button type="submit" size="sm" variant="outline">
                                Upload
                              </Button>
                            </form>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                  {view.status !== "submitted" ? <SubmitForm token={token} canSubmit={view.canSubmit} /> : null}
                </>
              )}
            </>
          )}
        </section>
      </div>
    </main>
  );
}
