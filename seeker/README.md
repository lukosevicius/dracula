# Seeker

Local dashboard for collecting and reviewing events and Lithuanian-associated artists. It uses the central Hostinger API and MariaDB database.

## Run

Requires Node.js 22.16 or newer. Install dependencies once:

```sh
npm install
```

```sh
npm start
```

Open <http://127.0.0.1:4177>.

The dashboard uses React, TypeScript and Vite. `npm start` builds the server and dashboard before starting the local Node server. Run `npm run typecheck` to check types, or `npm test` to build and run the tests.

For local development, run `npm run dev` and open <http://127.0.0.1:4177>. Vite forwards `/api` calls to the local Node server on port 4178. This uses the same central API as hosted Seeker.

## Deploy hosted Seeker

In Google Auth Platform, create a dedicated OAuth client of type **Web application**, with `https://seeker.dracula.lt/auth/google/callback` as its authorized redirect URI. Seeker requests only `openid` and `email`, which Google allows while the project is in Testing.

The **Publish Seeker release** GitHub Actions workflow runs when Seeker or its deployment files change on `main`. It tests the revision, packages tracked Seeker source, and deploys to the existing `seeker.dracula.lt` Node.js app. The workflow reuses `HOSTINGER_API_TOKEN` and `HOSTINGER_SSH_USER` from the `production-api-migrations` GitHub environment. It verifies the live commit, signed-out access, and install manifest. To retry from the latest `main`, open the workflow in Actions and select **Run workflow**.

The package excludes the legacy root `public/` directory, which Hostinger can serve before Node checks the session. It includes `client/public/` for the install manifest and icons. Keep these runtime variables in the hosting dashboard:

| Variable | Value |
| --- | --- |
| `SEEKER_PUBLIC_ORIGIN` | `https://seeker.dracula.lt` |
| `SEEKER_GOOGLE_CLIENT_ID` | The dedicated Google web OAuth client ID |
| `SEEKER_GOOGLE_CLIENT_SECRET` | The dedicated Google web OAuth client secret |
| `SEEKER_GOOGLE_EMAIL` | The exact Gmail address authorized for Seeker |
| `SEEKER_SESSION_SECRET` | A random secret generated with `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"` |
| `CENTRAL_API_URL` | `https://api.dracula.lt` |
| `CENTRAL_API_TOKEN` | The existing Dracula API admin token, entered as a runtime secret |

Hosted Seeker verifies Google's ID token, then starts an eight-hour session with a Secure, HttpOnly cookie. The hosted server checks the hostname, protects private pages and API routes, and requires a same-origin `Origin` header on writes. Use valid HTTPS and keep Hostinger CDN caching disabled for Seeker. `npm run dev` and `npm start` keep the local server on loopback. Hosted Seeker can read and edit events, queue AI verification, and see shared job history. Start source imports and background source refreshes from local Seeker. Set `SEEKER_HOSTED_IMPORT_WORKER=1` on the hosted Seeker process only after checking that the host keeps source jobs running through normal requests and restarts.

Seeker can be installed from the sign-in page or dashboard. Only the install metadata and icons are public assets. The installed app requires a connection and uses the same Google sign-in as the website.

Before relying on the hosted copy, verify that a signed-out browser and a different Google account are denied, and that direct requests to the Hostinger URL cannot load the dashboard or `/api/events`. With the approved account, check the event list and confirm an authorized edit appears locally on refresh.

The central database stores each import run, including its requested limit, time, status and counts. Artists are keyed by their MusicBrainz ID, so repeated imports update existing rows instead of creating duplicates.

The importer browses artist records linked to Lithuania's MusicBrainz area and keeps records whose main associated country is `LT`. This supports paging beyond the 500-result cap on MusicBrainz search queries. The limit can be set from 1 to 1,000 matching artists. Requests are made in pages of at most 100 and separated by at least 2 seconds. The last request time is persisted so restarting Seeker does not immediately issue another request. HTTP 503 responses are retried with backoff.

Set `PORT` to change the local port. `SEEKER_USER_AGENT` can override the default API user-agent string (`Seeker/0.1.0`).

