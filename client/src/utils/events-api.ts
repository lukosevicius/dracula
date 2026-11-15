import type { PublicEvent } from '../../../seeker/types';

export type DisplayEvent = PublicEvent & { image_url?: string | null };
export const apiUrl = (process.env.EXPO_PUBLIC_API_URL || '').replace(/\/$/, '');
export type EventPage = { items: DisplayEvent[]; total: number; nextOffset: number | null };

async function request<T>(path: string, signal: AbortSignal): Promise<T | null> {
  const response = await fetch(`${apiUrl}${path}`, { signal });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`API returned ${response.status}`);
  return response.json();
}
export async function fetchEvents(filter: string, from: string, to: string, offset: number, signal: AbortSignal): Promise<EventPage> {
  const query = new URLSearchParams({ filter, offset: String(offset), limit: '30' });
  if (filter === 'custom') { query.set('from', from); if (to) query.set('to', to); }
  const page = await request<EventPage>(`/v1/events?${query}`, signal);
  if (!page || !Array.isArray(page.items) || !Number.isInteger(page.total)) throw new Error('Invalid API response');
  return page;
}
export function fetchEvent(id: string, signal: AbortSignal) {
  if (!/^\d{1,12}$/.test(id)) return Promise.resolve(null);
  return request<DisplayEvent>(`/v1/events/${id}`, signal);
}
