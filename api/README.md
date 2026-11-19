# Dracula public API (migration in progress)

## NestJS foundation

The NestJS app exposes `GET /health`, public event and image endpoints, and authenticated Seeker routes, and checks the MariaDB connection at startup. NestJS uses TypeScript implementations for admin operations, imports, jobs, image uploads, enrichment and AI. The existing JavaScript API and independently runnable JavaScript migration runner are retained during the transition. The deployed API remains on the previous entry point until the code and Hostinger settings are updated.

Configure the environment variables in `.env.example` before starting the NestJS app. From `api/`:

- `npm run build` builds TypeScript to `dist/`.
- `npm start` runs the built NestJS app; build first.
- `npm run dev:nest` runs the NestJS app with source watching.
- `npm run typecheck:nest` checks TypeScript without emitting files.
- `npm run test:nest` builds and runs the NestJS checks, including public and admin route comparisons and admin edits using isolated fixtures. For a real MariaDB connection, use `npm run test:mariadb` as described below.

The NestJS health endpoint reports process health, not ongoing database connectivity. The database connection is checked at startup and the pool is closed on application shutdown.

The API is deployed at `https://api.dracula.lt` against the Hostinger MariaDB database. The live Dracula client reads its public endpoints, and local Seeker uses bearer-token-protected administrative endpoints. Hosted event and artist reads, review writes, and a bounded live import of 20 new Vilnius Events records have been verified. The bounded import left the normal import cursor unchanged; the standard next-page workflow and live AI jobs have not yet been verified end to end.

The API expects MariaDB tables equivalent to the current Seeker catalogue. `GET /v1/events?filter=upcoming&offset=0&limit=30` returns `{items, total, nextOffset}` with filtering before pagination. Filters are `upcoming`, `today`, `tomorrow`, `weekend`, `custom`, `all`, `past`, and `unknown`. A custom filter requires `from=YYYY-MM-DD` and accepts an optional `to`. The legacy `after` cursor form remains available. `GET /v1/events/:id` returns a single public event. `GET /v1/images/:filename` serves an image only while it belongs to a currently public event. `GET /health` reports that the process is running; it does not verify an ongoing database connection.

Like the former export, the public catalogue includes events marked `music` with an unknown date or an end date on or after today in Vilnius. It excludes past events and reviews marked unsure or not music. Consequently, the `past` filter currently returns no events. Event responses include a hosted `image_url`.

Run `npm install` and `npm test` in this folder. Tests use an isolated SQLite fixture to exercise query logic and HTTP routes. A verified backup was imported into the Hostinger MariaDB staging database, with row counts and SHA-256 comparisons matching all 15 tables at import. The Node migration script, API process, prepared statements, protected edits and a Vilnius Events page import have also been tested against a disposable local MariaDB 11.4 instance. Hostinger serves public event data and an image directly; cross-site image requests from a local web preview encountered Hostinger's CDN challenge.

`npm run test:mariadb` builds NestJS and runs the legacy and NestJS API integration checks against a disposable MariaDB database. It requires `MYSQL_TEST_HOST`, `MYSQL_TEST_PORT`, `MYSQL_TEST_USER`, `MYSQL_TEST_PASSWORD` and `MYSQL_TEST_DATABASE`; the database name must end in `_test` and the database must be empty. The test creates schema and fixture rows and leaves them in place, so use a fresh disposable database for each run. Never use a staging or production database for this test. This test is skipped by the normal `npm test` command unless `RUN_MARIADB_INTEGRATION=1` is set.

Configure the variables in `.env.example` in the hosting environment; never put credentials in the client. `IMAGE_DIR` must point to durable storage outside the deployment directory. `PUBLIC_BASE_URL` is the public API origin. Keep the database private and the administrative token secret.

On Hostinger managed Node.js hosting, do not put `IMAGE_DIR` in `hbuilds/` or `public_html`: [Hostinger documents that these directories are overwritten by deployments](https://www.hostinger.com/support/how-to-deploy-a-node-js-website-in-hostinger/). Verify that the private image directory is included in backups. Use `127.0.0.1` for a Hostinger database connection as described in [Hostinger's Node.js database guide](https://www.hostinger.com/support/connecting-a-hostinger-mysql-database-to-a-node-js-application/). The API deploy package must not include `.env`, tokens, backup databases, or `node_modules`.

## API deployment automation

The `Publish API release` GitHub Actions workflow runs the project checks for API or deployment-workflow changes pushed to `main`, or when started manually on `main`. After the checks pass, it advances the `api-deploy` branch to that tested commit with a non-force push. For the NestJS release, configure the existing Hostinger Node.js app to deploy the `api` root directory from `api-deploy`, with Node 22.x, npm, build command `npm run build`, and entry file `dist/main.js`. Keep the existing environment variables and the image directory outside the deployment directory. Build dependencies are installed as production dependencies so the build can run when dev dependencies are omitted. Hostinger's actual settings and deployment must be verified; updating code here does not change hPanel.

This workflow publishes the release branch; Hostinger's GitHub integration must be connected and configured to deploy that branch. Verify that a branch update actually starts and completes a Hostinger deployment; a successful GitHub workflow alone does not establish that the API was deployed. Check `/health`, a public events request that reads the database, an event image, and the client afterward. Database migrations are a separate operation and are not run by this workflow. The release branch should only be advanced by this workflow; do not force-push it.

Authenticated endpoints cover the private event list, editor data, image reads and uploads, reviews, details, artist decisions, manual prices, assistant-review confirmation, job leases, MusicBrainz and Vilnius Events imports, and AI evaluation results. They are disabled unless a server-side `ADMIN_TOKEN` is configured, require a bearer token, and update related records in a transaction. Use a long, randomly generated URL-safe ASCII token, never expose it in Expo or browser code, and require HTTPS outside local development. Dedicated rate limiting for administrative requests is not yet implemented; protect and rotate the token if exposed.

The hosted image files are stored outside the deployment directory. One image was retrieved successfully after a redeployment; the files have not been individually verified against a checksum manifest. Verify that Hostinger backups include the image directory and test restoration.

## Database migrations

Schema changes are separate from API deployment. `migrations/001` through `003` describe changes already included in `schema.sql`. They must not be replayed against an existing catalogue. API migration history is recorded separately in `api_schema_migrations`; the older `schema_migrations` table belongs to Seeker and is not modified.

The runner requires `DB_HOST`, `DB_PORT` (defaults to 3306), `DB_USER`, `DB_PASSWORD`, and `DB_NAME` in the environment. Do not place these values in Git or command-line arguments. Commands from `api/`:

- `npm run migrate -- status`: inspect known applied and pending migrations; it never creates a table or changes schema.
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
