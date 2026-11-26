import { matchesDate, selectedDates } from '../shared/event-date-filters';
import { displayText } from './event-format';
import type { DisplayEvent } from './events-api';
import { artistsEnabled } from '../constants/features';

export const normalizeEventSearch = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('lt');
export function matchesEventSearch(event: DisplayEvent, term: string) {
  return !term || normalizeEventSearch([event.title, event.venue ?? '', ...(artistsEnabled ? event.artists.map(artist => artist.name) : [])].map(displayText).join(' ')).includes(term);
}

export function transitionEvents(events: DisplayEvent[], filter: string, from: string, to: string, today: string, search: string, freeOnly: boolean, city = '') {
  const range = selectedDates(filter, from, to, new Date(`${today}T12:00:00Z`));
  const term = normalizeEventSearch(search);
  const targetCity = normalizeEventSearch(city);
  return events.filter(event => (!targetCity || normalizeEventSearch(event.city?.trim() ?? '') === targetCity) &&
    matchesDate(event, filter, range, today) && (!freeOnly || event.price_type === 'free') && matchesEventSearch(event, term));
}
