CREATE TYPE "public"."envelope_status" AS ENUM('out_for_signing', 'completed', 'declined', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."generated_document_kind" AS ENUM('lease_agreement', 'confirmation_letter');--> statement-breakpoint
CREATE TYPE "public"."signer_role" AS ENUM('tenant', 'owner', 'agent', 'agency_representative');--> statement-breakpoint
CREATE TYPE "public"."signer_status" AS ENUM('waiting', 'invited', 'signed', 'declined');--> statement-breakpoint
ALTER TYPE "public"."document_kind" ADD VALUE 'confirmation_letter' BEFORE 'other';--> statement-breakpoint
CREATE TABLE "document_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agency_id" uuid DEFAULT app_current_agency() NOT NULL,
	"kind" "generated_document_kind" NOT NULL,
	"sections" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid DEFAULT app_current_user()
);
--> statement-breakpoint
CREATE TABLE "signers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agency_id" uuid DEFAULT app_current_agency() NOT NULL,
	"envelope_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"role" "signer_role" NOT NULL,
	"party_id" uuid NOT NULL,
	"name" text NOT NULL,
	"capacity" text NOT NULL,
	"email" text,
	"phone" text,
	"status" "signer_status" DEFAULT 'waiting' NOT NULL,
	"token_hash" text,
	"token_expires_at" timestamp with time zone,
	"invited_at" timestamp with time zone,
	"code_hash" text,
	"code_expires_at" timestamp with time zone,
	"code_attempts" integer DEFAULT 0 NOT NULL,
	"code_verified_at" timestamp with time zone,
	"signed_at" timestamp with time zone,
	"signed_name" text,
	"signature_key" text,
	"ip_address" text,
	"user_agent" text,
	"declined_at" timestamp with time zone,
	"decline_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signing_envelopes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agency_id" uuid DEFAULT app_current_agency() NOT NULL,
	"lease_id" uuid NOT NULL,
	"kind" "generated_document_kind" NOT NULL,
	"status" "envelope_status" DEFAULT 'out_for_signing' NOT NULL,
	"landlord_signatory" text,
	"title" text NOT NULL,
	"content" jsonb NOT NULL,
	"document_sha256" text NOT NULL,
	"unsigned_document_id" uuid NOT NULL,
	"signed_document_id" uuid,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid DEFAULT app_current_user(),
	CONSTRAINT "signing_envelopes_landlord_signatory" CHECK ("signing_envelopes"."landlord_signatory" is null or "signing_envelopes"."landlord_signatory" in ('owner', 'agent'))
);
--> statement-breakpoint
ALTER TABLE "document_templates" ADD CONSTRAINT "document_templates_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signers" ADD CONSTRAINT "signers_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "signing_envelopes_agency_id_id_key" ON "signing_envelopes" USING btree ("agency_id","id");--> statement-breakpoint
ALTER TABLE "signers" ADD CONSTRAINT "signers_envelope_fk" FOREIGN KEY ("agency_id","envelope_id") REFERENCES "public"."signing_envelopes"("agency_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signing_envelopes" ADD CONSTRAINT "signing_envelopes_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signing_envelopes" ADD CONSTRAINT "signing_envelopes_lease_fk" FOREIGN KEY ("agency_id","lease_id") REFERENCES "public"."leases"("agency_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signing_envelopes" ADD CONSTRAINT "signing_envelopes_unsigned_fk" FOREIGN KEY ("agency_id","unsigned_document_id") REFERENCES "public"."documents"("agency_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signing_envelopes" ADD CONSTRAINT "signing_envelopes_signed_fk" FOREIGN KEY ("agency_id","signed_document_id") REFERENCES "public"."documents"("agency_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "document_templates_agency_kind_key" ON "document_templates" USING btree ("agency_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "signers_agency_token_key" ON "signers" USING btree ("agency_id","token_hash");--> statement-breakpoint
CREATE INDEX "signers_agency_envelope_idx" ON "signers" USING btree ("agency_id","envelope_id");--> statement-breakpoint
CREATE INDEX "signing_envelopes_agency_lease_idx" ON "signing_envelopes" USING btree ("agency_id","lease_id");