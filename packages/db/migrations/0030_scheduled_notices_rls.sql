CALL app_scope_to_agency('scheduled_notices');
--> statement-breakpoint
-- A notice is recorded once and never changed
GRANT SELECT, INSERT ON scheduled_notices TO awdrent_app;
--> statement-breakpoint
GRANT UPDATE (reminders_paused_at, reminders_paused_until, reminders_pause_reason, reminders_paused_by) ON leases TO awdrent_app;
