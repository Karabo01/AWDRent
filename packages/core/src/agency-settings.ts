import { schema, withAgency, type AgencyContext } from "@awdrent/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { audit, changes } from "./audit";
import { decrypt, encrypt, last4, normaliseIdentifier } from "./crypto";

// An agency admin's own settings: branding, trust account, quiet hours.
// Plan, limits, address and EFT prefix belong to the platform console.

const TRUST_FIELD = "agencies.trust_account_no";
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use 24-hour time, e.g. 20:00");

export const agencySettingsSchema = z.object({
  name: z.string().trim().min(2).max(120),
  brandColour: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Pick a colour"),
  trustBankName: z
    .string()
    .trim()
    .max(80)
    .transform((s) => s || null),
  // Empty keeps the current number
  trustAccountNo: z
    .string()
    .transform(normaliseIdentifier)
    .refine((s) => s === "" || /^\d{6,20}$/.test(s), "Digits only, 6 to 20 of them"),
  quietHoursStart: time,
  quietHoursEnd: time,
});
export type AgencySettingsInput = z.infer<typeof agencySettingsSchema>;

export async function getAgencySettings(ctx: AgencyContext) {
  return withAgency(ctx, async (tx) => {
    const [a] = await tx.select().from(schema.agencies).where(eq(schema.agencies.id, ctx.agencyId));
    if (!a) throw new Error("agency not found");
    return {
      name: a.name,
      subdomain: a.subdomain,
      eftPrefix: a.eftPrefix,
      brandColour: a.brandColour,
      trustBankName: a.trustBankName,
      trustAccountNoLast4: a.trustAccountNoLast4,
      smsSenderName: a.smsSenderName,
      quietHoursStart: a.quietHoursStart.slice(0, 5),
      quietHoursEnd: a.quietHoursEnd.slice(0, 5),
      plan: a.plan,
    };
  });
}

export async function updateAgencySettings(ctx: AgencyContext, input: AgencySettingsInput) {
  await withAgency(ctx, async (tx) => {
    const [before] = await tx.select().from(schema.agencies).where(eq(schema.agencies.id, ctx.agencyId)).for("update");
    if (!before) throw new Error("agency not found");
    const values = {
      name: input.name,
      brandColour: input.brandColour,
      trustBankName: input.trustBankName,
      quietHoursStart: input.quietHoursStart,
      quietHoursEnd: input.quietHoursEnd,
      ...(input.trustAccountNo
        ? {
            trustAccountNoEnc: encrypt(input.trustAccountNo, { agencyId: ctx.agencyId, field: TRUST_FIELD }),
            trustAccountNoLast4: last4(input.trustAccountNo),
          }
        : {}),
    };
    const [after] = await tx.update(schema.agencies).set(values).where(eq(schema.agencies.id, ctx.agencyId)).returning();
    const diff = changes(before, after ?? before);
    if (Object.keys(diff.after).length > 0) {
      await audit(tx, { action: "agency.settings_updated", entity: "agency", entityId: ctx.agencyId, ...diff });
    }
  });
}

/** Full trust account number, e.g. for printing on reminders in Phase 2. */
export async function trustAccountNumber(ctx: AgencyContext): Promise<string | null> {
  return withAgency(ctx, async (tx) => {
    const [a] = await tx
      .select({ enc: schema.agencies.trustAccountNoEnc })
      .from(schema.agencies)
      .where(eq(schema.agencies.id, ctx.agencyId));
    return a?.enc ? decrypt(a.enc, { agencyId: ctx.agencyId, field: TRUST_FIELD }) : null;
  });
}