The Vilnius Events page imports concert and festival candidates from the site's WordPress REST API. Imports use pages of 50, wait at least 3 seconds between requests, time out after 20 seconds, and retry temporary errors and rate limits with backoff. Progress and each completed page are saved centrally. Continuing an import also rechecks the newest and preceding pages; this overlap reduces, but cannot eliminate, omissions when the source changes between runs. Refresh newest page does not move the import position. The source's publication date is not the event date, and its categories include non-music events. Set each candidate's event type: Music, Festival, Other or Unsure. Music and festival events can be published in Dracula; the type is not shown to visitors. Unknown dates are separate from upcoming events. Lists are filtered and paginated on the server, and artist suggestions are calculated only when opening an event.

The detail lookup checks up to 10 event pages at a time using the same pacing. Refreshing the oldest checks revisits already checked pages, while the standard detail action checks records that need it. “Refresh all event details” checks every saved Vilnius Events record in a background job and reports the number completed. Each event is saved as it finishes, so completed updates remain if the job fails or Seeker stops; starting another refresh-all job checks the catalogue again from the beginning. Missing or ambiguous values remain available for review. Edits are protected per field on future refreshes; for edits made before field-level tracking, all fields remain protected because the original edited fields are unknown. Artist matches remain suggestions until accepted.

Event details also include the source's optional “Apie renginį” link, which can point to a Facebook event or another website. Existing events need one details lookup to collect this link; use “Get details for 10 events” or open an event and refresh its details individually.

The catalogue stores canonical `events` and linked `event_sources`. It retains the original Vilnius Events records and API writes keep the editable fields in sync. Avilys and Vilnius Events share the same review and publication workflow. When a newly imported listing confidently matches an event from the other source, it joins that event instead of creating a duplicate. The first source keeps its values, and the new listing only fills empty fields. **Possible duplicates** lists the remaining upcoming pairs. **Merge…** previews the merged event field by field; where the listings differ, choose the value to keep before confirming. By default a venue name beats a street address, a known price beats an unknown one, and otherwise the kept event's value stays. Pairs whose values really disagree, such as two different prices, are marked **Values differ**. **Merge N without differences** merges every confident pair that has none. **Not a duplicate** hides a pair. Merging keeps the Live event, then an edited one, then the older one; the other event's link redirects to it. A value chosen from the removed event is protected from later source refreshes. Two listings from the same source cannot be merged: unpublish the extra listing instead.

The Avilys page previews and imports Vilnius music candidates through a centrally leased job. Select a starting page and 1–200 events. Each page contains up to 20. Reimport a partial page to pick up the rest. Avilys start times are Vilnius wall time, including timestamps ending in `Z`. The importer preserves reviewed fields on refresh and downloads available source images.

Import and detail jobs are recorded centrally and run while the dashboard is closed as long as the local Node server remains running. An expired job lease is marked interrupted when another job starts; completed pages remain saved. Each source retains its own pacing and retry behavior.

Hostinger shows daily automated backups and lists `u334322641_d_staging` among databases available for backup. On 2026-11-17, a database backup shown as 2026-11-16 21:00 was downloaded and restored into a separate local MariaDB 11.4 schema: 17 tables, 100 events, 3,012 artists, 100 event sources and 100 image records were present. A local API returned the restored public catalogue. This did not test image recovery: the image directory is outside the API site's `public_html`, and its inclusion in Hostinger backups remains unverified. Confirm image backup coverage and test restoration before relying on it for recovery.

For a recovery drill, download the intended database backup from Hostinger and verify its date and source. Restore it only to a new, explicitly identified disposable MariaDB database, never the live database. The dump may contain destructive table statements. Check the restored tables and row counts, then run the API against the isolated database. Restore the corresponding image files to a separate directory, compare them with `vilnius_images`, and test image serving as well. Keep downloaded backups private and out of Git. A successful database-only restore does not prove that the images can be recovered.

