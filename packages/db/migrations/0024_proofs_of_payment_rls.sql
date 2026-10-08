CALL app_scope_to_agency('proofs_of_payment');
--> statement-breakpoint
-- Never deleted. What the tenant claimed and which file they sent are fixed;
-- only the review outcome changes.
GRANT SELECT, INSERT ON proofs_of_payment TO awdrent_app;
--> statement-breakpoint
GRANT UPDATE (status, bank_line_id, approved_cents, reject_reason, reviewed_by, reviewed_at, updated_at) ON proofs_of_payment TO awdrent_app;
