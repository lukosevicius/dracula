import { descriptionText } from './description.mjs';

const columns = `e.id,e.title,e.event_date,e.event_end_date,e.event_time,e.venue,e.ticket_url,
 s.source_url,s.about_url,s.content_html,i.local_name,p.price_text,p.price_type`;
const joins = `FROM events e JOIN event_sources s ON s.event_id=e.id AND s.source_key='vilnius-events'
 LEFT JOIN vilnius_events v ON CAST(v.source_id AS CHAR)=s.source_id
 LEFT JOIN vilnius_images i ON i.media_id=v.featured_media
 LEFT JOIN event_prices p ON p.event_id=e.id`;
const ready = `e.review_status='music' AND (NULLIF(e.event_date,'') IS NULL OR COALESCE(NULLIF(e.event_end_date,''),e.event_date)>=?)`;

export function vilniusToday(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Vilnius', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export function createCatalogue(db, publicBaseUrl) {
  async function map(rows) {
    if (!rows.length) return [];
    const ids = rows.map(row => row.id);
    const [artists] = await db.execute(`SELECT d.event_id,a.mbid,a.name FROM event_artist_decisions d
      JOIN artists a ON a.mbid=d.artist_mbid WHERE d.decision='accepted' AND d.event_id IN (${ids.map(() => '?').join(',')}) ORDER BY a.name`, ids);
    return rows.map(({content_html,local_name,...row}) => ({ ...row,
      description: descriptionText(content_html),
      image_url: typeof local_name === 'string' && /^[A-Za-z0-9._-]+$/.test(local_name) && local_name !== '.' && local_name !== '..'
        ? `${publicBaseUrl}/v1/images/${encodeURIComponent(local_name)}` : null,
      artists: artists.filter(a => a.event_id === row.id).map(({mbid,name}) => ({mbid,name}))
    }));
  }
  return {
    async list(after, limit, today = vilniusToday()) {
      const [rows] = await db.execute(`SELECT ${columns} ${joins} WHERE ${ready} AND e.id>? ORDER BY e.id LIMIT ?`, [today,after,limit + 1]);
      const more = rows.length > limit;
      const items = await map(rows.slice(0, limit));
      return {items, next: more ? items.at(-1).id : null};
    },
    async get(id, today = vilniusToday()) {
      const [rows] = await db.execute(`SELECT ${columns} ${joins} WHERE ${ready} AND e.id=? LIMIT 1`, [today,id]);
      return (await map(rows))[0] ?? null;
    },
    async hasImage(name, today = vilniusToday()) {
      const [rows] = await db.execute(`SELECT e.id ${joins} WHERE ${ready} AND i.local_name=? LIMIT 1`, [today,name]);
      return rows.length > 0;
    }
  };
}
