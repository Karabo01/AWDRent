CALL app_scope_to_agency('bank_import_profiles');
--> statement-breakpoint
CALL app_scope_to_agency('bank_imports');
--> statement-breakpoint
CALL app_scope_to_agency('bank_lines');
--> statement-breakpoint

GRANT SELECT, INSERT ON bank_import_profiles TO awdrent_app;
--> statement-breakpoint
GRANT UPDATE (name, date_column, amount_column, credit_column, debit_column, reference_column, description_column,
  date_format, skip_rows, archived_at, updated_at) ON bank_import_profiles TO awdrent_app;
--> statement-breakpoint

-- Imports and statement lines are a record of what the bank said: never deleted,
-- and a line's date, amount and reference never change. Only how it was
-- resolved (matched to a lease, or ignored) can change.
GRANT SELECT, INSERT ON bank_imports TO awdrent_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON bank_lines TO awdrent_app;
--> statement-breakpoint
GRANT UPDATE (status, matched_lease_id, auto_matched, ignored_reason, resolved_by, resolved_at, updated_at) ON bank_lines TO awdrent_app;
