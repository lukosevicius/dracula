const months = {sausio:1,vasario:2,kovo:3,balandžio:4,gegužės:5,birželio:6,liepos:7,rugpjūčio:8,rugsėjo:9,spalio:10,lapkričio:11,gruodžio:12};
export function textFromHtml(html = '') {
  return html.replace(/<\s*(?:br\s*\/?|\/p|\/li|\/div)\s*>/gi, '\n').replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&').replace(/&#8211;/gi,'–').replace(/&#39;|&apos;/gi,"'").replace(/&quot;/gi,'"').replace(/[ \t]+/g,' ');
}
export function extractDetails(html = '') {
  const text = textFromHtml(html);
  const dates = [...text.matchAll(/\b(20\d{2})\s*m\.?\s*(sausio|vasario|kovo|balandžio|gegužės|birželio|liepos|rugpjūčio|rugsėjo|spalio|lapkričio|gruodžio)\s+(\d{1,2})(?!\s*[-–—])\s*d\.?/gi)].map(m => {
    const y=Number(m[1]), month=months[m[2].toLowerCase()], day=Number(m[3]); const d=new Date(Date.UTC(y,month-1,day));
    return d.getUTCFullYear()===y && d.getUTCMonth()===month-1 && d.getUTCDate()===day ? `${y}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}` : null;
  }).filter(Boolean);
  const unique = [...new Set(dates)];
  const times = [...new Set([...text.matchAll(/\b([01]?\d|2[0-3])[:.](\d{2})\s*val\.?/gi)].filter(m=>Number(m[2])<60).map(m=>`${m[1].padStart(2,'0')}:${m[2]}`))];
  const venue = text.match(/(?:^|\n)\s*(?:renginio vieta|vieta)\s*:\s*([^\n]{3,100})/i)?.[1]?.trim() || null;
  let ticket = null;
  for (const match of html.matchAll(/href\s*=\s*["'](https?:\/\/[^"']+)["']/gi)) {
    try { const u = new URL(match[1].replace(/&amp;/g,'&')); if (['bilietai.lt','kakava.lt','tickets.paysera.com','bilietupasaulis.lt'].some(h=>u.hostname===h || u.hostname.endsWith('.'+h))) { ticket=u.href; break; } } catch {}
  }
  return {event_date:unique.length===1?unique[0]:null,event_time:times.length===1 && unique.length===1?times[0]:null,venue,ticket_url:ticket};
}
export function extractPageDetails(html = '') {
  const calendars = [...html.matchAll(/<add-to-calendar-button\b([^>]*)>/gi)];
  const attrs = (tag) => Object.fromEntries([...tag.matchAll(/([\w-]+)\s*=\s*["']([^"']*)["']/g)].map(m=>[m[1].toLowerCase(),m[2].replace(/&amp;/g,'&')]));
  const calendar = calendars.length === 1 ? attrs(calendars[0][1]) : {};
  const date = /^\d{4}-\d{2}-\d{2}$/.test(calendar.startdate || '') && !Number.isNaN(Date.parse(`${calendar.startdate}T00:00:00Z`)) && new Date(`${calendar.startdate}T00:00:00Z`).toISOString().slice(0,10)===calendar.startdate ? calendar.startdate : null;
  const hasVisibleTime = /<div\b[^>]*class=["'][^"']*\bse-date-card__time\b/i.test(html);
  const time = hasVisibleTime && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(calendar.starttime || '') ? calendar.starttime : null;
  let end = /^\d{4}-\d{2}-\d{2}$/.test(calendar.enddate || '') && !Number.isNaN(Date.parse(`${calendar.enddate}T00:00:00Z`)) && new Date(`${calendar.enddate}T00:00:00Z`).toISOString().slice(0,10)===calendar.enddate && calendar.enddate>date ? calendar.enddate : null;
  if (end && time && calendar.endtime==='00:00' && Date.parse(`${end}T00:00:00Z`)-Date.parse(`${date}T00:00:00Z`)===86400000) end=null;
  const location = html.match(/<div\b[^>]*class=["'][^"']*\bse-location__address\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
  const venue = location ? textFromHtml(location[1]).trim() || null : null;
  let ticket = null;
  for (const match of html.matchAll(/<a\b([^>]*\bse-btn--tickets\b[^>]*)>/gi)) {
    const href=attrs(match[1]).href;
    try { const url=new URL(href); if (['http:','https:'].includes(url.protocol)) ticket=url.href; } catch {}
    if (ticket) break;
  }
  return {event_date:date,event_end_date:date?end:null,event_time:date?time:null,venue,ticket_url:ticket,ambiguous_dates:calendars.length>1};
}
const normalized = value => textFromHtml(value || '').normalize('NFKC').toLocaleLowerCase('lt').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
export function suggestArtists(event, artists, reviews) {
  const titleText=normalized(event.title), title=` ${titleText} `, body=` ${normalized(event.content_html)} `;
  return artists.map(a=>{
    const name=normalized(a.name); if(name.length<5 || reviews.has(a.mbid))return null;
    const singleWord=!name.includes(' '), needle=` ${name} `;
    const inTitle=singleWord ? titleText===name : title.includes(needle);
    const inBody=!singleWord && body.includes(needle);
    return inTitle || inBody ? {...a, reason:inTitle?'Title':'Description'} : null;
  }).filter(Boolean).sort((a,b)=>(a.reason==='Title'?-1:0)-(b.reason==='Title'?-1:0)||b.name.length-a.name.length).slice(0,8);
}
