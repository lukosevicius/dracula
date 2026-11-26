import { test } from 'node:test';
import assert from 'node:assert/strict';
import { transitionEvents } from '../src/utils/event-transition';
import type { DisplayEvent } from '../src/utils/events-api';

const event = (id: number, start: string, end: string | null, title: string, price: 'free' | 'paid'): DisplayEvent => ({id,event_date:start,event_end_date:end,event_time:null,ticket_url:null,title,price_type:price,venue:null,artists:[],interest_score:1,source_url:'https://example.com',about_url:null,description:'',image:null});
test('filter transitions keep only known matching events, including ongoing events', () => {
  const events = [event(1,'2026-11-21','2026-11-23','Žemė','free'),event(2,'2026-11-22',null,'Music','paid'),event(3,'2026-11-23',null,'Tomorrow','free')];
  const ids = (filter: string, search = '', free = false) => transitionEvents(events,filter,'','','2026-11-22',search,free).map(item=>item.id);
  assert.deepEqual(ids('today'),[1,2]);
  assert.deepEqual(ids('tomorrow'),[1,3]);
  assert.deepEqual(ids('today','zeme',true),[1]);
  assert.deepEqual(ids('today','music',true),[]);
});

test('switching cities only keeps matching cached events while loading', () => {
  const events = [
    { ...event(1,'2026-11-21',null,'Concert','free'), city: 'Klaipėda' },
    { ...event(2,'2026-11-21',null,'Concert','free'), city: 'Kaunas' },
    event(3,'2026-11-21',null,'Concert','free'),
  ];
  assert.deepEqual(transitionEvents(events,'today','','','2026-11-21','concert',true,'Klaipėda').map(item=>item.id),[1]);
  assert.deepEqual(transitionEvents(events,'today','','','2026-11-21','',false,'Palanga'),[]);
});
