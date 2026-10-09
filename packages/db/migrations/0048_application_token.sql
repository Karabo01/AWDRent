ALTER TABLE "applications" ADD COLUMN "token_enc" text NOT NULL;--> statement-breakpoint
-- Resending a link replaces the token
GRANT UPDATE (token_enc) ON applications TO awdrent_app;
