"use server";

import { optOut, type SendChannel } from "@awdrent/core/messages";
import { redirect } from "next/navigation";
import { currentAgency } from "@/server/session";

/** No login: the code identifies a tenant only within the agency of this host. */
export async function optOutAction(form: FormData): Promise<void> {
  const agency = await currentAgency();
  const code = String(form.get("code") ?? "");
  const channels = form.getAll("channel").filter((c): c is SendChannel => c === "sms" || c === "email");
  if (!/^[A-Za-z0-9]{6,12}$/.test(code)) redirect("/");
  await optOut(agency.id, code, channels);
  redirect(`/o/${code}${channels.length ? "?done" : ""}`);
}
