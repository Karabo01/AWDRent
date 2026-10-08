import { randomUUID } from "node:crypto";
import { withAgency, withPlatform } from "../src/client";
import { agencies, users } from "../src/schema";

/** Creates an agency the way the platform console does, plus one admin user. */
export async function createAgencyWithAdmin(label: string) {
  const suffix = randomUUID().slice(0, 8);
  const [agency] = await withPlatform((tx) =>
    tx
      .insert(agencies)
      .values({ name: `${label} Rentals`, subdomain: `${label.toLowerCase()}-${suffix}`, eftPrefix: "TT" })
      .returning(),
  );
  if (!agency) throw new Error("agency not created");
  const [admin] = await withAgency({ agencyId: agency.id }, (tx) =>
    tx
      .insert(users)
      .values({ name: `${label} Admin`, email: `admin-${suffix}@${label.toLowerCase()}.test`, role: "admin" })
      .returning(),
  );
  if (!admin) throw new Error("admin not created");
  return { agency, admin };
}
