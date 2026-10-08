import { portalProfile, portalSetConsent } from "@awdrent/core/portal";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireTenant } from "@/server/portal-session";

export const metadata = { title: "Messages" };

async function saveConsent(form: FormData) {
  "use server";
  const t = await requireTenant("/p/messages");
  await portalSetConsent(t.actor, { email: form.get("email") === "on", sms: form.get("sms") === "on" });
  revalidatePath("/p/messages");
  redirect("/p/messages?saved");
}

/** The tenant chooses how the agency may message them (spec: manage notification consent). */
export default async function PortalMessagesPage({ searchParams }: { searchParams: Promise<{ saved?: string }> }) {
  const t = await requireTenant("/p/messages");
  const p = await portalProfile(t.actor);
  const saved = (await searchParams).saved !== undefined;
  return (
    <div className="grid gap-4">
      <h1 className="text-xl font-semibold">Messages</h1>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">How {t.agency.name} may contact you</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={saveConsent} className="grid gap-4 text-sm">
            <p className="text-muted-foreground">
              Rent reminders, payment confirmations with your receipt, and updates about your lease. Sign-in codes are always sent when you ask
              for one.
            </p>
            <label className="flex items-center gap-2">
              <input type="checkbox" name="email" defaultChecked={p.emailOptIn} disabled={!p.email} />
              Email{p.email ? ` to ${p.email}` : " (we have no email address for you)"}
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" name="sms" defaultChecked={p.smsOptIn} disabled={!p.phone} />
              SMS{p.phone ? ` to ${p.phone}` : " (we have no mobile number for you)"}
            </label>
            {saved ? (
              <p role="status" className="text-green-700">
                Saved.
              </p>
            ) : null}
            <Button type="submit" className="justify-self-start">
              Save
            </Button>
            <p className="text-xs text-muted-foreground">To change your email address or number, please contact {t.agency.name}.</p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
