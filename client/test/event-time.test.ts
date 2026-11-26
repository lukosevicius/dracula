import { test } from 'node:test';
import assert from 'node:assert/strict';
import { endedToday, eventsWord } from '../src/utils/event-groups';

const today = '2026-11-26';
const event = (fields: object) => ({ event_date: today, event_end_date: null, event_time: '18:30', event_end_time: null, ...fields });

test('an event is over two hours after it starts when it has no end time', () => {
  assert.equal(endedToday(event({}), today, '20:29'), false);
  assert.equal(endedToday(event({}), today, '20:30'), true);
});

test('an end time decides when an event is over, including past midnight', () => {
  assert.equal(endedToday(event({ event_end_time: '23:00' }), today, '22:00'), false);
  assert.equal(endedToday(event({ event_end_time: '23:00' }), today, '23:00'), true);
  assert.equal(endedToday(event({ event_time: '22:00', event_end_time: '02:00' }), today, '23:59'), false);
  assert.equal(endedToday(event({ event_end_time: '18:30' }), today, '19:00'), false);
});

test('events without a time, multi-day events and later showings stay listed', () => {
  assert.equal(endedToday(event({ event_time: null }), today, '23:59'), false);
  assert.equal(endedToday(event({ event_date: '2026-11-20', event_end_date: '2026-12-01' }), today, '23:59'), false);
  assert.equal(endedToday(event({ times: [{ date: today, time: '10:00', end_time: null }, { date: '2026-11-27', time: '10:00', end_time: null }] }), today, '23:59'), false);
  assert.equal(endedToday(event({ times: [{ date: today, time: '10:00', end_time: null }, { date: today, time: '20:00', end_time: null }] }), today, '21:00'), false);
  assert.equal(endedToday(event({ times: [{ date: today, time: '10:00', end_time: null }, { date: today, time: '14:00', end_time: null }] }), today, '21:00'), true);
});

test('event counts use the right Lithuanian form', () => {
  assert.deepEqual([1, 2, 9, 10, 11, 15, 19, 20, 21, 22, 101, 111, 289].map(eventsWord), [
    '1 renginys', '2 renginiai', '9 renginiai', '10 renginių', '11 renginių', '15 renginių', '19 renginių',
    '20 renginių', '21 renginys', '22 renginiai', '101 renginys', '111 renginių', '289 renginiai',
  ]);
});
