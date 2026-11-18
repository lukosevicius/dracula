import { descriptionText } from './description.mjs';

const columns = `e.id,e.title,e.event_date,e.event_end_date,e.event_time,e.venue,e.ticket_url,
 s.source_url,s.about_url,s.content_html,i.local_name,p.price_text,p.price_type`;
const joins = `FROM events e JOIN event_sources s ON s.id=(SELECT id FROM event_sources WHERE event_id=e.id ORDER BY CASE WHEN source_key='vilnius-events' THEN 0 ELSE 1 END,id LIMIT 1)
 LEFT JOIN vilnius_events v ON s.source_key='vilnius-events' AND v.source_id=CAST(s.source_id AS UNSIGNED)
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
    async page({offset, limit, filter, from, to}, today = vilniusToday()) {
      const shift = (date, days) => { const d = new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate()+days); return d.toISOString().slice(0,10); };
      const end = "COALESCE(NULLIF(e.event_end_date,''),e.event_date)";
      let clause = '', params = [];
      if (filter === 'unknown') clause = " AND NULLIF(e.event_date,'') IS NULL";
      else if (filter === 'past') { clause = ` AND NULLIF(e.event_date,'') IS NOT NULL AND ${end}<?`; params=[today]; }
      else if (filter === 'upcoming') { clause = ` AND NULLIF(e.event_date,'') IS NOT NULL AND ${end}>=?`; params=[today]; }
      else if (filter !== 'all') {
        let start=from, finish=to || from;
        if (filter==='today') start=finish=today;
        if (filter==='tomorrow') start=finish=shift(today,1);
        if (filter==='weekend') { const day=new Date(`${today}T00:00:00Z`).getUTCDay(); start=shift(today,day===0?-1:6-day); finish=shift(start,1); }
        clause=` AND NULLIF(e.event_date,'') IS NOT NULL AND e.event_date<=? AND ${end}>=?`; params=[finish,start];
      }
      const [countRows] = await db.execute(`SELECT COUNT(*) AS total ${joins} WHERE ${ready}${clause}`, [today,...params]);
      const [rows] = await db.execute(`SELECT ${columns} ${joins} WHERE ${ready}${clause} ORDER BY CASE WHEN NULLIF(e.event_date,'') IS NULL THEN 1 ELSE 0 END, e.event_date, COALESCE(e.event_time,''), e.id LIMIT ? OFFSET ?`, [today,...params,limit,offset]);
      const items=await map(rows); const total=Number(countRows[0].total);
      return {items,total,nextOffset:offset+items.length<total ? offset+items.length : null};
    },
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
