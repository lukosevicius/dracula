/**
 * Event addresses: /renginiai/kariuomenes-dienos-minejimas-delcia-423.
 * The number at the end finds the event; the words are only for people and search engines,
 * so a renamed event's old address still works and is replaced with the current one.
 * web/event.php builds the same words for link previews; keep the two in step.
 */
import { displayText } from './event-format';

export const siteUrl = 'https://dracula.lt';
const maxSlugLength = 60;

/** "Kariuomenės dienos minėjimas/koncertas" → "kariuomenes-dienos-minejimas-koncertas". */
export function eventSlug(title: string): string {
  // Markup and entities never become words, matching event.php's clean().
  const plain = displayText(title.replace(/<[^>]*>/g, ' ')).replace(/&[a-z]+;/gi, ' ');
  const words = plain.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (words.length <= maxSlugLength) return words;
  const cut = words.slice(0, maxSlugLength + 1);
  const lastDash = cut.lastIndexOf('-');
  return (lastDash > 0 ? cut.slice(0, lastDash) : cut.slice(0, maxSlugLength)).replace(/-+$/, '');
}

/** The route segment after /renginiai/, such as "delcia-423", or "423" when the title has no letters or digits. */
export function eventSegment(event: { id: number | string; title: string }): string {
  const slug = eventSlug(event.title);
  return slug ? `${slug}-${event.id}` : String(event.id);
}

export function eventPath(event: { id: number | string; title: string }): string {
  return `/renginiai/${eventSegment(event)}`;
}

export function eventUrl(event: { id: number | string; title: string }): string {
  return siteUrl + eventPath(event);
}

/** The event id at the end of a route segment, or null when there is none. */
export function eventIdFromSegment(segment: string | undefined): string | null {
  return /(?:^|-)([1-9]\d{0,11})$/.exec(segment ?? '')?.[1] ?? null;
}
