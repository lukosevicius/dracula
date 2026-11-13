import type { DatabaseSync } from 'node:sqlite';

/** Legacy source rows remain intact during the transition; triggers keep the new catalogue in sync. */
export function migrateEventCatalogue(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY, title TEXT NOT NULL, event_date TEXT, event_end_date TEXT,
      event_time TEXT, venue TEXT, ticket_url TEXT, review_status TEXT NOT NULL DEFAULT 'unsure',
      manual_fields TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS event_sources (
      id INTEGER PRIMARY KEY, event_id INTEGER NOT NULL REFERENCES events(id),
      source_key TEXT NOT NULL, source_id TEXT NOT NULL, source_url TEXT NOT NULL,
      content_html TEXT NOT NULL DEFAULT '', source_data_json TEXT NOT NULL DEFAULT '{}', last_checked_at TEXT,
      UNIQUE(source_key, source_id)
    );
    CREATE TABLE IF NOT EXISTS event_artist_decisions (
      event_id INTEGER NOT NULL REFERENCES events(id), artist_mbid TEXT NOT NULL REFERENCES artists(mbid),
      decision TEXT NOT NULL CHECK(decision IN ('accepted','dismissed')), PRIMARY KEY(event_id,artist_mbid)
    );
    CREATE INDEX IF NOT EXISTS idx_events_date_id ON events(event_date, id);
    CREATE INDEX IF NOT EXISTS idx_events_review_date_id ON events(review_status, event_date, id);
    CREATE INDEX IF NOT EXISTS idx_event_sources_event ON event_sources(event_id);
  `);
  if (db.prepare('SELECT version FROM schema_migrations WHERE version=1').get()) return;
  db.exec('BEGIN IMMEDIATE');
  try {
    const rows=db.prepare('SELECT * FROM vilnius_events ORDER BY source_id').all();
    const event=db.prepare(`INSERT INTO events(title,event_date,event_end_date,event_time,venue,ticket_url,review_status,manual_fields,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)`);
    const source=db.prepare(`INSERT INTO event_sources(event_id,source_key,source_id,source_url,content_html,source_data_json,last_checked_at) VALUES(?,'vilnius-events',?,?,?,?,?)`);
    const links=db.prepare('SELECT artist_mbid,decision FROM vilnius_event_artists WHERE event_id=?');
    const decision=db.prepare('INSERT INTO event_artist_decisions(event_id,artist_mbid,decision) VALUES(?,?,?)');
    for (const row of rows) {
      const id=event.run(row.title,row.event_date,row.event_end_date,row.event_time,row.venue,row.ticket_url,row.review_status,row.manual_fields,row.first_seen_at,row.updated_at).lastInsertRowid;
      source.run(id,String(row.source_id),row.source_url,row.content_html,JSON.stringify(row),row.details_checked_at);
      for(const link of links.all(row.source_id)) decision.run(id,link.artist_mbid,link.decision);
    }
    db.exec(`
      CREATE TRIGGER sync_vilnius_insert AFTER INSERT ON vilnius_events BEGIN
        INSERT INTO events(title,event_date,event_end_date,event_time,venue,ticket_url,review_status,manual_fields,created_at,updated_at)
        VALUES(new.title,new.event_date,new.event_end_date,new.event_time,new.venue,new.ticket_url,new.review_status,new.manual_fields,new.first_seen_at,new.updated_at);
        INSERT INTO event_sources(event_id,source_key,source_id,source_url,content_html,source_data_json,last_checked_at)
        VALUES(last_insert_rowid(),'vilnius-events',CAST(new.source_id AS TEXT),new.source_url,new.content_html,json_object('title',new.title,'published_at',new.published_at,'modified_at',new.modified_at,'categories_json',new.categories_json,'featured_media',new.featured_media),new.details_checked_at);
      END;
      CREATE TRIGGER sync_vilnius_update AFTER UPDATE ON vilnius_events BEGIN
        UPDATE events SET title=new.title,event_date=new.event_date,event_end_date=new.event_end_date,event_time=new.event_time,
          venue=new.venue,ticket_url=new.ticket_url,review_status=new.review_status,manual_fields=new.manual_fields,updated_at=new.updated_at
        WHERE id=(SELECT event_id FROM event_sources WHERE source_key='vilnius-events' AND source_id=CAST(new.source_id AS TEXT));
        UPDATE event_sources SET source_url=new.source_url,content_html=new.content_html,source_data_json=json_object('title',new.title,'published_at',new.published_at,'modified_at',new.modified_at,'categories_json',new.categories_json,'featured_media',new.featured_media),last_checked_at=new.details_checked_at
        WHERE source_key='vilnius-events' AND source_id=CAST(new.source_id AS TEXT);
      END;
      CREATE TRIGGER sync_artist_insert AFTER INSERT ON vilnius_event_artists BEGIN
        INSERT INTO event_artist_decisions(event_id,artist_mbid,decision)
        VALUES((SELECT event_id FROM event_sources WHERE source_key='vilnius-events' AND source_id=CAST(new.event_id AS TEXT)),new.artist_mbid,new.decision)
        ON CONFLICT(event_id,artist_mbid) DO UPDATE SET decision=excluded.decision;
      END;
      CREATE TRIGGER sync_artist_update AFTER UPDATE ON vilnius_event_artists BEGIN
        UPDATE event_artist_decisions SET decision=new.decision WHERE artist_mbid=new.artist_mbid AND event_id=(SELECT event_id FROM event_sources WHERE source_key='vilnius-events' AND source_id=CAST(new.event_id AS TEXT));
      END;
      CREATE TRIGGER sync_artist_delete AFTER DELETE ON vilnius_event_artists BEGIN
        DELETE FROM event_artist_decisions WHERE artist_mbid=old.artist_mbid AND event_id=(SELECT event_id FROM event_sources WHERE source_key='vilnius-events' AND source_id=CAST(old.event_id AS TEXT));
      END;
    `);
    db.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(1,?)').run(new Date().toISOString());
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

export function migrateSourceLinks(db: DatabaseSync): void {
  if (db.prepare('SELECT 1 FROM schema_migrations WHERE version=2').get()) return;
  db.exec('BEGIN IMMEDIATE');
  try {
    const columns=new Set(db.prepare('PRAGMA table_info(event_sources)').all().map(row=>row.name));
    if(!columns.has('about_url')) db.exec('ALTER TABLE event_sources ADD COLUMN about_url TEXT');
    if(!columns.has('about_checked_at')) db.exec('ALTER TABLE event_sources ADD COLUMN about_checked_at TEXT');
    db.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(2,?)').run(new Date().toISOString());
    db.exec('COMMIT');
  } catch(error) { db.exec('ROLLBACK'); throw error; }
}
