import { descriptionText } from '../catalogue/description.js';
import { fail, jsonValue, type Snapshot } from './history.js';

const fields = ['title', 'description', 'event_date', 'event_end_date', 'event_time', 'venue', 'city', 'price_type', 'price_text', 'ticket_url', 'about_url', 'source_url', 'artists', 'image', 'review_status', 'cancellation', 'duplicate', 'event'] as const;
export type Field = typeof fields[number];
export type Finding = { field: Field; disposition: 'confirmed' | 'suggestion' | 'attention' | 'unknown'; proposed: string; evidence: string; reason: string };
const dispositions = ['confirmed', 'suggestion', 'attention', 'unknown'];
const text = { type: 'string' };
export const resultSchema = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: { field: { type: 'string', enum: fields }, disposition: { type: 'string', enum: dispositions }, proposed: text, evidence: text, reason: text },
        required: ['field', 'disposition', 'proposed', 'evidence', 'reason'],
        additionalProperties: false,
      },
    },
  },
  required: ['findings'],
  additionalProperties: false,
};

const norm = (value: string) => value.normalize('NFKC').toLocaleLowerCase('lt').replace(/\s+/g, ' ').trim();

export function sourceEvidence(source: Snapshot) {
  let metadata: Snapshot = {};
  try { metadata = jsonValue<Snapshot>(source.source_data_json) ?? {}; } catch { /* Older source payloads can be malformed. */ }
  let parsedDetails: Snapshot = {};
  try { parsedDetails = jsonValue<Snapshot>(source.detail_evidence_json) ?? (metadata.structured_details as Snapshot | undefined) ?? {}; } catch { /* Use the listing text when details are unavailable. */ }
  const normalizedDetails = Object.fromEntries(['event_date', 'event_end_date', 'event_time', 'venue', 'ticket_url', 'price_text', 'price_type']
    .filter(field => typeof parsedDetails[field] === 'string').map(field => [field, parsedDetails[field]]));
  const rawTime = typeof metadata.startTime === 'string' ? metadata.startTime : '';
  const structured = Object.fromEntries(['title', 'city', 'venueName', 'ticketUrl', 'sourceUrl', 'priceFrom', 'priceTo', 'free', 'featured_media', 'image', 'imageUrl']
    .filter(field => typeof metadata[field] === 'string' || typeof metadata[field] === 'number' || typeof metadata[field] === 'boolean')
    .map(field => [field, metadata[field]]));
  return {
    source: source.source_key, listing_url: source.source_url, original_url: source.about_url,
    ...structured,
    ...normalizedDetails,
    ...(source.source_key === 'avilys' && rawTime ? { local_start: rawTime.slice(0, 16), source_start: rawTime } : {}),
    description: descriptionText(String(source.content_html ?? '')).slice(0, 18_000),
  };
}

export function evidenceText(evidence: ReturnType<typeof sourceEvidence>[]) {
  // Put each value on its own line so the model can quote description text or a structured value directly.
  return evidence.map(source => Object.values(source).filter(value => value != null).join('\n')).join('\n');
}

export function parseFindings(value: unknown, evidence: string): Finding[] {
  const findings = (value as { findings?: unknown })?.findings;
  if (!Array.isArray(findings) || !findings.length || findings.length > 35) throw fail(502, 'The model returned invalid findings.');
  return findings.map(item => {
    if (!item || !fields.includes(item.field) || !dispositions.includes(item.disposition) ||
        typeof item.proposed !== 'string' || typeof item.evidence !== 'string' || typeof item.reason !== 'string' ||
        item.proposed.length > 2048 || item.evidence.length > 500 || !item.reason.trim() || item.reason.length > 500) throw fail(502, 'The model returned an invalid field result.');
    const finding: Finding = { field: item.field, disposition: item.disposition, proposed: item.proposed.trim(), evidence: item.evidence.trim(), reason: item.reason.trim() };
    if (finding.disposition === 'unknown') return { ...finding, proposed: '', evidence: '' };
    if (!finding.evidence || !norm(evidence).includes(norm(finding.evidence))) {
      return { ...finding, disposition: 'attention', proposed: '', evidence: '', reason: 'The model could not substantiate its finding with a quote from the source.' };
    }
    return finding;
  });
}

export const editable = ['title', 'description', 'event_date', 'event_end_date', 'event_time', 'venue', 'city', 'ticket_url', 'about_url', 'price_type', 'price_text', 'artists', 'review_status'] as const;
export type Editable = typeof editable[number];

export function validField(field: Field, value: string) {
  if (!value.trim()) return false;
  if (field === 'event_date' || field === 'event_end_date') {
    const day = new Date(`${value}T00:00:00Z`);
    return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(+day) && day.toISOString().slice(0, 10) === value;
  }
  if (field === 'event_time') return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
  if (field === 'review_status') return ['music', 'not_music', 'unsure'].includes(value);
  if (field === 'price_type') return ['free', 'paid', 'unknown'].includes(value);
  if (field === 'ticket_url' || field === 'about_url') {
    try {
      const url = new URL(value);
      return value.length <= 2048 && ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
    } catch { return false; }
  }
  return value.length <= (field === 'description' ? 2048 : field === 'title' ? 500 : 300);
}

const months = ['sausio', 'vasario', 'kovo', 'balandžio', 'gegužės', 'birželio', 'liepos', 'rugpjūčio', 'rugsėjo', 'spalio', 'lapkričio', 'gruodžio'];
export function canAutoFill(field: Field, value: string, evidence: string) {
  if (!validField(field, value) || evidence.length < 2) return false;
  const quote = norm(evidence);
  if (field === 'event_date' || field === 'event_end_date') {
    const [year, month, day] = value.split('-');
    const words = `${months[Number(month) - 1]} ${Number(day)}`;
    const bounded = new RegExp(`(?:^|[^0-9])${words}(?:[^0-9]|$)`, 'u');
    return quote.includes(value) || (quote.includes(year) && bounded.test(quote)) || quote.includes(value.split('-').reverse().join('.'));
  }
  if (field === 'event_time') {
    const [hour, minute] = value.split(':');
    return new RegExp(`(?:^|[^0-9])(?:${hour}|${Number(hour)})[.:]${minute}(?:[^0-9]|$)`, 'u').test(quote);
  }
  if (field === 'price_type') {
    if (value === 'free') return /(?:^|[^\p{L}])(?:nemokama[sia]?|free (?:entry|admission)|įėjimas laisvas)(?:$|[^\p{L}])/u.test(quote);
    return value === 'paid' && /\d\s*(?:€|eur\b)/u.test(quote);
  }
  if (field === 'price_text' && !/\d/.test(value)) return false;
  return ['venue', 'city', 'price_text', 'ticket_url', 'about_url'].includes(field) && quote.includes(norm(value));
}
