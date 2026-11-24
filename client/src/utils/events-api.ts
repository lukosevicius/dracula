import type { PublicEvent } from '../../../seeker/types';

export type DisplayEvent = PublicEvent & { event_end_time?: string | null; image_url?: string | null; price_type?: 'free' | 'paid' | 'unknown' | null; price_text?: string | null };
export const apiUrl = (process.env.EXPO_PUBLIC_API_URL || 'https://api.dracula.lt').replace(/\/$/, '');
export type EventPage = { items: DisplayEvent[]; total: number; nextOffset: number | null };

async function request<T>(path: string, signal: AbortSignal): Promise<T | null> {
  const response = await fetch(`${apiUrl}${path}`, { signal });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`API returned ${response.status}`);
  return response.json();
}
export async function fetchEvents(filter: string, from: string, to: string, offset: number, signal: AbortSignal, limit = 30, artists: string[] = []): Promise<EventPage> {
  const query = new URLSearchParams({ filter, offset: String(offset), limit: String(limit) });
  if (artists.length) query.set('artists', artists.join(','));
  if (filter === 'custom') { query.set('from', from); if (to) query.set('to', to); }
  const page = await request<EventPage>(`/v1/events?${query}`, signal);
  if (!page || !Array.isArray(page.items) || !Number.isInteger(page.total)) throw new Error('Invalid API response');
  return page;
}
export function fetchArtist(id: string, signal: AbortSignal) {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)) return Promise.resolve(null);
  return request<{mbid:string;name:string}>(`/v1/artists/${encodeURIComponent(id)}`, signal);
}
export function fetchEvent(id: string, signal: AbortSignal) {
  if (!/^\d{1,12}$/.test(id)) return Promise.resolve(null);
  return request<DisplayEvent>(`/v1/events/${id}`, signal);
}
