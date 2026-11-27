import type { DisplayEvent } from './events-api';
import { displayText, eventSource } from './event-format';
import { artistsEnabled } from '../constants/features';
import { eventUrl } from './event-url';

function escapeText(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/\r\n|\r|\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
}

function foldLine(line: string) {
  const encoder = new TextEncoder();
  const lines: string[] = [];
  let current = '';
  for (const character of line) {
    if (encoder.encode(current + character).length > 75) {
      lines.push(current);
      current = ' ';
    }
    current += character;
  }
  lines.push(current);
  return lines.join('\r\n');
}

function compactDate(value: string) { return value.replace(/-/g, ''); }
export function hasCalendarTime(time: string | null | undefined) { return typeof time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(time); }

function nextDate(value: string) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

// Convert Vilnius wall time to UTC using the zone's offset on the event date.
function vilniusUtc(date: string, time: string) {
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const desired = Date.UTC(year, month - 1, day, hour, minute);
  const formatter = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Vilnius', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  let instant = desired;
  for (let i = 0; i < 3; i++) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(instant)).map(part => [part.type, part.value]));
    const represented = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute));
    instant += desired - represented;
  }
  return new Date(instant).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

export function calendarFile(event: DisplayEvent, now = new Date()) {
  if (!event.event_date) return null;
  const time = hasCalendarTime(event.event_time) ? event.event_time : null;
  const source = eventSource(event.about_url, event.source_url);
  const tickets = eventSource(null, event.ticket_url || '');
  const pageUrl = eventUrl(event);
  const description = [
    event.description?.trim(),
    artistsEnabled && event.artists?.length ? `Atlikėjai: ${event.artists.map(artist => displayText(artist.name)).join(', ')}` : '',
    event.price_text ? `Kaina: ${displayText(event.price_text)}` : event.price_type === 'free' ? 'Kaina: Nemokamas' : '',
    `Renginys Dracula: ${pageUrl}`,
    source ? `Renginio nuoroda: ${source.url}` : '',
    tickets ? `Bilietai: ${tickets.url}` : '',
  ].filter(Boolean).join('\n\n');
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Dracula//Events//LT', 'CALSCALE:GREGORIAN', 'BEGIN:VEVENT',
    `UID:event-${event.id}@dracula.lt`, `DTSTAMP:${now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')}`,
    `SUMMARY:${escapeText(displayText(event.title))}`,
  ];
  if (time) lines.push(`DTSTART:${vilniusUtc(event.event_date, time)}`);
  else {
    lines.push(`DTSTART;VALUE=DATE:${compactDate(event.event_date)}`);
    lines.push(`DTEND;VALUE=DATE:${compactDate(nextDate(event.event_end_date || event.event_date))}`);
  }
  if (event.venue) lines.push(`LOCATION:${escapeText(displayText(event.venue))}`);
  lines.push(`URL:${pageUrl}`);
  lines.push(`DESCRIPTION:${escapeText(description)}`);
  lines.push('END:VEVENT', 'END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}
