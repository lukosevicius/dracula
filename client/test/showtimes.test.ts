import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sameDayTimes, showtimeLines } from '../src/utils/event-format';
import { groupEventRows } from '../src/utils/event-groups';

const slot = (date: string, time: string | null, end_time: string | null = null) => ({ date, time, end_time });

test('several showings on one day are listed as times of one event', () => {
  assert.equal(sameDayTimes([slot('2026-12-26', '16:00'), slot('2026-12-26', '19:00', '20:30')]), '16:00, 19:00–20:30');
  assert.equal(sameDayTimes([slot('2026-12-26', '16:00')]), null);
  assert.deepEqual(showtimeLines([slot('2026-12-26', '16:00'), slot('2026-12-26', '19:00')]), []);
});

test('showings on several days get one line per day', () => {
  const lines = showtimeLines([slot('2026-12-12', '18:00'), slot('2026-12-12', '20:00'), slot('2026-12-19', null)]);
  assert.equal(lines.length, 2);
  assert.match(lines[0], /gruodžio 12.*18:00, 20:00$/);
  assert.doesNotMatch(lines[1], /·/);
});

test('an event with several showings appears once, under its next showing', () => {
  const event = { id: 1, event_date: '2026-12-12', times: [{ date: '2026-12-12' }, { date: '2026-12-19' }] };
  const rows = groupEventRows([event], 2, '2026-12-15');
  assert.deepEqual(rows.filter(row => row.type === 'heading').map(row => row.type === 'heading' && row.date), ['2026-12-19']);
  assert.equal(rows.filter(row => row.type === 'row').length, 1);
});
