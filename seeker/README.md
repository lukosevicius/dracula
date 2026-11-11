# Seeker

Small local dashboard for importing Lithuanian-associated artist records from the MusicBrainz API into SQLite.

## Run

Requires Node.js 22.5 or newer.

```sh
npm start
```

Open <http://127.0.0.1:4177>.

The SQLite database is created at `data/seeker.sqlite` and is excluded from git. Each import run is saved, including the requested limit, time, status, number fetched, number added, and number refreshed. Artists are keyed by their MusicBrainz ID, so repeated imports update existing rows instead of creating duplicates.

The importer searches MusicBrainz for `country:LT`. The limit can be set from 1 to 1,000. Requests are made in pages of at most 100 and separated by at least 1.1 seconds.

Set `PORT` to change the local port. `SEEKER_USER_AGENT` can override the API user-agent string.
