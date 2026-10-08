-- Standard treatment for an agency-scoped table: RLS on and forced, the
-- agency isolation policy for the app and owner roles, and the
-- updated_at trigger. Grants are still given per table below.
CREATE PROCEDURE app_scope_to_agency(tbl regclass)
LANGUAGE plpgsql
AS $$
BEGIN
  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', tbl);
  EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', tbl);
  EXECUTE format(
    'CREATE POLICY agency_isolation ON %s FOR ALL TO awdrent_app, awdrent_owner
       USING (agency_id = app_current_agency()) WITH CHECK (agency_id = app_current_agency())',
    tbl);
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = tbl AND attname = 'updated_at' AND NOT attisdropped) THEN
    EXECUTE format('CREATE TRIGGER set_updated_at BEFORE UPDATE ON %s FOR EACH ROW EXECUTE FUNCTION set_updated_at()', tbl);
  END IF;
END
$$;
--> statement-breakpoint

CALL app_scope_to_agency('owners');
--> statement-breakpoint
CALL app_scope_to_agency('properties');
--> statement-breakpoint
CALL app_scope_to_agency('units');
--> statement-breakpoint
CALL app_scope_to_agency('agent_portfolios');
--> statement-breakpoint

-- Records are archived, never deleted, so their history stays intact.
-- agency_id is left out of UPDATE grants so a row can never change agency.
GRANT SELECT, INSERT ON owners, properties, units TO awdrent_app;
--> statement-breakpoint
GRANT UPDATE (kind, name, id_or_reg_no_enc, id_or_reg_no_last4, id_or_reg_no_blind_index, email, phone, postal_address,
  bank_name, bank_branch_code, bank_account_holder, bank_account_no_enc, bank_account_no_last4,
  commission_bps, vat_registered, vat_number, notes, archived_at, updated_at) ON owners TO awdrent_app;
--> statement-breakpoint
GRANT UPDATE (owner_id, name, type, address_line1, address_line2, suburb, city, province, postal_code, notes,
  archived_at, updated_at) ON properties TO awdrent_app;
--> statement-breakpoint
GRANT UPDATE (label, bedrooms, bathrooms, status, notes, archived_at, updated_at) ON units TO awdrent_app;
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON agent_portfolios TO awdrent_app;
