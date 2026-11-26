import type { Showtime } from './events-api';
import { vilniusDate } from '../shared/event-date-filters';

export function displayDate(value: string | null) {
  return value ? new Intl.DateTimeFormat('lt-LT', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`)) : 'Data nežinoma';
}

export function displayText(value: string) {
  return value.replace(/&#(x[\da-f]+|\d+);/gi, (entity, code: string) => {
    const point = code[0].toLowerCase() === 'x' ? parseInt(code.slice(1), 16) : Number(code);
    return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff) ? String.fromCodePoint(point) : entity;
  });
}

export function eventLocation(venue: string | null, city?: string | null) {
  return [venue?.trim(), city?.trim()].filter((value): value is string => Boolean(value)).map(displayText).join(', ');
}

export function eventSource(aboutUrl: string | null, sourceUrl: string) {
  for (const candidate of [aboutUrl, sourceUrl]) {
    if (!candidate) continue;
    try {
      const url = new URL(candidate);
      if (url.protocol === 'https:' || url.protocol === 'http:') return { url: url.href, label: url.hostname.replace(/^www\./, '') };
    } catch { /* Try the fallback. */ }
  }
  return null;
}

const timeRange = (slot: Showtime) => slot.time ? `${slot.time}${slot.end_time ? `–${slot.end_time}` : ''}` : 'laikas nežinomas';

/** Several showings on one day, as "16:00, 19:00". Null when there is one showing or they span several days. */
export function sameDayTimes(times: Showtime[] | undefined) {
  if (!times || times.length < 2 || times.some(slot => slot.date !== times[0].date)) return null;
  return times.map(timeRange).join(', ');
}

/** Showings across several days, one line per day: "2026 m. gruodžio 12 d. · 18:00, 20:00". */
export function showtimeLines(times: Showtime[] | undefined) {
  if (!times || times.length < 2 || sameDayTimes(times)) return [];
  const days = new Map<string, Showtime[]>();
  for (const slot of times) days.set(slot.date, [...days.get(slot.date) ?? [], slot]);
  return [...days].map(([date, slots]) => `${displayDate(date)}${slots.some(slot => slot.time) ? ` · ${slots.map(timeRange).join(', ')}` : ''}`);
}

/** Short price label for cards and details: "Nemokamai", "Nuo 22 €", or null when unknown. */
export function eventPrice(event: { price_type?: 'free' | 'paid' | 'unknown' | null; price_text?: string | null }) {
  const text = event.price_text?.trim();
  if (text && !/^nemokam/i.test(text)) return displayText(text);
  return text || event.price_type === 'free' ? 'Nemokamai' : null;
}

const shortMonths = ['saus.', 'vas.', 'kov.', 'bal.', 'geg.', 'birž.', 'liep.', 'rugp.', 'rugs.', 'spal.', 'lapkr.', 'gruod.'];

/** Compact card date, "lapkr. 27"; the year is added only when it is not the current one ("2027 m. saus. 15"). */
export function shortDate(value: string | null, today = vilniusDate()) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return 'Data nežinoma';
  const [year, month, day] = value.split('-').map(Number);
  const label = `${shortMonths[month - 1]} ${day}`;
  return value.slice(0, 4) === today.slice(0, 4) ? label : `${year} m. ${label}`;
}
