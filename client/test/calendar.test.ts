import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calendarFile } from '../src/utils/calendar';
import type { DisplayEvent } from '../src/utils/events-api';

const event: DisplayEvent = {
  id: 42, title: 'Koncertas &#8211; Vilnius', interest_score: 1,
  event_date: '2026-11-21', event_end_date: null, event_time: '19:30', venue: 'Klubas, Vilnius',
  source_url: 'https://example.com/event', about_url: null, ticket_url: 'https://tickets.example/buy',
  description: 'Gyva muzika;\nAntra eilutė, čia.', image: null,
  artists: [{mbid:'1', name:'Atlikėjas'}], price_text:'Nuo 10 €', price_type:'paid',
};

test('calendar export includes useful event details and escapes calendar text', () => {
  const file = calendarFile(event, new Date('2026-11-20T10:00:00Z'))!;
  const unfolded = file.replace(/\r\n /g, '');
  assert.match(unfolded, /SUMMARY:Koncertas – Vilnius/);
  assert.match(unfolded, /DTSTART:20261121T173000Z/);
  assert.match(unfolded, /LOCATION:Klubas\\, Vilnius/);
  assert.match(unfolded, /DESCRIPTION:Gyva muzika\\;\\nAntra eilutė\\, čia\./);
  for (const detail of ['Atlikėjai: Atlikėjas', 'Kaina: Nuo 10 €', 'https://app.dracula.lt/events/42', 'https://example.com/event', 'https://tickets.example/buy']) assert.ok(unfolded.includes(detail));
  for (const line of file.split('\r\n')) assert.ok(Buffer.byteLength(line) <= 75);
});

test('unknown time remains all-day and unsafe URLs are excluded', () => {
  const file = calendarFile({...event, event_time:null, event_end_date:'2026-11-23', source_url:'javascript:alert(1)', ticket_url:'javascript:alert(2)', description:'', artists:[], price_text:null, price_type:'free'})!;
  assert.match(file, /DTSTART;VALUE=DATE:20261121/);
  assert.match(file, /DTEND;VALUE=DATE:20261124/);
  assert.ok(!file.includes('javascript:'));
  assert.match(file, /Kaina: Nemokamas/);
  assert.equal(calendarFile({...event, event_date:null}), null);
});
