/**
 * Anonymous, cookieless visit statistics with PostHog (EU). Nothing is stored in the visitor's browser:
 * PostHog tells visits apart with a daily-changing hash made on its servers, and no person profiles are kept.
 *
 * Loaded only on the live site, only when a project key is configured, and never in a browser that opened
 * dracula.lt/?nostats (undo with /?stats). PostHog ignores its own opt-out in cookieless mode, so opting out
 * here means PostHog is never loaded at all.
 */
import type { PostHog } from 'posthog-js';
import { notify } from './notify';

const key = process.env.EXPO_PUBLIC_POSTHOG_KEY || '';
const liveHosts = new Set(['dracula.lt']);
const optOutKey = 'dracula.nostats';

let client: PostHog | null = null;
let queue: [string, Record<string, unknown> | undefined][] = [];
let started = false;
let loading = false;

function optedOut() {
  try { return localStorage.getItem(optOutKey) === '1'; } catch { return false; }
}

/** Handles ?nostats / ?stats, then removes the parameter so the address stays clean. */
function applySwitch() {
  const url = new URL(window.location.href);
  const off = url.searchParams.has('nostats');
  const on = url.searchParams.has('stats');
  if (!off && !on) return;
  try {
    if (off) localStorage.setItem(optOutKey, '1'); else localStorage.removeItem(optOutKey);
    const message = off ? 'Statistika šioje naršyklėje išjungta.' : 'Statistika šioje naršyklėje įjungta.';
    // The header that shows notices appears with the first screen, a moment after this runs.
    setTimeout(() => notify(message), 800);
  } catch {
    setTimeout(() => notify('Nepavyko pakeisti statistikos nustatymo šioje naršyklėje.'), 800);
  }
  url.searchParams.delete('nostats');
  url.searchParams.delete('stats');
  // After the router has settled, or it writes the original address back.
  setTimeout(() => window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash), 800);
}

export function startAnalytics() {
  if (started || typeof window === 'undefined') return;
  started = true;
  applySwitch();
  if (!key || !liveHosts.has(window.location.hostname) || optedOut()) return;
  loading = true;
  void import('posthog-js').then(({ default: posthog }) => {
    posthog.init(key, {
      api_host: 'https://eu.i.posthog.com',
      ui_host: 'https://eu.posthog.com',
      cookieless_mode: 'always',
      person_profiles: 'never',
      capture_pageview: 'history_change',
      capture_pageleave: true,
      autocapture: true,
      capture_heatmaps: true,
      disable_session_recording: true,
      disable_surveys: true,
      advanced_disable_flags: true,
    });
    client = posthog;
    for (const [name, properties] of queue) posthog.capture(name, properties);
    queue = [];
  }).catch(() => { loading = false; queue = []; });
}

export { eventDetails } from './analytics-details';

/** Records a named action, such as "event_saved". Does nothing where statistics are off. */
export function track(name: string, properties?: Record<string, unknown>) {
  if (client) client.capture(name, properties);
  else if (loading && queue.length < 50) queue.push([name, properties]);
}
