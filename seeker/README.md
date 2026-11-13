# Seeker

Small local dashboard for importing Lithuanian-associated artist records from the MusicBrainz API into SQLite.

## Run

Requires Node.js 22.5 or newer.

```sh
npm start
```

Open <http://127.0.0.1:4177>.

The SQLite database is created at `data/seeker.sqlite` and is excluded from git. Each import run is saved, including the requested limit, time, status, number fetched, number added, and number refreshed. Artists are keyed by their MusicBrainz ID, so repeated imports update existing rows instead of creating duplicates.

The importer browses artist records linked to Lithuania's MusicBrainz area and keeps records whose main associated country is `LT`. This supports paging beyond the 500-result cap on MusicBrainz search queries. The limit can be set from 1 to 1,000 matching artists. Requests are made in pages of at most 100 and separated by at least 2 seconds. The last request time is persisted so restarting Seeker does not immediately issue another request. HTTP 503 responses are retried with backoff.

Set `PORT` to change the local port. `SEEKER_USER_AGENT` can override the default API user-agent string (`Seeker/0.1.0`).

The Vilnius Events page imports concert and festival candidates from the site's WordPress REST API. Imports use pages of 50, wait at least 3 seconds between requests, time out after 20 seconds, and retry temporary errors and rate limits with backoff. Progress and each completed page are saved in SQLite. Choose up to 10 pages per run; restart from the beginning to refresh recently published records. The source's publication date is not the event date, and its festival category includes non-music events. The detail lookup checks up to 10 event pages at a time using the same pacing, extracts available calendar, venue and ticket fields, and leaves ambiguous fields for review. Manual corrections and artist decisions are retained across imports.
