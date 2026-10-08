import { randomBytes } from "node:crypto";
import { parseArgs } from "node:util";
import { hashPassword } from "better-auth/crypto";
import { closeDb, ownerDb } from "./client";
import { platformAccounts, platformAdmins } from "./schema";

// Usage: npm run platform:create-admin -- --email you@awdtech.co.za --name "Your Name"
// Prints a one-time password. The admin sets up TOTP at first sign-in.
// Runs as the owner role; the web app has no way to create platform admins.

async function main() {
  const { values } = parseArgs({ options: { email: { type: "string" }, name: { type: "string" } } });
  const email = values.email?.trim().toLowerCase();
  const name = values.name?.trim();
  if (!email || !name) throw new Error('Usage: --email you@example.com --name "Full Name"');

  const password = randomBytes(18).toString("base64url");
  await ownerDb().transaction(async (tx) => {
    const [admin] = await tx.insert(platformAdmins).values({ email, name, emailVerified: true }).returning();
    if (!admin) throw new Error("insert failed");
    await tx.insert(platformAccounts).values({
      userId: admin.id,
      accountId: admin.id,
      providerId: "credential",
      password: await hashPassword(password),
    });
  });
  console.log(`Platform admin ${email} created.\nOne-time password: ${password}\nSign in at admin.<domain>/login and set up two-factor straight away.`);
}

main()
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
