# Dracula public API (migration in progress)

## NestJS foundation

The deployed NestJS app exposes `GET /health`, public event and image endpoints, and authenticated Seeker routes, and checks the MariaDB connection at startup. NestJS uses TypeScript implementations for admin operations, imports, jobs, image uploads, enrichment and AI. The TypeScript migration runner is compiled with the API and runs independently.

Configure the environment variables in `.env.example` before starting the NestJS app. From `api/`:

- `npm run build` builds TypeScript to `dist/`.
- `npm start` runs the built NestJS app; build first.
- `npm run dev:nest` runs the NestJS app with source watching.
- `npm run typecheck:nest` checks TypeScript without emitting files.
- `npm run typecheck:tests` builds API declarations and strictly checks the TypeScript test files against them.
- `npm run test:nest` builds and runs the NestJS checks, including public and admin route contract checks and admin edits using isolated fixtures. For a real MariaDB connection, use `npm run test:mariadb` as described below.

The TypeScript test files run through `tsx` and are checked separately using `typecheck:tests`.

The NestJS health endpoint reports process health, not ongoing database connectivity. The database connection is checked at startup and the pool is closed on application shutdown.

The API is deployed at `https://api.dracula.lt` against the Hostinger MariaDB database. The live Dracula client reads its public endpoints, and local Seeker uses bearer-token-protected administrative endpoints. On 2026-11-19, Seeker read the live catalogue, saved and restored an event review, and completed a bounded Vilnius Events sample import of 10 new records through NestJS. The sample left the normal import cursor unchanged; the standard next-page workflow and live AI jobs have not yet been verified end to end.

The API expects MariaDB tables equivalent to the current Seeker catalogue. `GET /v1/events?filter=upcoming&offset=0&limit=30` returns `{items, total, nextOffset}` with filtering before pagination. Filters are `upcoming`, `today`, `tomorrow`, `weekend`, `custom`, `all`, `past`, and `unknown`. A custom filter requires `from=YYYY-MM-DD` and accepts an optional `to`. The legacy `after` cursor form remains available. `GET /v1/events/:id` returns a single public event. `GET /v1/images/:filename` serves an image only while it belongs to a currently public event. `GET /health` reports that the process is running; it does not verify an ongoing database connection.

Like the former export, the public catalogue includes events marked `music` with an unknown date or an end date on or after today in Vilnius. It excludes past events and reviews marked unsure or not music. Consequently, the `past` filter currently returns no events. Event responses include a hosted `image_url`.

Run `npm install` and `npm test` in this folder. Tests use an isolated SQLite fixture to exercise query logic and HTTP routes. A verified backup was imported into the Hostinger MariaDB staging database, with row counts and SHA-256 comparisons matching all 15 tables at import. The Node migration script, API process, prepared statements, protected edits and a Vilnius Events page import have also been tested against a disposable local MariaDB 11.4 instance. Hostinger serves public event data and an image directly; cross-site image requests from a local web preview encountered Hostinger's CDN challenge.

`npm run test:mariadb` builds NestJS and runs the API integration checks against a disposable MariaDB database. It requires `MYSQL_TEST_HOST`, `MYSQL_TEST_PORT`, `MYSQL_TEST_USER`, `MYSQL_TEST_PASSWORD` and `MYSQL_TEST_DATABASE`; the database name must end in `_test` and the database must be empty. The test creates schema and fixture rows and leaves them in place, so use a fresh disposable database for each run. Never use a staging or production database for this test. This test is skipped by the normal `npm test` command unless `RUN_MARIADB_INTEGRATION=1` is set.

Configure the variables in `.env.example` in the hosting environment; never put credentials in the client. `IMAGE_DIR` must point to durable storage outside the deployment directory. `PUBLIC_BASE_URL` is the public API origin. Keep the database private and the administrative token secret.

