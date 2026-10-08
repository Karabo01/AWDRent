CALL app_scope_to_agency('charges');
--> statement-breakpoint
CALL app_scope_to_agency('payments');
--> statement-breakpoint

-- Charges: never deleted, never edited (D42). The only change allowed is
-- voiding, once.
GRANT SELECT, INSERT ON charges TO awdrent_app;
--> statement-breakpoint
GRANT UPDATE (voided_at, void_reason, voided_by, updated_at) ON charges TO awdrent_app;
--> statement-breakpoint
CREATE FUNCTION charges_void_once() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.voided_at IS NOT NULL THEN
    RAISE EXCEPTION 'charge % is already voided', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER charges_void_once BEFORE UPDATE ON charges FOR EACH ROW EXECUTE FUNCTION charges_void_once();
--> statement-breakpoint

-- Payments: amount, lease and date are fixed. Status moves from pending to
-- approved or rejected, and an approved payment cannot change afterwards.
GRANT SELECT, INSERT ON payments TO awdrent_app;
--> statement-breakpoint
GRANT UPDATE (status, approved_by, approved_at, bank_line_id, notes, updated_at) ON payments TO awdrent_app;
--> statement-breakpoint
CREATE FUNCTION payments_final_once_approved() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status <> 'pending' THEN
    RAISE EXCEPTION 'payment % is already %', OLD.id, OLD.status USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER payments_final_once_approved BEFORE UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION payments_final_once_approved();
--> statement-breakpoint

-- Leases: the billing start month can be set (only while a draft; enforced in code)
GRANT UPDATE (billing_starts_on) ON leases TO awdrent_app;
