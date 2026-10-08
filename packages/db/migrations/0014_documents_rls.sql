CALL app_scope_to_agency('documents');
--> statement-breakpoint
GRANT SELECT, INSERT ON documents TO awdrent_app;
--> statement-breakpoint
-- Only the scan outcome, the move out of quarantine and soft deletion change
-- after upload; what a document belongs to is fixed.
GRANT UPDATE (status, scan_result, scanned_at, file_key, deleted_at, updated_at) ON documents TO awdrent_app;
