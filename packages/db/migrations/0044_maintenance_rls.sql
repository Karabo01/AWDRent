CALL app_scope_to_agency('contractors');
--> statement-breakpoint
CALL app_scope_to_agency('maintenance_requests');
--> statement-breakpoint
CALL app_scope_to_agency('maintenance_updates');
--> statement-breakpoint
GRANT SELECT, INSERT ON contractors, maintenance_requests TO awdrent_app;
--> statement-breakpoint
GRANT UPDATE (name, trade, email, phone, notes, active, updated_at) ON contractors TO awdrent_app;
--> statement-breakpoint
-- What was reported, where and by whom is fixed; the handling moves on
GRANT UPDATE (priority, status, contractor_id, completed_at, updated_at) ON maintenance_requests TO awdrent_app;
--> statement-breakpoint
-- The timeline is append-only
GRANT SELECT, INSERT ON maintenance_updates TO awdrent_app;
