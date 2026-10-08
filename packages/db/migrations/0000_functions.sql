-- Helper functions used by column defaults, RLS policies and triggers.
-- withAgency() in src/client.ts sets these settings with set_config(..., true),
-- so they last only for the current transaction.

-- The agency of the current transaction, or NULL when none is set.
-- Every RLS policy compares against this, so "not set" means "no rows".
CREATE FUNCTION app_current_agency() RETURNS uuid
LANGUAGE sql STABLE PARALLEL SAFE
AS $$ SELECT NULLIF(current_setting('app.agency_id', true), '')::uuid $$;
--> statement-breakpoint

-- The staff user acting in the current transaction (NULL for jobs/platform).
CREATE FUNCTION app_current_user() RETURNS uuid
LANGUAGE sql STABLE PARALLEL SAFE
AS $$ SELECT NULLIF(current_setting('app.user_id', true), '')::uuid $$;
--> statement-breakpoint

-- The support session a platform admin is acting under (NULL otherwise).
CREATE FUNCTION app_current_support_session() RETURNS uuid
LANGUAGE sql STABLE PARALLEL SAFE
AS $$ SELECT NULLIF(current_setting('app.support_session_id', true), '')::uuid $$;
--> statement-breakpoint

CREATE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$$;
--> statement-breakpoint

-- Attached BEFORE UPDATE OR DELETE on append-only tables.
CREATE FUNCTION forbid_mutation() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
END
$$;
