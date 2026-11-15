export type ReviewStatus = 'music' | 'not_music' | 'unsure';
export type ArtistDecision = 'accepted' | 'dismissed' | 'remove';
export type DateFilter = 'upcoming' | 'today' | 'tomorrow' | 'weekend' | 'custom' | 'all' | 'past' | 'unknown';

export interface EventDetails {
  event_date: string | null;
  event_end_date: string | null;
  event_time: string | null;
  venue: string | null;
  ticket_url: string | null;
}
export interface PublicEvent extends Pick<EventDetails, 'event_date' | 'event_end_date' | 'event_time' | 'venue' | 'ticket_url'> {
  id: number;
  title: string;
  source_url: string;
  about_url: string | null;
  description: string;
  image: number | null;
  artists: Artist[];
}
export interface Artist { mbid: string; name: string }
export interface ArtistSuggestion extends Artist { reason: 'Title' | 'Description'; excerpt: string }
export interface EventRecord extends EventDetails {
  source_id: number;
  title: string;
  source_url: string;
  content_html: string;
  manual_fields: string;
  review_status: ReviewStatus;
  details_checked_at: string | null;
  artist_links: { artist_mbid: string; name: string }[];
  artist_suggestions: ArtistSuggestion[];
}
export interface ImportRun {
  started_at: string;
  status: string;
  fetched_count: number;
  added_count: number;
  updated_count: number;
  error_message: string | null;
}
export interface EventsDashboard {
  total: number;
  nextPage: number;
  running: boolean;
  runs: ImportRun[];
  events: EventRecord[];
}
export interface MusicBrainzArtist {
  id: string;
  name: string;
  country?: string;
  type?: string;
  'sort-name'?: string;
  area?: { name: string };
  'begin-area'?: { name: string };
  'life-span'?: { begin?: string; end?: string };
  disambiguation?: string;
  aliases?: { name: string }[];
}
export interface MusicBrainzPage { artists?: MusicBrainzArtist[] }
export interface DashboardArtist extends Artist {
  artist_type: string | null;
  area: string | null;
  country: string | null;
  source_url: string;
  first_seen_at: string;
}
export interface MusicBrainzRun extends ImportRun { mode: 'next' | 'start' | 'all' }
export interface ArtistsDashboard {
  totalArtists: number;
  lastRun: MusicBrainzRun | null;
  recentRuns: MusicBrainzRun[];
  artists: DashboardArtist[];
  sourceState: { next_offset: number; total_available: number | null } | null;
  importInProgress: boolean;
}
export interface SourceEvent {
  id: number;
  title: { rendered: string };
  link: string;
  content?: { rendered?: string };
  categories?: number[];
  featured_media?: number;
  date?: string;
  modified?: string;
}
