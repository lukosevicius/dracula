import type { DatabaseSync } from 'node:sqlite';

const normalize = (value: string): string => value.normalize('NFKD').replace(/\p{Diacritic}/gu,'').toLocaleLowerCase('lt').replace(/[^\p{L}\p{N}]+/gu,' ').trim();

/** Suggestions require the same date and title. They never merge records automatically. */
export function suggestEventMatches(db: DatabaseSync, eventId: number) {
  const event=db.prepare('SELECT id,title,event_date,venue FROM events WHERE id=?').get(eventId);
  if(!event || typeof event.title!=='string' || typeof event.event_date!=='string') return [];
  const title=normalize(event.title), venue=typeof event.venue==='string'?normalize(event.venue):'';
  if(!title) return [];
  return (db.prepare('SELECT id,title,event_date,venue FROM events WHERE id<>? AND event_date=? LIMIT 500').all(eventId,event.event_date) as unknown as {id:number;title:string;event_date:string;venue:string|null}[])
    .filter(candidate=>typeof candidate.title==='string' && normalize(candidate.title)===title)
    .map(candidate=>({...candidate,venue_matches:Boolean(venue&&typeof candidate.venue==='string'&&normalize(candidate.venue)===venue)}))
    .sort((a,b)=>Number(b.venue_matches)-Number(a.venue_matches));
}
