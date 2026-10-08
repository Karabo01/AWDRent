import { schema, withAgency } from "@awdrent/db";
import { eq } from "drizzle-orm";
import { audit } from "./audit";
import { scanBuffer } from "./clamav";
import { detectFileType } from "./file-types";
import { type Actor, authorise } from "./portfolio";
import { assertDownloadable, deleteObject, parseKey, promote, putQuarantined, readObject } from "./storage";

// Agency logo (D50). Uploaded by an agency admin in Settings, virus-scanned
// like any document, then shown on the agency's portal, emails, PDFs and
// signing pages. PNG or JPEG only: SVG can carry scripts.

export const MAX_LOGO_BYTES = 1024 * 1024;

export class LogoRejectedError extends Error {}

/** Stores the new logo in quarantine; the caller queues the scan. Returns its key. */
export async function uploadLogo(actor: Actor, bytes: Uint8Array): Promise<string> {
  authorise(actor, "settings.manage");
  if (bytes.byteLength === 0) throw new LogoRejectedError("The file is empty.");
  if (bytes.byteLength > MAX_LOGO_BYTES) throw new LogoRejectedError("Logos can be at most 1 MB.");
  const type = detectFileType(bytes);
  if (!type || type.extension === "pdf") throw new LogoRejectedError("Use a PNG or JPG image.");
  const key = await putQuarantined(actor.ctx.agencyId, bytes, type.contentType, type.extension);
  await withAgency(actor.ctx, (tx) =>
    audit(tx, { action: "agency.logo_uploaded", entity: "agency", entityId: actor.ctx.agencyId, after: { sizeBytes: bytes.byteLength } }),
  );
  return key;
}

/**
 * Worker step: scan a quarantined logo; if clean, make it the agency's logo
 * and delete the previous one. Infected files are deleted.
 */
export async function scanLogo(agencyId: string, quarantineKey: string, clamd: { host: string; port: number }): Promise<"clean" | "infected" | "skipped"> {
  const parsed = parseKey(quarantineKey);
  if (!parsed || parsed.agencyId !== agencyId || parsed.area !== "quarantine") return "skipped";
  let bytes: Uint8Array;
  try {
    bytes = await readObject(quarantineKey);
  } catch {
    return "skipped"; // already handled
  }
  const result = await scanBuffer(bytes, clamd);
  if (!result.clean) {
    await deleteObject(quarantineKey);
    await withAgency({ agencyId }, (tx) =>
      audit(tx, { action: "agency.logo_infected", entity: "agency", entityId: agencyId, after: { signature: result.signature } }),
    );
    return "infected";
  }
  const cleanKey = await promote(quarantineKey);
  const previous = await withAgency({ agencyId }, async (tx) => {
    const [a] = await tx.select({ logoKey: schema.agencies.logoKey }).from(schema.agencies).where(eq(schema.agencies.id, agencyId)).for("update");
    await tx.update(schema.agencies).set({ logoKey: cleanKey }).where(eq(schema.agencies.id, agencyId));
    await audit(tx, { action: "agency.logo_changed", entity: "agency", entityId: agencyId, before: { logoKey: a?.logoKey ?? null }, after: { logoKey: cleanKey } });
    return a?.logoKey ?? null;
  });
  if (previous) await deleteObject(previous).catch(() => undefined);
  return "clean";
}

export async function removeLogo(actor: Actor): Promise<void> {
  authorise(actor, "settings.manage");
  const previous = await withAgency(actor.ctx, async (tx) => {
    const [a] = await tx.select({ logoKey: schema.agencies.logoKey }).from(schema.agencies).where(eq(schema.agencies.id, actor.ctx.agencyId)).for("update");
    await tx.update(schema.agencies).set({ logoKey: null }).where(eq(schema.agencies.id, actor.ctx.agencyId));
    await audit(tx, { action: "agency.logo_removed", entity: "agency", entityId: actor.ctx.agencyId });
    return a?.logoKey ?? null;
  });
  if (previous) await deleteObject(previous).catch(() => undefined);
}

/** The logo's bytes for serving, checked against the agency's own prefix. */
export async function logoFile(agency: { id: string; logo_key: string | null }): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  if (!agency.logo_key) return null;
  assertDownloadable(agency.logo_key, agency.id);
  const bytes = await readObject(agency.logo_key);
  return { bytes, contentType: agency.logo_key.endsWith(".png") ? "image/png" : "image/jpeg" };
}
