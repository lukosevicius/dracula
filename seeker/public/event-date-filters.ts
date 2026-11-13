import type { DateFilter, EventDetails } from '../types.js';

export function vilniusDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {timeZone:'Europe/Vilnius',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
  const value = Object.fromEntries(parts.map(part => [part.type,part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function shiftDate(date: string, days: number) {
  const result = new Date(`${date}T00:00:00Z`);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0,10);
}

export function selectedDates(filter: string, from: string, to: string, now = new Date()) {
  const today = vilniusDate(now);
  if (filter === 'today') return {from:today,to:today};
  if (filter === 'tomorrow') { const day=shiftDate(today,1); return {from:day,to:day}; }
  if (filter === 'weekend') {
    const day = new Date(`${today}T00:00:00Z`).getUTCDay();
    const saturday = shiftDate(today,day===0 ? -1 : 6-day);
    return {from:saturday,to:shiftDate(saturday,1)};
  }
  if (filter === 'custom') {
    if (!from) return {error:'Choose a start date.'};
    if (to && to < from) return {error:'End date must be on or after the start date.'};
    return {from,to:to || from};
  }
  return null;
}

export function matchesDate(event: Pick<EventDetails, 'event_date'> & Partial<Pick<EventDetails, 'event_end_date'>>, filter: DateFilter | string, range: {from?: string; to?: string; error?: string} | null, today: string) {
  const start=event.event_date, end=event.event_end_date || start;
  if (filter==='all') return true;
  if (filter==='unknown') return !start;
  if (filter==='past') return Boolean(start && end < today);
  if (filter==='upcoming') return Boolean(start && end >= today);
  return Boolean(!range?.error && range && start && start <= range.to && end >= range.from);
}
