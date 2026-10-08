import { hashPassword, symmetricEncrypt } from "better-auth/crypto";
import { eq } from "drizzle-orm";
import { authDb, ownerDb, withAgency } from "./client";
import {
  authAccounts,
  authTwoFactors,
  platformAccounts,
  platformAdmins,
  platformTwoFactors,
  users,
} from "./schema";

// Ready-to-use logins for the demo seed and end-to-end tests: a password and
// an already-enrolled TOTP secret, stored exactly as Better Auth stores them
// (secret encrypted with the auth secret). Never used in production paths.
//
// To generate codes for a seeded user, the TOTP key is the UTF-8 bytes of
// `totpSecret` (otpauth: new OTPAuth.Secret({ buffer: Buffer.from(totpSecret) })).

interface LoginSpec {
  name: string;
  email: string;
  password: string;
  totpSecret: string;
}

async function twoFactorRow(secretKey: string, totpSecret: string) {
  return {
    secret: await symmetricEncrypt({ key: secretKey, data: totpSecret }),
    backupCodes: await symmetricEncrypt({ key: secretKey, data: JSON.stringify([]) }),
    verified: true,
  };
}

export async function createStaffLogin(
  agencyId: string,
  spec: LoginSpec & { role: "admin" | "agent" | "accounts"; phone?: string },
): Promise<string> {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error("BETTER_AUTH_SECRET is not set");
  const [user] = await withAgency({ agencyId }, (tx) =>
    tx
      .insert(users)
      .values({ name: spec.name, email: spec.email, role: spec.role, phone: spec.phone ?? null, emailVerified: true })
      .returning(),
  );
  if (!user) throw new Error("user insert failed");
  await authDb().insert(authAccounts).values({
    userId: user.id,
    accountId: user.id,
    providerId: "credential",
    password: await hashPassword(spec.password),
  });
  await authDb()
    .insert(authTwoFactors)
    .values({ userId: user.id, ...(await twoFactorRow(secret, spec.totpSecret)) });
  await authDb().update(users).set({ twoFactorEnabled: true }).where(eq(users.id, user.id));
  return user.id;
}

export async function createPlatformLogin(spec: LoginSpec): Promise<string> {
  const secret = process.env.PLATFORM_AUTH_SECRET;
  if (!secret) throw new Error("PLATFORM_AUTH_SECRET is not set");
  const [admin] = await ownerDb()
    .insert(platformAdmins)
    .values({ name: spec.name, email: spec.email, emailVerified: true })
    .returning();
  if (!admin) throw new Error("platform admin insert failed");
  await ownerDb().insert(platformAccounts).values({
    userId: admin.id,
    accountId: admin.id,
    providerId: "credential",
    password: await hashPassword(spec.password),
  });
  await authDb()
    .insert(platformTwoFactors)
    .values({ userId: admin.id, ...(await twoFactorRow(secret, spec.totpSecret)) });
  await authDb().update(platformAdmins).set({ twoFactorEnabled: true }).where(eq(platformAdmins.id, admin.id));
  return admin.id;
}