`npm start` runs Seeker locally against the central API using `CENTRAL_API_URL` and `CENTRAL_API_TOKEN`. These settings are stored in the ignored `.env.central` file, which central mode loads before `.env`; shell environment variables take precedence. Keep that file and its token private. The server connects event and artist dashboards, event imports, detail refresh, image jobs, MusicBrainz imports and AI evaluations to the API; unsupported routes fail closed and it never opens SQLite. Seeker keeps the token out of browser code, requires HTTPS except on localhost, and never automatically retries an uncertain write. Hosted event and artist reads, review writes, and a bounded live import of 20 new Vilnius Events records have been verified. That import left the normal page cursor unchanged; the standard next-page workflow and live AI runs have not yet been verified end to end.

The experimental `sources/central-vilnius-run.ts` combines source-page fetching with transactional API imports and optional image uploads. It coordinates the minimum interval between requests through MariaDB and honors retry delays. Dashboard jobs use a lease and save progress centrally; an expired lease is marked interrupted when another job starts. If an image fails, the job fails visibly while already imported pages remain saved. The normal dashboard job path has been tested with a simulated source and disposable MariaDB; a bounded live import used the shared importer and central job lease.

## Scheduled imports

Imports run twice a day without anyone opening Seeker. Vilnius Events refuses requests from GitHub's servers (HTTP 403), so the work is split:

- **GitHub** — the **Scheduled import** workflow imports every upcoming Avilys event and merges confident duplicates once a day at 05:00 Vilnius winter time (03:00 UTC). It uses the `production-imports` environment with the `CENTRAL_API_TOKEN` secret and the optional `CENTRAL_API_URL` variable (default `https://api.dracula.lt`). Start a run by hand from **Actions → Scheduled import → Run workflow**.
- **Your Mac** — a launchd agent runs `scripts/vn-import.sh` at 12:00 and 18:00, never at night. It fetches the Vilnius Events list (the two newest pages on the first run of the day, otherwise the newest page), refreshes the details of upcoming listings not checked in the last 20 hours, handles removed listings and merges confident duplicates. A run missed while the Mac was closed runs when it next wakes; nothing runs while it is off. It uses the checked-out code and `.env.central`, logs to `~/Library/Logs/dracula-vn-import.log` and shows a macOS notification when a run fails.

A Vilnius Events listing that now redirects to the site's home page was taken down. A draft is deleted, a listing that shares its event with another source is detached, and a live event is unpublished and placed in **Needs attention** for you to decide. Vilnius Events also redirects the pages of events that are over, so a redirecting draft that is past or has no date is always deleted. If more than 10% of the checked listings (at least 3) are other removals, those are left alone and the run fails. A removed listing is remembered, so an import does not add it back while the source's list still shows it. Vilnius Events listings in the Festivaliai category stay **Draft** even with a date, because that category also holds festivals that are not music. An image larger than 3 MB is replaced by a smaller size, because the API host rejects larger uploads, and an image that still fails does not stop the import.

Each step is retried once after a minute if the API was briefly unreachable. Jobs share Seeker's leases, so a run fails instead of overlapping a job started from Seeker.

```sh
scripts/install-vn-schedule.sh               # install or update the Mac schedule
launchctl kickstart gui/$(id -u)/lt.dracula.vn-import   # run it now
scripts/install-vn-schedule.sh --uninstall   # remove it
scripts/vn-import.sh full                    # one-off catch-up: ten Vilnius Events list pages
node dist/scheduled-import.js quick          # both sources by hand (after npm run build:server)
```

## AI verification and publication

New events enter Seeker as **Unsure**. An import with a date goes **Live** at once; one without a date stays **Draft** until an import finds its date. Publication you set by hand is never changed by an import. Both event import forms start with **Verify with AI after import** checked unless you save a different default under **Settings → Event imports**. You can override the default on either import form. Verification runs in the central API when the source job releases its lease. It covers new events and meaningful source changes. The import itself still succeeds if verification is unavailable. The Vilnius Events worker attempts the usual detail lookup for each changed event before releasing the import lease.

Under **Settings → AI providers**, add one or more Gemini or OpenAI connections with a model ID and API key. Use **Test** to check each connection and select a default for imports. Set `SEEKER_AI_ENCRYPTION_KEY` on the API server before adding connections. The API encrypts saved keys using this server secret. Keep the environment secret available across releases and backups so existing provider profiles can still be decrypted.

