import assert from 'node:assert/strict';
import test from 'node:test';
import { groupNewestEvents } from '../client/src/event-groups.js';

test('Newest groups ongoing and same-day events together, with one section per remaining weekday', () => {
  const events = [
    { id: 1, event_date: '2026-11-23' },
    { id: 2, event_date: '2026-11-24' },
    { id: 3, event_date: '2026-11-25' },
    { id: 4, event_date: '2026-11-26' },
    { id: 5, event_date: '2026-11-29' },
    { id: 6, event_date: '2026-11-30' },
    { id: 7, event_date: '2026-12-01' },
  ];
  const headings = groupNewestEvents(events, '2026-11-24').map(group => [group.title, group.events.map(event => event.id)]);
  assert.deepEqual(headings, [['Today', [1, 2]], ['Tomorrow', [3]], ['Thursday', [4]], ['Sunday', [5]], ['Later', [6, 7]]]);
});

test('Newest keeps Tomorrow separate when it falls in the next week', () => {
  const groups = groupNewestEvents([
    { event_date: '2026-11-30' },
    { event_date: '2026-12-01' },
  ], '2026-11-29');
  assert.deepEqual(groups.map(group => [group.title, group.dateLabel]), [['Tomorrow', '30 Nov'], ['Later', '']]);
});
