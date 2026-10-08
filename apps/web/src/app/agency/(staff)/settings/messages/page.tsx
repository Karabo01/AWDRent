import { listTemplates } from "@awdrent/core/messages";
import { allowedVariables } from "@awdrent/core/messaging/catalogue";
import Link from "next/link";
import { PageHeader } from "@/components/shell/app-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { actorOf, load } from "@/server/actor";
import { requireCan } from "@/server/session";
import { WordingForm } from "./wording-form";

export const metadata = { title: "Message wording" };

/** The message catalogue (spec), with each agency's own wording (D64). */
export default async function MessageWordingPage() {
  const s = await requireCan("settings.manage");
  const templates = await load(() => listTemplates(actorOf(s)));
  return (
    <>
      <PageHeader
        title="Message wording"
        description="What tenants receive by email and SMS. Your logo, colour and business details are added to every email, and an opt-out link to every message where it fits."
      />
      <p className="mb-4 text-sm">
        <Link href="/settings" className="underline">
          Back to settings
        </Link>
      </p>
      <div className="grid max-w-3xl gap-6">
        {templates.map(({ entry, email, sms }) => (
          <Card key={entry.key} id={entry.key} data-testid={`wording-${entry.key}`}>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2">
                {entry.label}
                {email.custom || sms?.custom ? <Badge variant="secondary">Your wording</Badge> : null}
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                {entry.when} · to {entry.to} · {entry.channels.map((c) => (c === "sms" ? "SMS" : c === "email" ? "email" : c)).join(" and ")}
              </p>
              <p className="text-xs text-muted-foreground">
                You can use {allowedVariables(entry).map((v) => `{${v}}`).join(" ")}
              </p>
            </CardHeader>
            <CardContent className="grid gap-6">
              {sms ? (
                <WordingForm
                  messageKey={entry.key}
                  channel="sms"
                  body={sms.body}
                  custom={sms.custom}
                  hint={`About ${sms.sampleLength} of 160 characters with typical details. Long names are shortened to keep it to one SMS.`}
                />
              ) : null}
              <WordingForm
                messageKey={entry.key}
                channel="email"
                subject={email.subject}
                body={email.body}
                custom={email.custom}
                hint={entry.channels.includes("email") ? "Blank lines start a new paragraph." : "Sent only when the SMS cannot be delivered."}
              />
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}
