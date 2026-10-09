CALL app_scope_to_agency('document_templates');
--> statement-breakpoint
CALL app_scope_to_agency('signing_envelopes');
--> statement-breakpoint
CALL app_scope_to_agency('signers');
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON document_templates TO awdrent_app;
--> statement-breakpoint
GRANT UPDATE (sections, updated_at) ON document_templates TO awdrent_app;
--> statement-breakpoint
-- The frozen content, its fingerprint and the unsigned file never change once sent
GRANT SELECT, INSERT ON signing_envelopes TO awdrent_app;
--> statement-breakpoint
GRANT UPDATE (status, signed_document_id, completed_at, cancelled_at, cancel_reason, updated_at) ON signing_envelopes TO awdrent_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON signers TO awdrent_app;
--> statement-breakpoint
GRANT UPDATE (status, token_hash, token_expires_at, invited_at, code_hash, code_expires_at, code_attempts, code_verified_at,
  signed_at, signed_name, signature_key, ip_address, user_agent, declined_at, decline_reason, updated_at) ON signers TO awdrent_app;
--> statement-breakpoint
-- A signature, once given, is final; so is the end of an envelope
CREATE FUNCTION signers_final() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status IN ('signed', 'declined') THEN
    RAISE EXCEPTION 'signer % has already %', OLD.id, OLD.status USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER signers_final BEFORE UPDATE ON signers FOR EACH ROW EXECUTE FUNCTION signers_final();
--> statement-breakpoint
CREATE FUNCTION signing_envelopes_final() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status <> 'out_for_signing' THEN
    RAISE EXCEPTION 'envelope % is already %', OLD.id, OLD.status USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER signing_envelopes_final BEFORE UPDATE ON signing_envelopes FOR EACH ROW EXECUTE FUNCTION signing_envelopes_final();
