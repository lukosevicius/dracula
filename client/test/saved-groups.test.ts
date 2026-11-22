import { test } from 'node:test';
import assert from 'node:assert/strict';
import { savedEventRows } from '../src/utils/saved-groups';
import type { DisplayEvent } from '../src/utils/events-api';

const event = (id: number, date: string | null, end: string | null = null) => ({id,event_date:date,event_end_date:end} as DisplayEvent);

test('saved events group by end date and retain all cards across responsive rows', () => {
  const events = [event(1,'2026-11-20'),event(2,'2026-11-23'),event(3,'2026-11-20','2026-11-22'),event(4,null),event(5,'2026-11-19')];
  const rows = savedEventRows(events,2,'2026-11-22');
  assert.deepEqual(rows.map(row => row.type === 'heading' ? row.title : row.events.map(item => item.id)), [
    'Artėjantys renginiai',[2,3],[4],'Praėję renginiai',[1,5],
  ]);
  assert.deepEqual(savedEventRows([],1,'2026-11-22'),[]);
  assert.equal(savedEventRows([events[0]],1,'2026-11-22')[0].key,'heading-Praėję renginiai');
});
