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

For dashboard development, run the backend on port 4177 and then run `npm run dev:client` in a second terminal. Vite forwards `/api` calls to the backend.

The central database stores each import run, including its requested limit, time, status and counts. Artists are keyed by their MusicBrainz ID, so repeated imports update existing rows instead of creating duplicates.

The importer browses artist records linked to Lithuania's MusicBrainz area and keeps records whose main associated country is `LT`. This supports paging beyond the 500-result cap on MusicBrainz search queries. The limit can be set from 1 to 1,000 matching artists. Requests are made in pages of at most 100 and separated by at least 2 seconds. The last request time is persisted so restarting Seeker does not immediately issue another request. HTTP 503 responses are retried with backoff.

Set `PORT` to change the local port. `SEEKER_USER_AGENT` can override the default API user-agent string (`Seeker/0.1.0`).

The Vilnius Events page imports concert and festival candidates from the site's WordPress REST API. Imports use pages of 50, wait at least 3 seconds between requests, time out after 20 seconds, and retry temporary errors and rate limits with backoff. Progress and each completed page are saved centrally. Continuing an import also rechecks the newest and preceding pages; this overlap reduces, but cannot eliminate, omissions when the source changes between runs. Refresh newest page does not move the import position. The source's publication date is not the event date, and its categories include non-music events. Review candidates using Music, Not music or Unsure. Unknown dates are separate from upcoming events. Lists are filtered and paginated on the server, and artist suggestions are calculated only when opening an event.

The detail lookup checks up to 10 event pages at a time using the same pacing. Refreshing the oldest checks revisits already checked pages, while the standard detail action checks records that need it. “Refresh all event details” checks every saved Vilnius Events record in a background job and reports the number completed. Each event is saved as it finishes, so completed updates remain if the job fails or Seeker stops; starting another refresh-all job checks the catalogue again from the beginning. Missing or ambiguous values remain available for review. Edits are protected per field on future refreshes; for edits made before field-level tracking, all fields remain protected because the original edited fields are unknown. Artist matches remain suggestions until accepted.

Event details also include the source's optional “Apie renginį” link, which can point to a Facebook event or another website. Existing events need one details lookup to collect this link; use “Get details for 10 events” or open an event and refresh its details individually.

The catalogue stores canonical `events` and linked `event_sources`. Original Vilnius Events records are also retained and central writes update both representations. The current importer and editor operate on Vilnius Events; additional source adapters and a merge workflow are future work. Potential matching events can be queried, but are never merged automatically.

The events page can preview and import Avilys Vilnius music candidates. Select a starting page and a limit of 1–200 events; each page contains up to 20. Imports run locally as centrally leased jobs and save candidates with review status Unsure. Run the same page again to refresh source data without overwriting reviewed event fields. The start page is manual, and a partial page should be rechecked on the next run. Events with changed details require manual review. Avilys dates and raw timestamps need verification: the imported time is left blank. Free/paid flags without a numeric price remain unknown. Images are not downloaded. Possible duplicates are suggestions only; there is no merge workflow. Only events marked Music appear in Dracula. Deploy the corresponding API changes before using this importer against a hosted API.

Import and detail jobs are recorded centrally and run while the dashboard is closed as long as the local Node server remains running. An expired job lease is marked interrupted when another job starts; completed pages remain saved. Each source retains its own pacing and retry behavior.

Hostinger shows daily automated backups and lists `u334322641_d_staging` among databases available for backup. On 2026-11-17, a database backup shown as 2026-11-16 21:00 was downloaded and restored into a separate local MariaDB 11.4 schema: 17 tables, 100 events, 3,012 artists, 100 event sources and 100 image records were present. A local API returned the restored public catalogue. This did not test image recovery: the image directory is outside the API site's `public_html`, and its inclusion in Hostinger backups remains unverified. Confirm image backup coverage and test restoration before relying on it for recovery.

For a recovery drill, download the intended database backup from Hostinger and verify its date and source. Restore it only to a new, explicitly identified disposable MariaDB database, never the live database. The dump may contain destructive table statements. Check the restored tables and row counts, then run the API against the isolated database. Restore the corresponding image files to a separate directory, compare them with `vilnius_images`, and test image serving as well. Keep downloaded backups private and out of Git. A successful database-only restore does not prove that the images can be recovered.

`npm start` runs Seeker locally against the central API using `CENTRAL_API_URL` and `CENTRAL_API_TOKEN`. These settings are stored in the ignored `.env.central` file, which central mode loads before `.env`; shell environment variables take precedence. Keep that file and its token private. The server connects event and artist dashboards, event imports, detail refresh, image jobs, MusicBrainz imports and AI evaluations to the API; unsupported routes fail closed and it never opens SQLite. Seeker keeps the token out of browser code, requires HTTPS except on localhost, and never automatically retries an uncertain write. Hosted event and artist reads, review writes, and a bounded live import of 20 new Vilnius Events records have been verified. That import left the normal page cursor unchanged; the standard next-page workflow and live AI runs have not yet been verified end to end.

The experimental `sources/central-vilnius-run.ts` combines source-page fetching with transactional API imports and optional image uploads. It coordinates the minimum interval between requests through MariaDB and honors retry delays. Dashboard jobs use a lease and save progress centrally; an expired lease is marked interrupted when another job starts. If an image fails, the job fails visibly while already imported pages remain saved. The normal dashboard job path has been tested with a simulated source and disposable MariaDB; a bounded live import used the shared importer and central job lease.

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

The **Dracula export** filter shows which events are ready for the public app and why others are excluded. Ready events are marked Music and either have an unknown date or have not ended in Vilnius. Artist matches, images and an original event link are optional. The public API reads the central data without requiring a snapshot export.

Assistant-reviewed events can be found with **Assistant review → Needs my check**. Their review notes are shown on each event; use **Mark as checked** after reviewing. Music events remain eligible for export before your check if they meet the existing date rules.

Event prices are read from VN event pages during detail lookups. The displayed source text is saved with a free, paid or unknown classification; ambiguous, mixed or missing prices remain unknown. Use the Price filter to find free or paid events. To populate existing records, use **Refresh all event details** after restarting Seeker. Requests are paced, and unavailable pages cannot be refreshed.
