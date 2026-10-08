CALL app_scope_to_agency('deposit_entries');
--> statement-breakpoint
-- Like charges: never deleted or edited; voided once, with a reason.
GRANT SELECT, INSERT ON deposit_entries TO awdrent_app;
--> statement-breakpoint
GRANT UPDATE (voided_at, void_reason, voided_by, updated_at) ON deposit_entries TO awdrent_app;
--> statement-breakpoint
CREATE TRIGGER deposit_entries_void_once BEFORE UPDATE ON deposit_entries FOR EACH ROW EXECUTE FUNCTION charges_void_once();
--> statement-breakpoint

-- Payments: pending → approved | rejected, and approved → reversed (with a
-- reason). Nothing else ever changes once a payment has left "pending".
GRANT UPDATE (reversed_at, reversal_reason, reversed_by) ON payments TO awdrent_app;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION payments_final_once_approved() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status = 'pending' THEN
    RETURN NEW;
  END IF;
  IF OLD.status::text = 'approved' AND NEW.status::text = 'reversed'
     AND NEW.amount_cents = OLD.amount_cents AND NEW.lease_id = OLD.lease_id
     AND NEW.paid_on = OLD.paid_on AND NEW.approved_at = OLD.approved_at
     AND NEW.bank_line_id IS NOT DISTINCT FROM OLD.bank_line_id THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'payment % is % and cannot change this way', OLD.id, OLD.status USING ERRCODE = 'check_violation';
END
$$;
