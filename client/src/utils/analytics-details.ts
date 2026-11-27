import { displayText } from './event-format';

/** Readable details sent with event actions, so PostHog shows the event's name rather than only its id. */
export function eventDetails(event: { id: number; title: string; venue?: string | null; event_date?: string | null }) {
  return { event_id: event.id, event_name: displayText(event.title), venue: event.venue ? displayText(event.venue) : null, event_date: event.event_date ?? null };
}
