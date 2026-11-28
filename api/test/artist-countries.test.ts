import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {fillNewNameCountries} from '../dist/artists/extraction.js';

test('new names get a country from one clear MusicBrainz match and are asked only once', async () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE events(id INTEGER PRIMARY KEY,event_date TEXT,event_end_date TEXT);
    CREATE TABLE artist_extractions(event_id INTEGER PRIMARY KEY,status TEXT,result TEXT);
    INSERT INTO events VALUES(1,'2099-01-01',NULL),(2,'2099-01-02',NULL),(3,'2000-01-01',NULL);`);
  const names = (list: object[]) => JSON.stringify({ performers: [], new_names: list });
  const open = (name: string, extra = {}) => ({ name, written: name, role: 'main', evidence: '', status: 'open', ...extra });
  db.prepare('INSERT INTO artist_extractions VALUES(?,?,?)').run(1, 'completed', names([open('Bill Laurance'), open('Nobody Known'), open('Has Country', { country: 'FI' })]));
  db.prepare('INSERT INTO artist_extractions VALUES(?,?,?)').run(2, 'completed', names([open('Bill Laurance')]));
  db.prepare('INSERT INTO artist_extractions VALUES(?,?,?)').run(3, 'completed', names([open('Past Event Only')]));
  const connection = { async beginTransaction() { db.exec('BEGIN'); }, async commit() { db.exec('COMMIT'); }, async rollback() { db.exec('ROLLBACK'); }, release() {},
    async execute(sql: string, params: import('node:sqlite').SQLInputValue[] = []) { const q = sql.replace(/ FOR UPDATE$/, ''); const stmt = db.prepare(q); if (/^\s*SELECT/i.test(q)) return [stmt.all(...params)]; const r = stmt.run(...params); return [{ insertId: Number(r.lastInsertRowid), affectedRows: Number(r.changes) }]; } };
  const pool = { getConnection: async () => connection, execute: (sql: string, params: import('node:sqlite').SQLInputValue[]) => connection.execute(sql, params) } as unknown as import('mysql2/promise').Pool;
  const asked: string[] = [];
  const request = (async (input: RequestInfo | URL) => {
    const query = new URL(String(input)).searchParams.get('query') ?? '';
    asked.push(query);
    return Response.json({ artists: query.includes('Bill Laurance') ? [{ id: '11111111-1111-1111-1111-111111111111', name: 'Bill Laurance', score: 100, country: 'GB' }] : [] });
  }) as typeof fetch;
  try {
    assert.deepEqual(await fillNewNameCountries(pool, { limit: 5 }, request), { checked: 2, found: 1, remaining: 0 });
    assert.equal(asked.length, 2, 'names with a country and past events are skipped');
    const saved = (id: number) => (JSON.parse(String(db.prepare('SELECT result FROM artist_extractions WHERE event_id=?').get(id)!.result)).new_names as { name: string; country?: string; country_checked?: boolean }[]);
    assert.deepEqual(saved(1).map(item => [item.name, item.country ?? '', !!item.country_checked]), [['Bill Laurance', 'GB', true], ['Nobody Known', '', true], ['Has Country', 'FI', false]]);
    assert.equal(saved(2)[0].country, 'GB', 'every event naming the artist gets the country');
    assert.deepEqual(await fillNewNameCountries(pool, {}, request), { checked: 0, found: 0, remaining: 0 });
    assert.equal(asked.length, 2, 'a name is not asked twice');
    // A failed request stops the batch and leaves the name for later.
    db.prepare('INSERT INTO artist_extractions VALUES(?,?,?)').run(4, 'completed', names([open('Later')]));
    db.exec("INSERT INTO events VALUES(4,'2099-02-01',NULL)");
    const failing = (async () => new Response('busy', { status: 503 })) as typeof fetch;
    const result = await fillNewNameCountries(pool, {}, failing);
    assert.equal(result.checked, 0); assert.equal(result.remaining, 1); assert.match(String(result.error), /HTTP 503/);
    await assert.rejects(fillNewNameCountries(pool, { limit: 99 }, request), { status: 400 });
  } finally { db.close(); }
});
