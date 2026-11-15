import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';

test('Dracula readiness includes only current music events with known dates', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('CREATE TABLE events (id INTEGER, review_status TEXT, event_date TEXT, event_end_date TEXT)');
    const insert = db.prepare('INSERT INTO events VALUES (?, ?, ?, ?)');
    insert.run(1, 'music', '2026-11-15', null);
    insert.run(2, 'music', '2026-11-14', '2026-11-16');
    insert.run(3, 'music', '2026-11-14', null);
    insert.run(4, 'music', null, null);
    insert.run(5, 'unsure', '2026-11-16', null);
    insert.run(6, 'not_music', '2026-11-16', null);
    const rule = readFileSync(resolve('database/ready-for-dracula.sql'), 'utf8').trim();
    const rows = db.prepare(`SELECT id FROM events e WHERE ${rule} ORDER BY id`).all('2026-11-15');
    assert.deepEqual(rows.map(row => row.id), [1, 2]);
  } finally { db.close(); }
});
