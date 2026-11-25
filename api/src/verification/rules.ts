import { descriptionText } from '../catalogue/description.js';
import { fail, jsonValue, type Snapshot } from './history.js';

const fields = ['title', 'event_date', 'event_end_date', 'event_time', 'venue', 'city', 'price_type', 'price_text', 'ticket_url', 'about_url', 'source_url', 'artists', 'image', 'review_status', 'cancellation', 'duplicate'] as const;
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

export const normalizeEvidence = (value: string) => value.normalize('NFKC').toLocaleLowerCase('lt').replace(/\s+/g, ' ').trim();
const structuredFields = ['event_date', 'event_end_date', 'event_time', 'venue', 'city', 'ticket_url'] as const;
type StructuredField = typeof structuredFields[number];

export function sourceEvidence(source: Snapshot) {
  let metadata: Snapshot = {};
  try { metadata = jsonValue<Snapshot>(source.source_data_json) ?? {}; } catch { /* Older source payloads can be malformed. */ }
  const imported = (metadata.structured_details as Snapshot | undefined) ?? {};
  let enriched: Snapshot = {};
  try { enriched = jsonValue<Snapshot>(source.detail_evidence_json) ?? {}; } catch { /* Keep the originally imported fields. */ }
  const normalizedDetails = Object.fromEntries(['event_date', 'event_end_date', 'event_time', 'venue', 'ticket_url', 'price_text', 'price_type']
    .map(field => [field, enriched[field] ?? imported[field]])
    .filter(([, value]) => typeof value === 'string'));
  const rawTime = typeof metadata.startTime === 'string' ? metadata.startTime : '';
  const avilys = source.source_key === 'avilys';
  const start = avilys ? /^(\d{4}-\d{2}-\d{2})T((?:[01]\d|2[0-3]):[0-5]\d)(?::[0-5]\d(?:\.\d{1,9})?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)?$/.exec(rawTime) : null;
  const startDay = avilys && /^\d{4}-\d{2}-\d{2}T/.test(rawTime) ? rawTime.slice(0, 10) : '';
  const candidates: Record<StructuredField, unknown> = {
    event_date: startDay || normalizedDetails.event_date,
    event_time: start && validField('event_date', start[1]) ? start[2] : normalizedDetails.event_time,
    event_end_date: normalizedDetails.event_end_date,
    venue: avilys ? metadata.venueName : normalizedDetails.venue,
    city: avilys ? metadata.city : source.source_key === 'vilnius-events' ? 'Vilnius' : undefined,
    ticket_url: avilys ? metadata.ticketUrl : normalizedDetails.ticket_url,
  };
  const structuredFieldsFound: Partial<Record<StructuredField, string>> = {};
  for (const field of structuredFields) {
    const value = candidates[field];
    if (typeof value === 'string' && validField(field, value.trim())) structuredFieldsFound[field] = value.trim();
  }
  const structured = Object.fromEntries(['title', 'city', 'venueName', 'ticketUrl', 'sourceUrl', 'priceFrom', 'priceTo', 'free', 'featured_media', 'image', 'imageUrl']
    .filter(field => typeof metadata[field] === 'string' || typeof metadata[field] === 'number' || typeof metadata[field] === 'boolean')
    .map(field => [field, metadata[field]]));
  return {
    source: source.source_key, listing_url: source.source_url, original_url: source.about_url,
    ...structured,
    title: descriptionText(typeof metadata.title === 'string' ? metadata.title : typeof source.original_title === 'string' ? source.original_title : String(source.fallback_title ?? '')),
    ...normalizedDetails,
    ...(avilys && rawTime ? { local_start: rawTime.slice(0, 16), source_start: rawTime } : {}),
    structured_fields: structuredFieldsFound,
    description: descriptionText(String(source.content_html ?? '')).slice(0, 18_000),
  };
}

