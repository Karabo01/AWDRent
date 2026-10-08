#!/bin/sh
# Runs once, when the postgres data volume is first created.
# Creates the four application roles and the test database.
# Table-level grants and RLS policies live in the migrations.
set -eu

TEST_DB="${TEST_DATABASE_NAME:-awdrent_test}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v owner_pw="$DB_OWNER_PASSWORD" \
  -v app_pw="$DB_APP_PASSWORD" \
  -v auth_pw="$DB_AUTH_PASSWORD" \
  -v platform_pw="$DB_PLATFORM_PASSWORD" \
  -v db="$POSTGRES_DB" \
  -v test_db="$TEST_DB" <<'SQL'
-- None of these roles is a superuser and none can bypass row-level security.
CREATE ROLE awdrent_owner    LOGIN NOSUPERUSER NOCREATEROLE NOBYPASSRLS PASSWORD :'owner_pw';
CREATE ROLE awdrent_app      LOGIN NOSUPERUSER NOCREATEROLE NOCREATEDB NOBYPASSRLS PASSWORD :'app_pw';
CREATE ROLE awdrent_auth     LOGIN NOSUPERUSER NOCREATEROLE NOCREATEDB NOBYPASSRLS PASSWORD :'auth_pw';
CREATE ROLE awdrent_platform LOGIN NOSUPERUSER NOCREATEROLE NOCREATEDB NOBYPASSRLS PASSWORD :'platform_pw';

ALTER DATABASE :"db" OWNER TO awdrent_owner;
REVOKE ALL ON DATABASE :"db" FROM PUBLIC;
GRANT CONNECT ON DATABASE :"db" TO awdrent_app, awdrent_auth, awdrent_platform;

CREATE DATABASE :"test_db" OWNER awdrent_owner;
REVOKE ALL ON DATABASE :"test_db" FROM PUBLIC;
GRANT CONNECT ON DATABASE :"test_db" TO awdrent_app, awdrent_auth, awdrent_platform;
SQL

# Lock down the public schema in both databases: only the owner creates objects.
for d in "$POSTGRES_DB" "$TEST_DB"; do
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$d" <<'SQL'
ALTER SCHEMA public OWNER TO awdrent_owner;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO awdrent_app, awdrent_auth, awdrent_platform;
SQL
done
