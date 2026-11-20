import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadMigrations, migrate } from '../src/migrate.js';
import type { Connection } from 'mysql2/promise';

test('release migration check rejects pending or invalid history without writing schema', async () => {
  const migrations = await loadMigrations();
  let rows = migrations.map(({name, checksum}) => ({name, checksum, state:'applied'}));
  const db = { async query(sql: string) {
    if (sql.includes('GET_LOCK')) return [[{acquired:1}]];
    if (sql.includes('RELEASE_LOCK')) return [[{released:1}]];
    if (sql.includes('information_schema.tables')) return [[{n:1}]];
    if (sql.startsWith('SELECT name, checksum, state')) return [rows];
    throw Error(`Unexpected query: ${sql}`);
  }} as unknown as Connection;
  await migrate(db, 'check');
  rows = rows.slice(0, -1);
  await assert.rejects(migrate(db, 'check'), /Pending migrations/);
  rows = migrations.map(({name, checksum}) => ({name, checksum, state:'applied'}));
  rows[0].checksum = 'changed';
  await assert.rejects(migrate(db, 'check'), /Checksum mismatch/);
  rows[0].checksum = migrations[0].checksum;
  rows[0].state = 'applying';
  await assert.rejects(migrate(db, 'check'), /is applying/);
});
