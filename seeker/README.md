# Seeker

Small local dashboard for importing Lithuanian-associated artist records from the MusicBrainz API into SQLite.

## Run

Requires Node.js 22.16 or newer. Install dependencies once:

```sh
npm install
```

```sh
npm start
```

Open <http://127.0.0.1:4177>.

The dashboard uses React, TypeScript and Vite. `npm start` builds the server and dashboard before starting the Node server. The SQLite database remains in `data`. Run `npm run typecheck` to check types, or `npm test` to build and run the tests. The React client, database modules and both importers are checked with strict TypeScript settings; the older HTTP server still uses relaxed implicit-any and null checks.

For dashboard development, run the backend on port 4177 and then run `npm run dev:client` in a second terminal. Vite forwards `/api` calls to the backend.

The SQLite database is created at `data/seeker.sqlite` and is excluded from git. Each import run is saved, including the requested limit, time, status, number fetched, number added, and number refreshed. Artists are keyed by their MusicBrainz ID, so repeated imports update existing rows instead of creating duplicates.

The importer browses artist records linked to Lithuania's MusicBrainz area and keeps records whose main associated country is `LT`. This supports paging beyond the 500-result cap on MusicBrainz search queries. The limit can be set from 1 to 1,000 matching artists. Requests are made in pages of at most 100 and separated by at least 2 seconds. The last request time is persisted so restarting Seeker does not immediately issue another request. HTTP 503 responses are retried with backoff.

Set `PORT` to change the local port. `SEEKER_USER_AGENT` can override the default API user-agent string (`Seeker/0.1.0`).

The Vilnius Events page imports concert and festival candidates from the site's WordPress REST API. Imports use pages of 50, wait at least 3 seconds between requests, time out after 20 seconds, and retry temporary errors and rate limits with backoff. Progress and each completed page are saved in SQLite. Continuing an import also rechecks the newest and preceding pages; this overlap reduces, but cannot eliminate, omissions when the source changes between runs. Refresh newest page does not move the import position. The source's publication date is not the event date, and its categories include non-music events. Review candidates using Music, Not music or Unsure. Unknown dates are separate from upcoming events. Lists are filtered and paginated on the server, and artist suggestions are calculated only when opening an event.

The detail lookup checks up to 10 event pages at a time using the same pacing. Refreshing the oldest checks revisits already checked pages, while the standard detail action checks records that need it. “Refresh all event details” checks every saved Vilnius Events record in a background job and reports the number completed. Each event is saved as it finishes, so completed updates remain if the job fails or Seeker stops; starting another refresh-all job checks the catalogue again from the beginning. Missing or ambiguous values remain available for review. Edits are protected per field on future refreshes; for edits made before field-level tracking, all fields remain protected because the original edited fields are unknown. Artist matches remain suggestions until accepted.

Event details also include the source's optional “Apie renginį” link, which can point to a Facebook event or another website. Existing events need one details lookup to collect this link; use “Get details for 10 events” or open an event and refresh its details individually.

The catalogue stores canonical `events` and linked `event_sources`. The original Vilnius Events records are retained during this transition, with SQLite triggers keeping the canonical catalogue in sync. This schema supports linking multiple source records to one event, but the current importer and editor still operate on Vilnius Events; additional source adapters and a merge workflow are future work. Potential matching events can be queried, but are never merged automatically.

The first launch after upgrading creates and verifies a SQLite backup in `data/backups` before migrating existing event data. Do not remove it until you have verified the migrated catalogue. Import and detail jobs are persisted in SQLite and can run while the dashboard is closed, as long as the Node server remains running. If the server stops, unfinished jobs are marked interrupted at the next startup; completed pages remain saved and can be resumed. Each source retains its original rate limits and retry behavior.

For a backup of the database **and downloaded images**, run `npm run backup` from `seeker`. It saves a separate directory under `data/backups`, checks database integrity and foreign keys, and verifies image copies against SHA-256 hashes. The manifest records table counts and image hashes. The command refuses to proceed if a job is active at the time of the database snapshot. For a final migration or a point-in-time backup, stop Seeker before running it, so edits and new jobs cannot start during the copy. Backups contain private working data and are excluded from Git; keep an additional copy somewhere safe.

The experimental `central-api.ts` provides a server-side client for event reads, edits and source-page imports. `sources/central-vilnius-events.ts` orchestrates Vilnius Events pages locally while the API commits them. Neither is connected to the dashboard or jobs yet, so Seeker continues to use its local SQLite database. The client keeps the token out of browser code, requires HTTPS except on localhost, and never automatically retries an uncertain write. Do not configure it for production until all central reads, imports, jobs, and the deployed API have been completed and tested together.

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

Open **AI evaluation** to select events individually or select the first N events, choose Gemini 3.5 Flash-Lite, Gemini 4 Hydrogen, or both, and set an estimated per-run USD budget. Analysis runs as a background job and saves each model result as it completes. The dashboard shows the latest 1,000 results; older results remain in SQLite. A server restart marks an unfinished run as interrupted. Re-running events sends new requests and may incur charges again.

Gemini receives the event title and description. Suggestions are separate from existing review decisions: use Accept to apply a classification or artist match. Performer matches are exact normalized matches against local artist names and aliases; evidence is marked when it cannot be verified in the event text. No web search is used. Event descriptions over 30,000 characters are truncated for analysis.

Before each generation, Seeker asks Gemini to count input tokens and reserves the configured maximum output tokens at the listed standard model prices. It stops when this estimated reservation would exceed the run budget. This is not a provider-enforced spending cap: prices can change, requests with unknown outcomes can incur charges, and account taxes or other charges are excluded. Check Google billing and configure provider limits separately. Seeker stops if generation usage is unavailable or the request fails after being sent, because its actual charge may be unknown. The prices in `database/ai-evaluation.ts` must be updated when Google changes them.

Vilnius Events imports can optionally download featured images. Enable “Download images with imports”, or use “Download missing event images” to process existing events. Images are stored in `data/images/vilnius-events/`, excluded from git, and previewed in event details. SQLite stores the source URL, image dimensions and file metadata; source alt text is not imported. Requests use the same minimum 3-second spacing, retries and timeouts as the event importer. Failed images can be retried with the download button. Back up the images directory alongside the SQLite database.

The **Dracula export** filter shows which events are ready for the client snapshot and why others are excluded. Ready events are marked Music and either have an unknown date or have not ended in Vilnius. Artist matches, images and an original event link are optional. The client snapshot is refreshed manually; its export uses the same selection rule.

Assistant-reviewed events can be found with **Assistant review → Needs my check**. Their review notes are shown on each event; use **Mark as checked** after reviewing. Music events remain eligible for export before your check if they meet the existing date rules.

Event prices are read from VN event pages during detail lookups. The displayed source text is saved with a free, paid or unknown classification; ambiguous, mixed or missing prices remain unknown. Use the Price filter to find free or paid events. To populate existing records, use **Refresh all event details** after restarting Seeker. Requests are paced, and unavailable pages cannot be refreshed.
