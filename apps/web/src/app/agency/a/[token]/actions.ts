"use server";

import { ApplicationError, detailsSchema, giveConsent, saveDetails, submitApplication } from "@awdrent/core/onboarding";
import { NotFoundError } from "@awdrent/core/portfolio";
import { revalidatePath } from "next/cache";
import { type FormState, parseForm } from "@/server/forms";
import { currentAgency } from "@/server/session";

// No login: the token in the link is the applicant's key, and the agency
// comes from the host (D108).

async function run(token: string, fn: (agencyId: string) => Promise<void>): Promise<FormState> {
  const agency = await currentAgency();
  try {
    await fn(agency.id);
  } catch (err) {
    if (err instanceof ApplicationError) return { error: err.message };
    if (err instanceof NotFoundError) return { error: "This link is not valid." };
    throw err;
  }
  revalidatePath(`/a/${token}`);
  return { ok: true };
}

export async function consentAction(token: string): Promise<void> {
  await run(token, (agencyId) => giveConsent(agencyId, token));
}

export async function detailsAction(token: string, _prev: FormState, form: FormData): Promise<FormState> {
  const parsed = parseForm(detailsSchema, form);
  if (!parsed.data) return parsed.state;
  return run(token, (agencyId) => saveDetails(agencyId, token, parsed.data));
}

export async function submitAction(token: string, _prev: FormState): Promise<FormState> {
  return run(token, (agencyId) => submitApplication(agencyId, token));
}
