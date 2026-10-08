CALL app_scope_to_agency('message_templates');
--> statement-breakpoint
CALL app_scope_to_agency('messages');
--> statement-breakpoint
-- Agency admins edit wording and can reset it to the built-in text
GRANT SELECT, INSERT, DELETE ON message_templates TO awdrent_app;
--> statement-breakpoint
GRANT UPDATE (subject, body, provider_template_id, updated_at) ON message_templates TO awdrent_app;
--> statement-breakpoint
-- The notification log: who, what and which text are fixed; only the delivery state moves
GRANT SELECT, INSERT ON messages TO awdrent_app;
--> statement-breakpoint
GRANT UPDATE (status, attempts, next_attempt_at, locked_until, provider, provider_id, error, sent_at, delivered_at, updated_at)
  ON messages TO awdrent_app;
--> statement-breakpoint
GRANT UPDATE (opt_out_code) ON tenants TO awdrent_app;
--> statement-breakpoint
-- Webhook lookup: written by the worker and read by webhooks, both as the platform role
ALTER TABLE provider_messages ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE provider_messages FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY platform_only ON provider_messages FOR ALL TO awdrent_platform USING (true) WITH CHECK (true);
--> statement-breakpoint
GRANT SELECT, INSERT ON provider_messages TO awdrent_platform;
