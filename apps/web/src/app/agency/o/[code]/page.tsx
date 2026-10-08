import { optOutStatus } from "@awdrent/core/messages";
import { AuthCard } from "@/components/auth/auth-card";
import { Button } from "@/components/ui/button";
import { logoSrc } from "@/lib/branding";
import { currentAgency } from "@/server/session";
import { optOutAction } from "./actions";

export const metadata = { title: "Stop messages", robots: { index: false } };
export const dynamic = "force-dynamic";

/**
 * The opt-out link in messages (D39, D68). Opening it changes nothing: link
 * scanners in mail systems fetch links, so stopping takes a button press.
 */
export default async function OptOutPage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<{ done?: string }> }) {
  const agency = await currentAgency();
  const { code } = await params;
  const { done } = await searchParams;
  const status = await optOutStatus(agency.id, code);
  const card = (title: string, body: React.ReactNode) => (
    <AuthCard brand={agency.name} logo={logoSrc(agency)} title={title}>
      {body}
    </AuthCard>
  );
  if (!status) return card("Link not recognised", <p className="text-sm text-muted-foreground">This link is not valid. Please contact {agency.name}.</p>);
  if (done !== undefined) {
    return card(
      "Done",
      <p className="text-sm text-muted-foreground" role="status">
        You will no longer receive {!status.sms && !status.email ? "SMS or email messages" : !status.sms ? "SMS messages" : "email messages"} from{" "}
        {agency.name}. To start them again, ask your agent.
      </p>,
    );
  }
  if (!status.sms && !status.email) {
    return card("Messages are off", <p className="text-sm text-muted-foreground">You already receive no SMS or email messages from {agency.name}.</p>);
  }
  return card(
    "Stop messages",
    <form action={optOutAction} className="grid gap-4">
      <input type="hidden" name="code" value={code} />
      <p className="text-sm text-muted-foreground">
        Choose which messages from {agency.name} to stop. Rent reminders and payment confirmations will then no longer reach you that way.
      </p>
      <fieldset className="grid gap-2 text-sm">
        <legend className="sr-only">Messages to stop</legend>
        <label className="flex items-center gap-2">
          <input type="checkbox" name="channel" value="sms" defaultChecked={status.sms} disabled={!status.sms} />
          SMS{status.sms ? "" : " (already off)"}
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" name="channel" value="email" disabled={!status.email} />
          Email{status.email ? "" : " (already off)"}
        </label>
      </fieldset>
      <Button type="submit">Stop these messages</Button>
    </form>,
  );
}
