import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { Pool } from 'mysql2/promise';
import { importAvilysPage } from '../src/imports/avilys.js';

test('Avilys imports local clock time without converting timezone offsets', async () => {
  const inserted: unknown[][] = [];
  const owner = 'a'.repeat(64);
  const conn = {
    beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release: () => {},
    execute: async (sql: string, values: unknown[]) => {
      if (sql.startsWith('SELECT job_id')) return [[{ job_id: 1, owner_hash: createHash('sha256').update(owner).digest('hex'), expires_at: Date.now() + 60000 }]];
      if (sql.startsWith('SELECT p.event_id') || sql.startsWith('SELECT event_id')) return [[]];
      if (sql.startsWith('INSERT INTO events(')) { inserted.push(values); return [{ insertId: inserted.length }]; }
      return [{}];
    },
  };
  const pool = { getConnection: async () => conn } as unknown as Pool;
  const event = { title: 'Concert', city: 'Vilnius', categories: [{ id: 1 }] };
  await importAvilysPage(pool, { job: { id: 1, owner }, items: [
    { ...event, id: 1, startTime: '2026-11-23T19:00:00Z' },
    { ...event, id: 2, startTime: '2027-07-01T20:30:00+03:00' },
    { ...event, id: 3, startTime: '2026-11-23T25:00:00Z' },
    { ...event, id: 4, startTime: '2026-02-30T19:00:00Z' },
  ] });
  assert.deepEqual(inserted.map(values => values[3]), ['19:00', '20:30', null, null]);
});