export function evidenceText(evidence: ReturnType<typeof sourceEvidence>[]) {
  // Put each value on its own line so the model can quote description text or a structured value directly.
  return evidence.map(({ structured_fields, ...source }) => [...Object.values(source), ...Object.values(structured_fields)].filter(value => value != null).join('\n')).join('\n');
}

export function parseFindings(value: unknown, evidence: string): Finding[] {
  const findings = (value as { findings?: unknown })?.findings;
  if (!Array.isArray(findings) || findings.length > 35) throw fail(502, 'The model returned invalid findings.');
  return findings.flatMap(item => {
    if (item?.field === 'description' || item?.field === 'event') return [];
    if (!item || !fields.includes(item.field) || !dispositions.includes(item.disposition) ||
        typeof item.proposed !== 'string' || typeof item.evidence !== 'string' || typeof item.reason !== 'string' ||
        item.proposed.length > 2048 || item.evidence.length > 500 || !item.reason.trim() || item.reason.length > 500) throw fail(502, 'The model returned an invalid field result.');
    const finding: Finding = { field: item.field, disposition: item.disposition, proposed: item.proposed.trim(), evidence: item.evidence.trim(), reason: item.reason.trim() };
    if (finding.disposition === 'unknown') return { ...finding, proposed: '', evidence: '' };
    if (!finding.evidence || !normalizeEvidence(evidence).includes(normalizeEvidence(finding.evidence))) {
      return { ...finding, disposition: 'unknown', proposed: '', evidence: '', reason: 'The finding lacked a supporting quote.' };
    }
    return finding;
  });
}

export function reconcileStructuredFields(findings: Finding[], sources: ReturnType<typeof sourceEvidence>[], saved: Snapshot, manualFields: string[]) {
  const decisions = new Map<Field, Finding>();
  const descriptions = sources.map(source => normalizeEvidence(source.description));
  for (const field of structuredFields) {
    const provided = new Map<string, string>();
    for (const source of sources) {
      const value = source.structured_fields[field];
      if (value) provided.set(normalizeEvidence(value), value);
    }
    if (!provided.size) continue;

    const current = saved[field];
    const savedValue = typeof current === 'string' && current.trim() ? current : '';
    const matchesSaved = provided.has(normalizeEvidence(savedValue));
    if (savedValue && !matchesSaved && manualFields.includes(field)) continue;

    const values = [...provided.values()];
    const structured = values[0];
    const conflictingText = findings.find(finding => finding.field === field && finding.proposed && finding.evidence
      && !provided.has(normalizeEvidence(finding.proposed)) && canAutoFill(field, finding.proposed, finding.evidence)
      && descriptions.some(description => description.includes(normalizeEvidence(finding.evidence))));
    if (conflictingText) {
      decisions.set(field, { ...conflictingText, disposition: 'attention', reason: `The description disagrees with the structured source value (${structured}).` });
    } else if (values.length > 1) {
      decisions.set(field, { field, disposition: 'attention', proposed: '', evidence: values.join(' / '), reason: 'The structured sources give different values.' });
    } else if (savedValue && !matchesSaved) {
      decisions.set(field, { field, disposition: 'attention', proposed: structured, evidence: structured, reason: 'The saved value differs from the structured source.' });
    } else {
      decisions.set(field, { field, disposition: savedValue ? 'confirmed' : 'suggestion', proposed: savedValue || structured, evidence: structured, reason: 'The structured source supplies this value.' });
    }
  }
  return [...findings.filter(finding => !decisions.has(finding.field)), ...decisions.values()];
}

export const editable = ['title', 'description', 'event_date', 'event_end_date', 'event_time', 'venue', 'city', 'ticket_url', 'about_url', 'price_type', 'price_text', 'artists', 'review_status'] as const;
export type Editable = typeof editable[number];

export function validField(field: Field | Editable, value: string) {
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
  const quote = normalizeEvidence(evidence);
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
  return ['venue', 'city', 'ticket_url', 'about_url'].includes(field) && quote.includes(normalizeEvidence(value));
}
