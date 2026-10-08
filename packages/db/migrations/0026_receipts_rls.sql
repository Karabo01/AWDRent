CALL app_scope_to_agency('receipts');
--> statement-breakpoint
CALL app_scope_to_agency('receipt_sequences');
--> statement-breakpoint
-- Receipts are never deleted or changed, only cancelled (once).
GRANT SELECT, INSERT ON receipts TO awdrent_app;
--> statement-breakpoint
GRANT UPDATE (cancelled_at, cancel_reason, updated_at) ON receipts TO awdrent_app;
--> statement-breakpoint
CREATE FUNCTION receipts_cancel_once() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.cancelled_at IS NOT NULL THEN
    RAISE EXCEPTION 'receipt % is already cancelled', OLD.receipt_number USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER receipts_cancel_once BEFORE UPDATE ON receipts FOR EACH ROW EXECUTE FUNCTION receipts_cancel_once();
--> statement-breakpoint
GRANT SELECT, INSERT ON receipt_sequences TO awdrent_app;
--> statement-breakpoint
GRANT UPDATE (last_value, updated_at) ON receipt_sequences TO awdrent_app;
--> statement-breakpoint
-- Agency admins keep their own business details up to date (D60)
GRANT UPDATE (legal_name, registration_no, ffc_number, vat_number, physical_address, contact_phone, contact_email)
  ON agencies TO awdrent_app;
