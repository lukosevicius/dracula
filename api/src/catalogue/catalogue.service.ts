import { Inject, Injectable } from '@nestjs/common';
import { type RowDataPacket } from 'mysql2/promise';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { DatabaseService } from '../database/database.service.js';
import { descriptionText } from './description.js';

export type DateFilter = 'upcoming' | 'today' | 'tomorrow' | 'weekend' | 'custom' | 'all' | 'past' | 'unknown';
export interface PageOptions { offset: number; limit: number; filter: DateFilter; from: string; to: string; artists?: string[] }
interface EventRow extends RowDataPacket { id: number; interest_score: number; title: string; event_date: string | null; event_end_date: string | null; event_time: string | null; venue: string | null; ticket_url: string | null; source_url: string; about_url: string | null; price_text: string | null; price_type: string | null; content_html: string | null; local_name: string | null }
interface ArtistRow extends RowDataPacket { event_id: number; mbid: string; name: string }
interface CountRow extends RowDataPacket { total: number | string }
const columns = `e.id,e.title,e.event_date,e.event_end_date,e.event_time,e.venue,e.ticket_url,e.interest_score,
 s.source_url,s.about_url,s.content_html,COALESCE(i.local_name,ei.local_name) AS local_name,p.price_text,p.price_type`;
const joins = `FROM events e JOIN event_sources s ON s.id=(SELECT id FROM event_sources WHERE event_id=e.id ORDER BY CASE WHEN source_key='vilnius-events' THEN 0 ELSE 1 END,id LIMIT 1)
 LEFT JOIN vilnius_events v ON s.source_key='vilnius-events' AND v.source_id=CAST(s.source_id AS UNSIGNED)
 LEFT JOIN vilnius_images i ON i.media_id=v.featured_media
 LEFT JOIN event_images ei ON ei.event_id=e.id
 LEFT JOIN event_prices p ON p.event_id=e.id`;
const ready = `e.review_status='music' AND (NULLIF(e.event_date,'') IS NULL OR COALESCE(NULLIF(e.event_end_date,''),e.event_date)>=?)`;
export function vilniusToday(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Vilnius', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
@Injectable()
export class CatalogueService {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService, @Inject(APP_CONFIG) private readonly config: AppConfig) {}
  private async map(rows: EventRow[]) {
    if (!rows.length) return [];
    const ids = rows.map(row => row.id);
    const [artists] = await this.db.pool.execute<ArtistRow[]>(`SELECT d.event_id,a.mbid,a.name FROM event_artist_decisions d
      JOIN artists a ON a.mbid=d.artist_mbid WHERE d.decision='accepted' AND d.event_id IN (${ids.map(() => '?').join(',')}) ORDER BY a.name`, ids);
    return rows.map(({content_html, local_name, ...row}) => ({ ...row,
      description: descriptionText(content_html),
      image_url: typeof local_name === 'string' && /^[A-Za-z0-9._-]+$/.test(local_name) && local_name !== '.' && local_name !== '..'
        ? `${this.config.publicBaseUrl}/v1/images/${encodeURIComponent(local_name)}` : null,
      artists: artists.filter(a => a.event_id === row.id).map(({mbid,name}) => ({mbid,name})),
    }));
  }
  async page({offset, limit, filter, from, to, artists}: PageOptions, today = vilniusToday()) {
    const shift = (date: string, days: number) => { const d = new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate()+days); return d.toISOString().slice(0,10); };
    const end = "COALESCE(NULLIF(e.event_end_date,''),e.event_date)";
    let clause = ''; let params: string[] = []; let groupStart = today;
    if (filter === 'unknown') clause = " AND NULLIF(e.event_date,'') IS NULL";
    else if (filter === 'past') { clause = ` AND NULLIF(e.event_date,'') IS NOT NULL AND ${end}<?`; params=[today]; }
    else if (filter === 'upcoming') { clause = ` AND NULLIF(e.event_date,'') IS NOT NULL AND ${end}>=?`; params=[today]; }
    else if (filter !== 'all') {
      let start=from, finish=to || from;
      if (filter==='today') start=finish=today;
      if (filter==='tomorrow') start=finish=shift(today,1);
      if (filter==='weekend') { const day=new Date(`${today}T00:00:00Z`).getUTCDay(); start=shift(today,day===0?-1:6-day); finish=shift(start,1); }
      groupStart=start;
      clause=` AND NULLIF(e.event_date,'') IS NOT NULL AND e.event_date<=? AND ${end}>=?`; params=[finish,start];
    }
    if (artists?.length) {
      clause += ` AND EXISTS (SELECT 1 FROM event_artist_decisions d WHERE d.event_id=e.id AND d.decision='accepted' AND d.artist_mbid IN (${artists.map(() => '?').join(',')}))`;
      params.push(...artists);
    }
    const [countRows] = await this.db.pool.execute<CountRow[]>(`SELECT COUNT(*) AS total ${joins} WHERE ${ready}${clause}`, [today,...params]);
    const [rows] = await this.db.pool.execute<EventRow[]>(`SELECT ${columns} ${joins} WHERE ${ready}${clause} ORDER BY CASE WHEN NULLIF(e.event_date,'') IS NULL THEN 1 ELSE 0 END, CASE WHEN e.event_date<? THEN ? ELSE e.event_date END, e.interest_score DESC, COALESCE(e.event_time,''), e.id LIMIT ? OFFSET ?`, [today,...params,groupStart,groupStart,limit,offset]);
    const items=await this.map(rows); const total=Number(countRows[0].total);
    return {items,total,nextOffset:offset+items.length<total ? offset+items.length : null};
  }
  async artist(mbid: string) {
    const [rows] = await this.db.pool.execute<RowDataPacket[]>('SELECT mbid,name FROM artists WHERE mbid=? LIMIT 1', [mbid]);
    return rows[0] ? {mbid:rows[0].mbid,name:rows[0].name} : null;
  }
  async list(after: number, limit: number, today = vilniusToday()) {
    const [rows] = await this.db.pool.execute<EventRow[]>(`SELECT ${columns} ${joins} WHERE ${ready} AND e.id>? ORDER BY e.id LIMIT ?`, [today,after,limit + 1]);
    const more = rows.length > limit; const items = await this.map(rows.slice(0, limit));
    return {items, next: more ? items.at(-1)!.id : null};
  }
  async get(id: number, today = vilniusToday()) {
    const [rows] = await this.db.pool.execute<EventRow[]>(`SELECT ${columns} ${joins} WHERE ${ready} AND e.id=? LIMIT 1`, [today,id]);
    return (await this.map(rows))[0] ?? null;
  }
  async saved(userId: number) {
    const [rows] = await this.db.pool.execute<EventRow[]>(`SELECT ${columns} ${joins}
      JOIN user_saved_events saved ON saved.event_id=e.id
      WHERE saved.user_id=? AND e.review_status='music' ORDER BY e.interest_score DESC,saved.created_at DESC,e.id DESC`, [userId]);
    return this.map(rows);
  }
  async hasImage(name: string, today = vilniusToday()) {
    const [rows] = await this.db.pool.execute<RowDataPacket[]>(`SELECT e.id ${joins} WHERE ${ready} AND COALESCE(i.local_name,ei.local_name)=? LIMIT 1`, [today,name]);
    return rows.length > 0;
  }
}
