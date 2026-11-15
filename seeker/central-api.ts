import type { ArtistDecision, EventDetails, ReviewStatus } from './types.js';

type Price = { price_text: string | null; price_type: 'free' | 'paid' | 'unknown' };
type Details = EventDetails & { review_status: ReviewStatus };

/** Server-side client only. Do not pass the token to the dashboard or browser. */
export function createCentralApi(origin: string, token: string, timeoutMs = 15000) {
  const base = new URL(origin);
  if (base.username || base.password || base.pathname !== '/' || base.search || base.hash || !['http:', 'https:'].includes(base.protocol)) throw new Error('Central API URL must be an HTTP(S) origin.');
  if (base.protocol !== 'https:' && !['localhost','127.0.0.1','[::1]'].includes(base.hostname)) throw new Error('Central API requires HTTPS outside local development.');
  if (!/^[A-Za-z0-9._~-]{32,}$/.test(token)) throw new Error('Central API token must contain at least 32 URL-safe ASCII characters.');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) throw new Error('Invalid central API timeout.');

  async function edit(id: number, action: 'review' | 'details' | 'artist' | 'price', payload: object): Promise<void> {
    if (!Number.isSafeInteger(id) || id < 1 || id > 999999999999) throw new Error('Invalid event ID.');
    let response: Response;
    try {
      response = await fetch(new URL(`/v1/admin/events/${id}/${action}`, base), {
        method:'POST', headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},
        body:JSON.stringify(payload), redirect:'error', signal:AbortSignal.timeout(timeoutMs)
      });
    } catch { throw new Error('Central API request failed; the update outcome is unknown. Check the event before retrying.'); }
    if (!response.ok) {
      const uncertain = response.status >= 500 || response.status === 408;
      const message = uncertain ? `Central API returned HTTP ${response.status}; the update outcome is unknown. Check the event before retrying.` : `Central API rejected the update (HTTP ${response.status}).`;
      throw Object.assign(new Error(message), { status:response.status });
    }
    const body = await response.json().catch(() => null) as {ok?:unknown} | null;
    if (!body || body.ok !== true) throw new Error('Central API returned an invalid response; check the event before retrying.');
  }
  return {
    review: (id:number, review_status:ReviewStatus) => edit(id,'review',{review_status}),
    details: (id:number, details:Details) => edit(id,'details',details),
    artist: (id:number, mbid:string, decision:ArtistDecision) => edit(id,'artist',{mbid,decision}),
    price: (id:number, price:Price) => edit(id,'price',price),
  };
}
