-- Platform admins are created only from the command line
-- (`npm run platform:create-admin`), which connects as the owner role.
-- Neither the web app's auth role nor the platform role can create one, so a
-- compromised web process cannot mint itself a platform login.
CREATE POLICY owner_bootstrap ON platform_admins FOR ALL TO awdrent_owner USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY owner_bootstrap ON platform_accounts FOR ALL TO awdrent_owner USING (true) WITH CHECK (true);
