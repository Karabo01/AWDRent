CALL app_scope_to_agency('payout_batches');
--> statement-breakpoint
CALL app_scope_to_agency('payout_items');
--> statement-breakpoint
-- A batch not yet paid can be cancelled (deleted with its items); a paid one is final
GRANT SELECT, INSERT, DELETE ON payout_batches, payout_items TO awdrent_app;
--> statement-breakpoint
GRANT UPDATE (status, paid_at, paid_by, updated_at) ON payout_batches TO awdrent_app;
--> statement-breakpoint
CREATE FUNCTION payout_batches_final() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status = 'paid' THEN
    RAISE EXCEPTION 'payout batch % is paid and final', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END
$$;
--> statement-breakpoint
CREATE TRIGGER payout_batches_final BEFORE UPDATE OR DELETE ON payout_batches FOR EACH ROW EXECUTE FUNCTION payout_batches_final();
--> statement-breakpoint
CREATE FUNCTION payout_items_final() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM payout_batches b WHERE b.agency_id = OLD.agency_id AND b.id = OLD.batch_id AND b.status = 'paid') THEN
    RAISE EXCEPTION 'payout item % belongs to a paid batch', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END
$$;
--> statement-breakpoint
CREATE TRIGGER payout_items_final BEFORE DELETE ON payout_items FOR EACH ROW EXECUTE FUNCTION payout_items_final();