On Hostinger managed Node.js hosting, do not put `IMAGE_DIR` in `hbuilds/` or `public_html`: [Hostinger documents that these directories are overwritten by deployments](https://www.hostinger.com/support/how-to-deploy-a-node-js-website-in-hostinger/). Verify that the private image directory is included in backups. Use `127.0.0.1` for a Hostinger database connection as described in [Hostinger's Node.js database guide](https://www.hostinger.com/support/connecting-a-hostinger-mysql-database-to-a-node-js-application/). The API deploy package must not include `.env`, tokens, backup databases, or `node_modules`.

## API deployment automation

The `Publish API release` GitHub Actions workflow runs checks for API or deployment-workflow changes pushed to `main`, or when started manually on `main`. The release job compares the tested revision with current `main`, then applies and verifies pending production migrations through the SSH tunnel. A migration failure or invalid history blocks the release before the branch advances. After verification the job advances `api-deploy` with a non-force push. Hostinger builds this branch. The workflow waits up to 15 minutes for Hostinger to report a completed build of the exact commit, verifies the live API source fingerprint via `/version`, and checks the live events response. A failed verification does not roll back the release. Hostinger's build history reports the commit; the fingerprint verifies the API source, package files and TypeScript settings actually serving traffic, but is not a cryptographic attestation of every deployed dependency or asset.

The release job uses the existing `production-api-migrations` environment and its SSH and database settings below. Add a `HOSTINGER_API_TOKEN` secret to that same environment; the token must allow reading Node.js builds for this hosting account. Hostinger tokens inherit the issuing user's permissions, so use the least privileged account available, set an expiration, and rotate it as needed. Missing credentials or unavailable Hostinger/database access stop publication. Review migration compatibility and backups before merging. The manual database workflow remains available for operations such as inspecting migration status and baselining a database. The release branch should only be advanced by this workflow; do not force-push it. Hostinger must remain connected to `api-deploy`, with Node 22.x, npm, root directory `api`, build command `npm run build`, and entry file `dist/main.js`. Keep images outside deployment directories. Source fingerprinting requires Hostinger to retain the API source files during its build. Check images and the client separately; the smoke check only covers the public events API.

Authenticated endpoints cover the private event list, editor data, image reads and uploads, reviews, details, artist decisions, manual prices, assistant-review confirmation, job leases, MusicBrainz and Vilnius Events imports, and AI evaluation results. They are disabled unless a server-side `ADMIN_TOKEN` is configured, require a bearer token, and update related records in a transaction. Use a long, randomly generated URL-safe ASCII token, never expose it in Expo or browser code, and require HTTPS outside local development. Dedicated rate limiting for administrative requests is not yet implemented; protect and rotate the token if exposed.

## User authentication

User authentication is separate from the Seeker admin token. It remains disabled unless both `GOOGLE_CLIENT_ID` and `AUTH_ORIGINS` are set, and requires migrations `006`, `007`, and `008`. Set `AUTH_ORIGINS=https://app.dracula.lt` in production. For a local API use `AUTH_ORIGINS=http://localhost:8081` and a localhost `PUBLIC_BASE_URL`. Do not add local development origins to production. Configure the same Google web client ID in the API and the web client.

The web client must send requests with credentials. It calls `POST /v1/auth/challenge` and passes the returned nonce to Google Identity Services, then posts `{ "credential": "<Google ID token>" }` as JSON to `/v1/auth/google`. A short-lived HttpOnly challenge cookie binds the nonce to the browser; the API verifies the Google ID token and consumes the challenge once. A successful login sets an HttpOnly, host-only session cookie, secure when the API origin uses HTTPS. `GET /v1/me` reads the profile, `PATCH /v1/me` accepts `{ "displayName": "..." }`, and `POST /v1/auth/logout` revokes the current session. Mutating routes require an allowed `Origin`; authenticated responses are not cached. The Google client secret is not needed for this flow.

`DELETE /v1/me` requires the same trusted-origin check and an active session; it deletes the user, linked identities and all sessions, and clears the current cookie. Google account data and any existing backups are outside that deletion operation. Sign-in challenge and login requests have separate shared, database-backed limits of 300 and 150 attempts per minute respectively. These are global limits, not per-user or per-IP limits: one source can exhaust a bucket for everyone. Configure additional edge rate limiting using Hostinger's actual client-IP handling before public launch. Authentication fails closed if its rate-limit table is unavailable. Expired and revoked session rows are removed opportunistically when a new sign-in challenge is created, not on a fixed schedule.

The client UI and real Google sign-in have not yet been verified end to end. The draft privacy notice at `docs/user-privacy-draft.md` requires verified controller contact details and backup retention before publication.

The hosted image files are stored outside the deployment directory. One image was retrieved successfully after a redeployment; the files have not been individually verified against a checksum manifest. Verify that Hostinger backups include the image directory and test restoration.

## Database migrations

`006-user-accounts.sql` adds the foundation for user profiles, linked identities, and revocable sessions. Provider subjects use case-sensitive comparison, and session hashes are stored as 32-byte binary values; application code must hash session secrets before saving them and handle session dates in UTC. Deleting a user cascades to their identities and sessions. Email is not stored. This migration does not enable sign-in or create any user accounts.

`009-saved-events.sql` adds account-specific saved events. Apply it before deploying the API and client versions that use saved-event endpoints. Guest saves are merged into the signed-in account on the next client load.

`010-seeker-preferences.sql` adds Seeker's database-backed saved events and a JSON key-value table for future Seeker settings. Apply it before deploying API or Seeker versions that use these endpoints. Seeker preferences are installation-wide and are managed through the protected admin API.

`011-event-interest-score.sql` adds an `interest_score` to events. Existing and newly imported events default to 1; Seeker can set scores from 1 to 5. Apply it before deploying API or Seeker versions that read or write the score.

`012-followed-artists.sql` creates account-specific artist follows. Apply it before deploying API and client versions that use artist following. Guest follows are merged after sign-in. The public artist endpoint and event artist filter require the updated API, so deploy the API before the updated client.

Migration `013-event-verification.sql` separates Draft and Live from music classification. Apply it before shipping the API and Seeker changes. Pause edits that change the old Music visibility rule during the migration and API rollout. The migration carries existing public events forward as Live and defaults new events to Draft. Configure `SEEKER_AI_ENCRYPTION_KEY` on the API server before saving provider connections. Use [Seeker’s setup guide](../seeker/README.md) to configure models and agent credentials.

`018-event-merges.sql` lets one event keep listings from several sources. It adds `event_sources.is_secondary`, an `event_redirects` table for merged event IDs, and `event_duplicate_dismissals` for pairs marked as different events. Apply it before deploying the API version that imports or merges with these tables. When an import finds a confident match from another source (same comparable title and date, and the same start time or venue, with no conflicting venue names), the new listing joins the existing event as a secondary source. A secondary source only fills empty fields. Merging moves sources, prices, artist decisions, images, saved events and history onto the kept event and deletes the other one. Its ID redirects in `GET /v1/events/:id` and when saving events.

Schema changes are separate from API deployment. `migrations/001` through `003` describe changes already included in `schema.sql`. They must not be replayed against an existing catalogue. API migration history is recorded separately in `api_schema_migrations`; the older `schema_migrations` table belongs to Seeker and is not modified.

Apply `004-event-city.sql` before deploying the API version that writes `events.city`. Pause event imports between the migration and deployment so the old API cannot add rows without a city after the backfill. The migration assigns `Vilnius` to existing Vilnius Events records and reads the city from stored Avilys metadata. The column is nullable for events whose city is unknown.

The runner requires `DB_HOST`, `DB_PORT` (defaults to 3306), `DB_USER`, `DB_PASSWORD`, and `DB_NAME` in the environment. Do not place these values in Git or command-line arguments. Commands from `api/`:

- `npm run migrate -- status`: inspect known applied and pending migrations; it never creates a table or changes schema.
- `npm run migrate -- check`: read and validate migration history, failing if anything is pending, incomplete, changed or missing. This is the release gate and does not apply migrations.
- `npm run migrate -- baseline`: one-time initialization for an existing catalogue whose first three historical changes have already been applied. It checks the relevant auto-increment columns, lease table columns and foreign keys, and historical file checksums before recording 001–003. This is a targeted check of those changes, not a full schema comparison. Take and verify a database backup and inspect the database and pending list before baselining.
- `npm run migrate -- up`: apply pending migrations in numerical filename order, after a successful baseline. Migrations are immutable once applied; the runner verifies SHA-256 hashes and rejects missing or out-of-order history. Use three-digit filenames such as `004-description.sql`, never change a previously applied file, and review SQL before use.

The runner serializes its own operations using a MariaDB advisory lock. MariaDB DDL can implicitly commit, so it is not generally transactional: if SQL fails or the process is interrupted, the history remains `applying` and later runs stop. Inspect the live schema, the failed SQL, logs and backup; plan and perform a safe repair before manually reconciling the history. Do not blindly delete the marker or retry. Other tools can still alter the database outside this lock. Plan expand/contract changes so both the current and next API versions remain compatible during a deployment.

### Manual GitHub workflow

`.github/workflows/migrate-api.yml` is a manually dispatched workflow on `main`. Project checks, including disposable MariaDB integration tests, must pass before the production job runs. Choose `status`, `baseline` (once, after verification), or `up`. It connects to MariaDB at Hostinger's `127.0.0.1:3306` through a host-key-verified SSH tunnel; it does not expose the database publicly. It does not run automatically on a push or deploy API code. Ensure the selected `main` commit is compatible with the API version currently deployed, and back up before any write.

Configure GitHub environment `production-api-migrations` with variables `HOSTINGER_SSH_HOST`, `HOSTINGER_SSH_PORT`, `HOSTINGER_SSH_USER`, and `HOSTINGER_SSH_FINGERPRINT`, and secrets `HOSTINGER_SSH_PRIVATE_KEY`, `MIGRATION_DB_USER`, `MIGRATION_DB_PASSWORD`, and `MIGRATION_DB_NAME`. Repository-level variables/secrets with those names also work. Use a database account with the required schema privileges; never print credentials or add them to a workflow log. Existing `production-web` environment secrets are not automatically shared with another environment. If this GitHub plan supports environment protection, configure required reviewers for the production environment. Confirm the SSH account permits local TCP forwarding and that Hostinger's database is reachable at loopback before relying on this workflow. The production baseline and the GitHub-to-MariaDB connection must be verified separately; adding the workflow file does not run either.

Run integration tests only against an empty disposable database ending in `_test`: set the `MYSQL_TEST_*` variables documented above, then run `npm run test:mariadb`. This suite creates tables and leaves them in that disposable database; it must never point to production. CI creates a fresh MariaDB service for every run.

## Recovery and backup verification

On 2026-11-18 Hostinger showed daily automated backups, with a backup dated 2026-11-17 20:56, and the database `u334322641_d_staging` listed under that backup. This only shows a backup is available; it does not prove it is complete or restorable. The backup browser did not show the file listing during inspection, so inclusion of `/home/u334322641/dracula-images/images` remains unverified. Images are outside the app deployment directory, and must not be assumed to be included in website backups. Contact Hostinger or inspect a downloaded backup to establish coverage; arrange a separate backup of that directory if necessary.

For a recovery rehearsal, restore a selected private database backup into a new, isolated disposable MariaDB database, never the live one; SQL dumps may contain destructive statements. Restore image files into a separate disposable directory. Compare table counts and image filenames to `vilnius_images`, start a separate API pointed at the restored database and image directory, and verify event details and images. Retain no backup files in Git. A database-only restore does not prove image recovery. Previous database-only recovery is described in `seeker/README.md`; a current combined restore has not been verified.