Use **Verify with AI** on an event or select up to 200 events for a batch. A manual run can select a different connection and disable automatic publication. Verification sends the listing text and structured event data to the selected provider.

Verification can fill an unpublished event’s missing fields when the source evidence supports the value. It can set the event type in clear cases: **Music**, **Festival** or **Other**. A clear upcoming music or festival event with a date can go **Live** automatically. Drafts that have landed in **Needs attention** require an explicit publication decision. Use **Approve**, **Edit and approve**, or **Dismiss** on the findings, then **Publish in Dracula** when ready. Live events stay public until explicitly unpublished. The **Other events** page lists events whose type is Other, and all event lists display publication and verification independently.

The **Event log** records imports, meaningful refreshes, AI verification outcomes, manual edits and publication changes. Migration 013 carries forward previously public music events as Live. They begin as **Not verified** and the migration records a carry-forward entry because historical publication times were unavailable.

## Agent access

Create a named credential in **Settings → Agent access** and choose the permissions for the agent. Save the secret when it is revealed. Connect over HTTPS using bearer authentication and the [Seeker OpenAPI contract](../api/openapi/seeker.openapi.json). After deployment the same contract is served at `GET /v1/seeker/openapi.json`.

For an MCP client, register `node` with the absolute path to `seeker/scripts/mcp.mjs` as its argument. Provide `SEEKER_AGENT_TOKEN` through the client's secret environment settings and set `SEEKER_API_URL` to an API origin if using a server other than `https://api.dracula.lt`. The adapter uses the same API as Seeker and exposes event search, event history, verification, import requests, findings, and publication as tools.

Agent source imports remain queued until a local Seeker process or enabled hosted source worker claims them. Verification runs on the central API. For import or verification retries, reuse the request key. For event changes, fetch the revision and pass it with the requested action. The credential needs both verification and publication permissions for verification to publish automatically.

## AI event evaluation

Add your Gemini API key to `seeker/.env` (this file is excluded from git):

```env
GEMINI_API_KEY=your-api-key
```

Then start Seeker:

```sh
npm start
```

Seeker loads `.env` at startup. An environment variable already set in the shell takes precedence.

Open **AI evaluation** to select events individually or select the first N events, choose Gemini 3.5 Flash-Lite, Gemini 4 Hydrogen, or both, and set an estimated per-run USD budget. Analysis runs as a background job and saves each model result centrally as it completes. The dashboard shows the latest 1,000 results; older results remain in the database. Re-running events sends new requests and may incur charges again.

Gemini receives the event title and description. Suggestions are separate from existing review decisions: use Accept to apply a classification or artist match. Performer matches are exact normalized matches against local artist names and aliases; evidence is marked when it cannot be verified in the event text. No web search is used. Event descriptions over 30,000 characters are truncated for analysis.

Before each generation, Seeker asks Gemini to count input tokens and reserves the configured maximum output tokens at the listed standard model prices. It stops when this estimated reservation would exceed the run budget. This is not a provider-enforced spending cap: prices can change, requests with unknown outcomes can incur charges, and account taxes or other charges are excluded. Check Google billing and configure provider limits separately. Seeker stops if generation usage is unavailable or the request fails after being sent, because its actual charge may be unknown. The prices in `database/ai-evaluation.ts` must be updated when Google changes them.

Vilnius Events imports can optionally download featured images. Enable “Download images with imports”, or use “Download missing event images” to process existing events. Images are stored on Hostinger outside the deployment directory; their metadata is stored in MariaDB. Source alt text is not imported. Requests use the same minimum 3-second spacing, retries and timeouts as the event importer. Failed images can be retried with the download button.

The **Dracula feed** filter uses Live status and the current Vilnius date. A Live event with a date that has passed remains accessible at its public event URL. Older assistant review notes can still be found with **Assistant review → Needs my check**.

Event prices, start and end times are read from VN event pages during detail lookups, using the page's schema.org event data when it is present. The displayed source text is saved with a free, paid or unknown classification; ambiguous, mixed or missing prices remain unknown. Use the Price filter to find free or paid events. To populate existing records, use **Refresh all event details** after restarting Seeker. Requests are paced, and unavailable pages cannot be refreshed.
