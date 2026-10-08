# AWDRent

Multi-tenant rental management for South African property agencies, hosted by
AWDTECH. Each agency gets its own address (`{agency}.awdrent.co.za`), and all
agencies share one app and one database, kept apart by Postgres row-level
security.

- Specification: [docs/spec.md](docs/spec.md)
- Decisions made on top of the spec: [docs/decisions.md](docs/decisions.md)
- Spreadsheet import guide: [docs/import-template.md](docs/import-template.md)

**Status: Phase 1** — agencies and isolation, platform console, staff sign-in
with mandatory 2FA, roles and agent portfolios, owners, properties, units,
tenants, leases with EFT references, documents with virus scanning, CSV
import, audit log. Rent ledger, payments and messaging are Phase 2.

## Contents

- [How it fits together](#how-it-fits-together)
- [Running locally](#running-locally)
- [Environment variables](#environment-variables)
- [Tests](#tests)
- [Deploying on Coolify](#deploying-on-coolify)
- [Operations](#operations)

## How it fits together

```
apps/web        Next.js: staff back office ({agency}.domain) and platform console (admin.domain)
apps/worker     BullMQ worker: virus scans, stuck-scan sweep, nightly usage snapshot
packages/db     Drizzle schema, SQL migrations (incl. RLS), withAgency(), dev logins
packages/core   Business logic: permissions, portfolios, owners … leases, documents, import, crypto
packages/config Validated environment
docker/         Dockerfiles and the Postgres role setup
e2e/            Playwright tests
```

**Isolation.** Every agency table has `agency_id` and row-level security,
forced even for the table owner. The app connects as `awdrent_app`, which
cannot bypass RLS, and every query runs inside `withAgency()`, which sets the
agency for that transaction only, taken from the signed-in session or the job
payload. Links between agency tables are composite `(agency_id, id)` foreign
keys, so not even a raw insert can point at another agency's row. Login
tables are readable only by `awdrent_auth`, and the platform console uses
`awdrent_platform`, which cannot see agency records. See
`packages/db/migrations/0002_rls_and_grants.sql`.

**Within an agency**, roles and agent portfolios are checked inside the core
functions (`packages/core/src/permissions.ts`, `portfolio.ts`), so a page
cannot forget them.

**Sensitive fields.** ID numbers and bank account numbers are encrypted with
AES-256-GCM, with the agency and field bound in, so a value copied elsewhere
will not decrypt. Pages show the last 4 digits; showing the full number is an
audited action.

**Files.** Uploads are checked by content (PDF/JPEG/PNG, 10 MB), stored under
`agencies/{id}/quarantine/`, scanned by ClamAV in the worker, then moved to
`agencies/{id}/files/`. Downloads go through an access-checked, audited route
that redirects to a 5-minute signed link.

## Running locally

Requirements: Node 22+, Docker Desktop (for Postgres, Redis, object storage
and ClamAV).

```bash
cp .env.example .env
# Fill in the four REPLACE_WITH_… values; each is 32 random bytes:
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
# Locally, set AUTH_RATE_LIMIT_MAX=50 if you will run the Playwright tests.

docker compose up -d postgres redis seaweedfs clamav
npm install
npm run storage:init     # creates the private documents bucket
npm run db:migrate
npm run db:seed          # two demo agencies with logins (local only)
npm run dev              # web on :3000
npm run dev:worker       # in a second terminal: virus scans
```

Browsers resolve `*.localhost` to your machine, so open:

| Address | What |
|---------|------|
| http://admin.localhost:3000 | Platform console |
| http://kgosi.localhost:3000 | Demo agency "Kgosi Lettings" |
| http://bayview.localhost:3000 | Demo agency "Bayview Rentals" |

**Demo logins** (local and CI only; the seed refuses to run against a real
domain). The password for every demo login is `demo password 2026`.

| Login | Email |
|-------|-------|
| Platform admin | platform@awdtech.test |
| Kgosi admin / agent / accounts | admin@kgosi.test / agent@kgosi.test / accounts@kgosi.test |
| Bayview admin / agent / accounts | admin@bayview.test / agent@bayview.test / accounts@bayview.test |

Their 2FA is already set up. To get a code, add the login's TOTP key to an
authenticator app. The keys are in `packages/core/scripts/demo.ts`: the key is
the Base32 encoding of the `totp` string. Or generate a code with:

```bash
node -e "const O=require('otpauth');console.log(new O.TOTP({secret:new O.Secret({buffer:Buffer.from('KGOSIADMINDEMOSECRETKGOSIADMIN01')})}).generate())"
```

**Running everything in Docker**: `docker compose up --build` builds and
starts the web app and worker as well. Set `SEED_DEMO=true` in `.env` the
first time to load the demo data. Emails (invites, password resets) are
printed in the web container's log while `RESEND_API_KEY` is empty, and the
console shows a "Dev only: open invite link" shortcut.

**Creating a real platform admin**:

```bash
npm run platform:create-admin -- --email you@awdtech.co.za --name "Your Name"
```

This prints a one-time password; set up 2FA at first sign-in. Only this
command, running as the database owner, can create platform admins.

## Environment variables

All are validated at start-up (`packages/config/src/index.ts`); the app
refuses to start with a missing or malformed value. `.env.example` documents
each one. The important ones:

| Variable | Notes |
|----------|-------|
| `APP_BASE_DOMAIN`, `APP_PROTOCOL`, `APP_PUBLIC_PORT` | `awdrent.co.za`, `https`, empty in production |
| `DATABASE_URL`, `DATABASE_AUTH_URL`, `DATABASE_PLATFORM_URL` | One per role: `awdrent_app`, `awdrent_auth`, `awdrent_platform` |
| `DATABASE_OWNER_URL` | Migrations, seed and the admin CLI only. Never give it to the web app. |
| `DB_*_PASSWORD`, `POSTGRES_PASSWORD` | Used by the Postgres container to create the roles on first start |
| `REDIS_URL`, `RATE_LIMIT_STORAGE` | Must be `redis` in production |
| `AUTH_RATE_LIMIT_MAX` | Sign-in/2FA attempts per IP per 5 minutes. Keep 5 in production. |
| `S3_*` | `S3_ENDPOINT` is what the containers use; `S3_PUBLIC_ENDPOINT` is what browsers use for signed links |
| `CLAMAV_HOST`, `CLAMAV_PORT` | clamd |
| `ENCRYPTION_KEYS`, `ENCRYPTION_ACTIVE_KEY_VERSION` | Versioned AES keys. **Back these up separately: losing them makes ID and bank numbers unrecoverable.** |
| `BLIND_INDEX_KEY` | For finding duplicate ID numbers. Do not change it once data exists. |
| `BETTER_AUTH_SECRET`, `PLATFORM_AUTH_SECRET` | Different from each other. Rotating one signs everyone out. |
| `RESEND_API_KEY`, `EMAIL_FROM` | Without a key, emails go to the log |

## Tests

```bash
npm run lint && npm run typecheck
npm test            # unit + integration, including cross-agency isolation (uses awdrent_test)
npm run test:e2e    # Playwright; needs the app running, migrated and seeded
```

The integration tests reset and migrate the `awdrent_test` database each run.
The isolation tests try to read, update, insert, delete and download across
agencies, and must fail. A structure test checks every table, including
future ones, for RLS, FORCE and an agency policy, so a new table without
isolation fails CI. CI (`.github/workflows/ci.yml`) runs all of it, then
Playwright against a production build.

## Deploying on Coolify

The app is one Docker Compose resource: `web`, `worker`, `postgres`, `redis`,
`seaweedfs` (document storage), `clamav`, plus a one-off `migrate` service
that creates the storage bucket and runs migrations before `web` and `worker`
start.

1. **Server.** 2–4 vCPU and 4–8 GB RAM. ClamAV alone needs about 1.5 GB of RAM
   for its signatures.
2. **Resource.** In Coolify: New resource → Docker Compose → point at this
   repository, compose file `docker-compose.yml`.
3. **Environment.** Paste the variables from `.env.example` into the
   resource's Environment Variables with production values:
   - `APP_BASE_DOMAIN=awdrent.co.za`, `APP_PROTOCOL=https`, `APP_PUBLIC_PORT=` (empty)
   - strong, unique passwords for `POSTGRES_PASSWORD`, every `DB_*_PASSWORD`, and `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` (letters, digits and `_+=/.-` only)
   - new random values for the encryption, blind-index and auth secrets (also kept in your password manager)
   - `S3_PUBLIC_ENDPOINT=https://files.awdrent.co.za`
   - `SEED_DEMO=false` (the default)
   - `RESEND_API_KEY` and `EMAIL_FROM` on a verified Resend domain
4. **Domains.** On the `web` service set the domain to
   `https://*.awdrent.co.za,https://awdrent.co.za`. The admin console is
   served at `admin.awdrent.co.za` by the same container. (If your Coolify
   version will not accept a wildcard domain, add a Traefik router label with
   ``HostRegexp(`{sub:[a-z0-9-]+}.awdrent.co.za`)`` on the `web` service instead.) Map
   `files.awdrent.co.za` to the `seaweedfs` service's port 8333 (the S3 API;
   browsers only ever reach it through signed links). Do **not** expose
   Postgres, Redis, ClamAV or SeaweedFS's other ports (9333, 8080, 8888)
   publicly; remove the `ports:` lines in production, or override them in
   Coolify.
5. **DNS at Afrihost.** Add `A` records for `awdrent.co.za` and `*.awdrent.co.za`
   pointing at the server.
6. **Wildcard TLS, by CNAME delegation (decision D28).** A certificate for
   `*.awdrent.co.za` needs a DNS-01 challenge, and Afrihost has no DNS API.
   DNS stays at Afrihost; only the challenge record is delegated to a zone
   Traefik can update, so renewals stay automatic:
   - Create a free Cloudflare account and add a zone just for
     `acme.awdrent.co.za` (or run [acme-dns](https://github.com/joohoi/acme-dns)).
     At Afrihost, add `NS` records for `acme.awdrent.co.za` pointing at the
     two Cloudflare name servers it assigns.
   - At Afrihost add: `_acme-challenge.awdrent.co.za CNAME _acme-challenge.acme.awdrent.co.za`
     (or the target acme-dns gives you).
   - In Coolify's Traefik configuration, enable the DNS challenge for the
     Cloudflare provider with an API token limited to *Zone.DNS:Edit* on the
     `acme.awdrent.co.za` zone, and request `awdrent.co.za` plus `*.awdrent.co.za`.
   - Check the first certificate is issued, and check its renewal date a month later.
7. **Deploy.** Coolify builds both images. `migrate` runs the migrations and
   exits, and then `web` and `worker` start. Check `https://admin.awdrent.co.za/api/health`.
8. **First platform admin.** In Coolify open a terminal on the `worker`
   container and run
   `DATABASE_OWNER_URL=postgres://awdrent_owner:…@postgres:5432/awdrent node --import tsx packages/db/src/create-platform-admin.ts --email … --name "…"`.
9. **First agency.** Sign in at `admin.awdrent.co.za`, set up 2FA, create the
   agency. Its admin receives an invite email.

**Document storage** is a single-node SeaweedFS (decision D25), started by
`docker/seaweedfs/entrypoint.sh`. The bucket is private, so anonymous
requests are refused, and file contents are encrypted at rest. The per-file
encryption keys live in SeaweedFS's own metadata in the same `/data` volume,
so a backup must take the whole volume, not only the `*.dat` files.

## Operations

- **Backups** (spec): a nightly `pg_dump` of the `awdrent` database and a
  copy of the documents, kept off-site for 30 days. Use Coolify's scheduled
  database backups, and for documents either snapshot the `seaweeddata`
  volume or sync the bucket with an S3 tool (`rclone sync`) to an off-site
  bucket. Test a restore monthly. **The `ENCRYPTION_KEYS` and
  `BLIND_INDEX_KEY` values must be backed up separately from the database.**
- **Key rotation**: add a new `version:key` to `ENCRYPTION_KEYS`, set
  `ENCRYPTION_ACTIVE_KEY_VERSION` to it and redeploy. New writes use the new
  key and old values still decrypt. A re-encryption job is still to do, before
  the old key can be removed.
- **Suspending an agency** (platform console) signs all of its staff out at
  once; no data is deleted.
- **Support access**: from the agency's page in the console. Sessions are
  read-only for 60 minutes unless write access is confirmed, and every page
  viewed appears in the agency's own audit log.
