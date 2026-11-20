import type { Artist, ArtistSuggestion } from '../types.js';
const months: Record<string, number> = {sausio:1,vasario:2,kovo:3,balandžio:4,gegužės:5,birželio:6,liepos:7,rugpjūčio:8,rugsėjo:9,spalio:10,lapkričio:11,gruodžio:12};
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
export function classifyPrice(value: string | null): 'free' | 'paid' | 'unknown' {
  const text = (value || '').trim();
  if (!text) return 'unknown';
  if (/\bne\s*mokam/i.test(text) && !/\d/.test(text)) return 'free';
  const amounts = [...text.matchAll(/\d+(?:[.,]\d+)?/g)].map(match => Number(match[0].replace(',', '.')));
  if (!amounts.length) return 'unknown';
  if (amounts.every(amount => amount === 0)) return 'free';
  if (amounts.every(amount => amount > 0) && !/\bne\s*mokam/i.test(text)) return 'paid';
  return 'unknown';
}

export function extractEventPrice(html = ''): {price_text:string|null;price_type:'free'|'paid'|'unknown'} {
  const section = html.match(/<div\b[^>]*class=["'][^"']*\bse-sidebar__price\b[^"']*["'][^>]*>([\s\S]*?)<!--\s*Upcoming dates/i)?.[1];
  if (!section) return {price_text:null,price_type:'unknown'};
  const line=section.match(/<div\b[^>]*class=["'][^"']*\bse-price-line\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1];
  if (!line) return {price_text:null,price_type:'unknown'};
  const text=textFromHtml(line).replace(/&euro;/gi,'€').replace(/\s+/g,' ').trim() || null;
  return {price_text:text,price_type:classifyPrice(text)};
}
export function extractPageDetails(html = '', sourceUrl = 'https://www.vilnius-events.lt/') {
  const calendars = [...html.matchAll(/<add-to-calendar-button\b([^>]*)>/gi)];
  const attrs = (tag: string) => Object.fromEntries([...tag.matchAll(/([\w-]+)\s*=\s*["']([^"']*)["']/g)].map(m=>[m[1].toLowerCase(),m[2].replace(/&amp;/g,'&')]));
  const calendar = calendars.length === 1 ? attrs(calendars[0][1]) : {};
  let date = /^\d{4}-\d{2}-\d{2}$/.test(calendar.startdate || '') && !Number.isNaN(Date.parse(`${calendar.startdate}T00:00:00Z`)) && new Date(`${calendar.startdate}T00:00:00Z`).toISOString().slice(0,10)===calendar.startdate ? calendar.startdate : null;
  const hasVisibleTime = /<div\b[^>]*class=["'][^"']*\bse-date-card__time\b/i.test(html);
  let time = hasVisibleTime && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(calendar.starttime || '') ? calendar.starttime : null;
  // Read only the event's own date card, never dates from related event cards.
  const cards = [...html.matchAll(/<(div|section|article)\b[^>]*class=["'][^"']*\bse-date-card\b[^"']*["'][^>]*>/gi)].map(match=>{
    const tag=match[1], start=match.index+match[0].length;
    const tags=new RegExp(`<\\/?${tag}\\b[^>]*>`, 'gi'); tags.lastIndex=start;
    let depth=1, next;
    while ((next=tags.exec(html))) {
      if (/^<\//.test(next[0])) depth--; else if (!/\/>$/.test(next[0])) depth++;
      if (!depth) return html.slice(start,next.index);
    }
    return '';
  });
  if (!date && calendars.length <= 1 && cards.length === 1) {
    const card = textFromHtml(cards[0]).replace(/\s+/g, ' ');
    const match = card.match(/\b(sausio|vasario|kovo|balandžio|gegužės|birželio|liepos|rugpjūčio|rugsėjo|spalio|lapkričio|gruodžio)\s+(\d{1,2}),?\s+(20\d{2})\b/i);
    if (match) {
      const y=Number(match[3]), m=months[match[1].toLowerCase()], d=Number(match[2]);
      const value=new Date(Date.UTC(y,m-1,d));
      if (value.getUTCFullYear()===y && value.getUTCMonth()===m-1 && value.getUTCDate()===d) date=value.toISOString().slice(0,10);
    }
    const timeMatch = cards[0].match(/<[^>]*class=["'][^"']*\bse-date-card__time\b[^"']*["'][^>]*>([\s\S]*?)<\//i);
    const visibleTime = timeMatch && textFromHtml(timeMatch[1]).match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
    if (date && visibleTime) time=`${visibleTime[1].padStart(2,'0')}:${visibleTime[2]}`;
  }
  let end = date && /^\d{4}-\d{2}-\d{2}$/.test(calendar.enddate || '') && !Number.isNaN(Date.parse(`${calendar.enddate}T00:00:00Z`)) && new Date(`${calendar.enddate}T00:00:00Z`).toISOString().slice(0,10)===calendar.enddate && calendar.enddate>date ? calendar.enddate : null;
  if (end && time && calendar.endtime==='00:00' && Date.parse(`${end}T00:00:00Z`)-Date.parse(`${date}T00:00:00Z`)===86400000) end=null;
  const location = html.match(/<div\b[^>]*class=["'][^"']*\bse-location__address\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
  const venue = location ? textFromHtml(location[1]).trim() || null : null;
  let ticket = null;
  for (const match of html.matchAll(/<a\b([^>]*\bse-btn--tickets\b[^>]*)>/gi)) {
    const href=attrs(match[1]).href;
    try { const url=new URL(href); if (['http:','https:'].includes(url.protocol)) ticket=url.href; } catch {}
    if (ticket) break;
  }
  let aboutUrl: string | null = null;
  for (const match of html.matchAll(/<a\b([^>]*)>/gi)) {
    const attributes=attrs(match[1]);
    if (!attributes.class?.split(/\s+/).includes('se-btn--about')) continue;
    const href=attributes.href;
    try { if (href) { const url=new URL(href,sourceUrl); if (['http:','https:'].includes(url.protocol)) aboutUrl=url.href; } } catch { /* Ignore invalid links. */ }
    if (aboutUrl) break;
  }
  return {event_date:date,event_end_date:date?end:null,event_time:date?time:null,venue,ticket_url:ticket,about_url:aboutUrl,ambiguous_dates:calendars.length>1 || (!date && cards.length>1)};
}
const normalized = (value: string) => textFromHtml(value || '').normalize('NFKC').toLocaleLowerCase('lt').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
export function suggestArtists(event: {title: string; content_html: string}, artists: Artist[], reviews: Set<string>): ArtistSuggestion[] {
  const titleText=normalized(event.title), title=` ${titleText} `, body=` ${normalized(event.content_html)} `;
  return artists.map(a=>{
    const name=normalized(a.name); if(name.length<5 || reviews.has(a.mbid))return null;
    const needle=` ${name} `;
    const inTitle=title.includes(needle);
    const inBody=body.includes(needle);
    if (!inTitle && !inBody) return null;
    const original = textFromHtml(inTitle ? event.title : event.content_html).replace(/\s+/g,' ').trim();
    const sections = original.match(/[^.!?\n]+(?:[.!?]|$)/g) || [original];
    const excerpt = sections.find(part => ` ${normalized(part)} `.includes(needle))?.trim() || original;
    return {...a, reason:inTitle?'Title' as const:'Description' as const, excerpt:excerpt.length>240 ? excerpt.slice(0,237)+'…' : excerpt};
  }).filter((item): item is ArtistSuggestion => item !== null).sort((a,b)=>(a.reason==='Title'?-1:0)-(b.reason==='Title'?-1:0)||b.name.length-a.name.length).slice(0,8);
}
