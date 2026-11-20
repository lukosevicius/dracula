import { useCallback, useEffect, useRef, useState } from 'react';
import type { EventRecord, ImportRun, ReviewStatus } from '../../types';

export type EventRow = Omit<EventRecord, 'source_id' | 'artist_links' | 'artist_suggestions' | 'content_html'> & {
  id: number;
  source_id: string;
  source_key: string;
  about_url: string | null;
  assistant_reviewed_at: string | null;
  assistant_confirmed_at: string | null;
  assistant_notes: string | null;
};

export function priceInfo(row: Pick<EventRow, 'source_key' | 'price_text' | 'price_type'>) {
  const legacy = row.source_key === 'avilys' && /^Avilys: (free|paid) \(verify\)$/.exec(row.price_text || '');
  return {
    text: legacy ? '' : row.price_text || '',
    type: legacy && row.price_type === 'unknown' ? legacy[1] as 'free' | 'paid' : row.price_type || 'unknown',
  };
}

export type EventPage = {
  events: EventRow[];
  total: number;
  page: number;
  limit: number;
  counts: Record<ReviewStatus | 'total' | 'unknown', number>;
  readyCount: number;
  nextPage: number;
  runs: ImportRun[];
  sources: { source_key: string }[];
};

export type Job = {
  id: number;
  source: string;
  action: string;
  status: string;
  progress_json: string;
  error_message: string | null;
  started_at: string;
};

export const labels: Record<ReviewStatus, string> = { music: 'Music', not_music: 'Not music', unsure: 'Unsure' };

export const sourceNames: Record<string, string> = { avilys: 'Avilys', 'vilnius-events': 'Vilnius Events', musicbrainz: 'MusicBrainz' };

export const jobLabels: Record<string, string> = {
  next: 'Next batch',
  start: 'Import from beginning',
  all: 'Import all artists',
  import: 'Import events',
  refresh: 'Refresh newest page',
  sample: 'Import 10 events',
  'download-images': 'Download missing images',
  details: 'Get details for 10 events',
  'refresh-details': 'Refresh 10 oldest checks',
  'refresh-all-details': 'Refresh all event details',
  'details-event': 'Refresh event details',
};

export const reviews = Object.keys(labels) as ReviewStatus[];

export const isActive = (job: Job) => ['running', 'queued'].includes(job.status);

export function formatDate(date: string, time = false) {
  const value = new Date(date.length === 10 ? `${date}T12:00:00Z` : date);
  if (Number.isNaN(value.getTime())) return date;
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: time ? 'short' : undefined,
    timeZone: 'Europe/Vilnius',
  }).format(value);
}

export function safeUrl(url: string | null | undefined) {
  try {
    const value = new URL(url || '');
    return ['http:', 'https:'].includes(value.protocol) ? value.href : undefined;
  } catch {
    return undefined;
  }
}

export const plainText = (html: string) => new DOMParser().parseFromString(html, 'text/html').body.textContent || '';
export const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);

export async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, body === undefined ? undefined : {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  const result: unknown = await response.json().catch(() => null);
  if (!response.ok || result === null) {
    throw new Error((result as { error?: string } | null)?.error || 'Seeker could not complete the request.');
  }
  return result as T;
}

export function useJobs(onFinished: (completed: Job[]) => void) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [startingSource, setStartingSource] = useState<string | null>(null);
  const previous = useRef(new Set<number>());
  const requestId = useRef(0);
  const lastApplied = useRef(0);
  const onFinishedRef = useRef(onFinished);
  useEffect(() => { onFinishedRef.current = onFinished; }, [onFinished]);

  const load = useCallback(async () => {
    const id = ++requestId.current;
    try {
      const result = await api<{ jobs: Job[] }>('/api/jobs');
      if (id < lastApplied.current) return;
      lastApplied.current = id;
      const finished = result.jobs.filter(job => !isActive(job) && previous.current.has(job.id));
      for (const job of result.jobs) {
        if (isActive(job)) previous.current.add(job.id);
        else previous.current.delete(job.id);
      }
      setJobs(result.jobs);
      if (finished.length) onFinishedRef.current(finished);
    } catch {
      // The next poll can retry.
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 2000);
    return () => window.clearInterval(timer);
  }, [load]);

  const start = async (source: string, action: string, params: Record<string, unknown> = {}) => {
    setStartingSource(source);
    try {
      const result = await api<{ id: number }>('/api/jobs', { source, action, ...params });
      previous.current.add(result.id);
      await load();
    } finally {
      setStartingSource(null);
    }
  };
  return { jobs, start, startingSource };
}
