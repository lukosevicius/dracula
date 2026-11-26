import test from 'node:test';
import assert from 'node:assert/strict';
import { extractPageDetails } from '../sources/event-details.js';

const card = (time: string) => `<div class="se-date-card"><div class="se-date-card__date"><span>Antradienis, gruodžio 29, 2026</span></div><div class="se-date-card__time"><span>${time}</span></div></div>`;
const ld = (value: unknown) => `<script type="application/ld+json">${JSON.stringify(value)}</script>`;

test('VN pages give the end time from the date card or structured data', () => {
  assert.equal(extractPageDetails(card('18:00 - 20:00') + '<add-to-calendar-button startdate="2026-12-29" starttime="18:00" enddate="2026-12-29" endtime="20:00"></add-to-calendar-button>').event_end_time, '20:00');
  const structured = extractPageDetails(card('18:00') + ld({ '@type': 'MusicEvent', startDate: '2026-12-29T18:00:00', endDate: '2026-12-29T21:30:00' }));
  assert.deepEqual([structured.event_date, structured.event_time, structured.event_end_time], ['2026-12-29', '18:00', '21:30']);
  // 00:00 is VN's placeholder for no end time.
  assert.equal(extractPageDetails(ld({ '@type': 'Event', startDate: '2026-12-29T18:00:00', endDate: '2026-12-30T00:00:00' })).event_end_time, null);
});

test('VN structured data settles the date when several date cards are shown', () => {
  const page = card('12:00') + card('') + '<add-to-calendar-button startdate="2026-12-12"></add-to-calendar-button><add-to-calendar-button startdate="2026-12-12"></add-to-calendar-button>'
    + ld([{ '@type': 'Event', startDate: '2026-12-12T12:00:00' }, { '@type': 'Event', startDate: '2026-12-12', endDate: '2026-12-13' }])
    + '<h2>Kiti renginiai</h2>' + ld({ '@type': 'Event', startDate: '2027-01-03T10:00:00' });
  const details = extractPageDetails(page);
  assert.deepEqual([details.event_date, details.event_time, details.ambiguous_dates], ['2026-12-12', '12:00', false]);
  // Different dates in the event's own data are separate showings of one event.
  const dates = extractPageDetails(ld([{ '@type': 'Event', startDate: '2026-12-12' }, { '@type': 'Event', startDate: '2026-12-19' }]) + card('') + card(''));
  assert.deepEqual([dates.ambiguous_dates, dates.event_date, dates.event_end_date, dates.times?.length], [false, '2026-12-12', '2026-12-19', 2]);
});

test('VN pages with several showings keep every showing', () => {
  const details = extractPageDetails(card('16:00') + card('19:00')
    + ld({ '@type': 'MusicEvent', startDate: '2026-12-26T16:00:00' }) + ld({ '@type': 'MusicEvent', startDate: '2026-12-26T19:00:00' }));
  assert.deepEqual([details.event_date, details.event_time, details.event_end_time, details.ambiguous_dates], ['2026-12-26', '16:00', null, false]);
  assert.deepEqual(details.times, [{ date: '2026-12-26', time: '16:00', end_time: null }, { date: '2026-12-26', time: '19:00', end_time: null }]);
  const series = extractPageDetails(ld([{ '@type': 'Event', startDate: '2026-12-19T18:00:00' }, { '@type': 'Event', startDate: '2026-12-12T18:00:00', endDate: '2026-12-12T20:00:00' }]));
  assert.deepEqual([series.event_date, series.event_end_date, series.times?.length, series.times?.[0].end_time], ['2026-12-12', '2026-12-19', 2, '20:00']);
});
