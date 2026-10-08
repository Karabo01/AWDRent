"use client";

import { useActionState } from "react";
import { Field, FormMessage } from "@/components/form/fields";
import { Button } from "@/components/ui/button";
import { resetWordingAction, saveWordingAction } from "./actions";

export function WordingForm({
  messageKey,
  channel,
  subject,
  body,
  custom,
  hint,
}: {
  messageKey: string;
  channel: "email" | "sms";
  subject?: string;
  body: string;
  custom: boolean;
  hint: string;
}) {
  const [state, action, pending] = useActionState(saveWordingAction, {});
  return (
    <div className="grid gap-2">
      <form action={action} className="grid gap-3">
        <input type="hidden" name="key" value={messageKey} />
        <input type="hidden" name="channel" value={channel} />
        {channel === "email" ? <Field name="subject" label="Email subject" defaultValue={subject} state={state} /> : null}
        <Field name="body" label={channel === "email" ? "Email text" : "SMS text"} multiline defaultValue={body} hint={hint} state={state} />
        <FormMessage state={state} />
        <div className="flex gap-2">
          <Button type="submit" size="sm" disabled={pending}>
            Save {channel === "email" ? "email" : "SMS"} wording
          </Button>
        </div>
      </form>
      {custom ? (
        <form action={resetWordingAction}>
          <input type="hidden" name="key" value={messageKey} />
          <input type="hidden" name="channel" value={channel} />
          <Button type="submit" size="sm" variant="ghost">
            Use the standard wording
          </Button>
        </form>
      ) : null}
    </div>
  );
}
