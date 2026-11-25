import { vilniusToday } from '../catalogue/catalogue.service.js';
import { normalizeArtist, quotedArtistName, type ArtistCandidate } from './artists.js';
import { canAutoFill, editable, normalizeEvidence, validField, type Editable, type Finding } from './rules.js';
import type { RuleAction, Rules } from './rule-settings.js';
import type { Snapshot } from './history.js';

export const important = ['event_date', 'event_time', 'venue'] as const;
export type FindingDetails = Omit<Finding, 'field'> & {
  field: Finding['field'] | 'description' | 'event' | 'publication_status';
  current: unknown;
  artistId?: string;
  candidates?: ArtistCandidate[];
};
export type Outcome = {
  status: 'applied' | 'review' | 'disabled' | 'kept' | 'observation';
  field: FindingDetails['field'];
  current: unknown;
  proposed: string;
  reason: string;
  evidence: string;
  candidates?: ArtistCandidate[];
};
export type VerificationInput = {
  values: Snapshot;
  artistLinks: { mbid: string; name: string; decision: string }[];
  catalogue: Map<string, ArtistCandidate[]>;
  sources: { title: string; description: string }[];
  manualFields: string[];
  priceManual: boolean;
  classificationManual: boolean;
  publication: { status: string; manual: boolean; reviewRequired: boolean };
  similar: { id: number }[];
  dismissed: FindingDetails[];
  externalFinding: boolean;
};

const present = (value: unknown) => value != null && (typeof value !== 'string' || (value.trim() !== '' && value !== 'unknown'));
const equal = (first: unknown, second: unknown) => (first ?? null) === (second ?? null);

export function validDateRange(field: string, value: string, current: Snapshot) {
  return !(field === 'event_date' && current.event_end_date && value > String(current.event_end_date)) &&
    !(field === 'event_end_date' && (!current.event_date || value < String(current.event_date)));
}

function replacedFinding(first: FindingDetails, second: FindingDetails) {
  if (first.field !== second.field) return false;
  if (first.field === 'artists') return normalizeArtist(first.proposed) === normalizeArtist(second.proposed) &&
    JSON.stringify((first.candidates ?? []).map(artist => artist.mbid).sort()) === JSON.stringify((second.candidates ?? []).map(artist => artist.mbid).sort());
  return equal(first.current, second.current) && first.proposed === second.proposed &&
    (first.proposed ? true : first.reason === second.reason && first.evidence === second.evidence);
}

export function planVerification(input: VerificationInput, findings: Finding[], rules: Rules, allowPublish: boolean) {
  const fields: Record<string, string> = {};
  const actions: Outcome[] = [];
  const attention: FindingDetails[] = [];
  const changes: { field: Editable; finding: FindingDetails }[] = [];
  const proposedFields = new Map<Editable, Finding>();
  const proposedArtists = new Map<string, FindingDetails>();
  const updated = { ...input.values };
  const manual = new Set(input.manualFields);
  const artistEvidence = input.sources.flatMap(source => [source.title, source.description].map(normalizeEvidence));
  const observations = new Set<string>();
  let blockedPublication = input.externalFinding;

  const permissionFor = (field: FindingDetails['field'], proposed: string) => {
    const action = field === 'review_status' ? (validField('review_status', proposed) ? proposed : 'unsure') : field;
    return rules.permissions[action as RuleAction];
  };
  function outcome(status: Outcome['status'], { field, current, proposed, reason, evidence, candidates }: FindingDetails) {
    actions.push({ status, field, current, proposed, reason, evidence, ...(candidates ? { candidates } : {}) });
  }
  function observe(finding: FindingDetails) {
    const name = normalizeArtist(finding.proposed);
    if (!name || observations.has(name) || permissionFor('artists', finding.proposed) === 'disabled') return;
    observations.add(name);
    outcome('observation', finding);
    fields.artists ??= 'observed';
  }
  function flag(finding: FindingDetails) {
    const { field } = finding;
    if (attention.some(existing => replacedFinding(existing, finding))) return;
    if (input.dismissed.some(old => replacedFinding(old, finding))) {
      outcome('kept', finding);
      fields[field] ??= 'kept';
      return;
    }
    if (permissionFor(field, finding.proposed) === 'disabled') {
      outcome('disabled', finding);
      fields[field] = 'disabled';
      if (field === 'review_status' || important.some(required => required === field)) blockedPublication = true;
      return;
    }
    attention.push(finding);
    outcome('review', finding);
    fields[field] = 'needs_attention';
  }
  function apply(field: Editable, finding: FindingDetails) {
    changes.push({ field, finding });
    outcome('applied', finding);
    if (fields[field] !== 'needs_attention') fields[field] = field === 'artists' ? 'linked' : 'filled';
    if (field === 'artists') {
      const artists = updated.artists as VerificationInput['artistLinks'];
      const candidate = finding.candidates![0];
      updated.artists = [...artists, { mbid: candidate.mbid, name: candidate.name, decision: 'accepted' }];
    } else {
      updated[field] = finding.proposed;
    }
  }

  for (const field of important) {
    if (!present(updated[field]) && !findings.some(finding => finding.field === field)) {
      flag({ field, disposition: 'attention', current: null, proposed: '', evidence: '', reason: 'This event detail is missing.' });
    }
  }

  for (const finding of findings) {
    const { field, disposition, proposed, evidence } = finding;
    const current = input.values[field] ?? null;
    const entry: FindingDetails = { ...finding, current };
    if (field === 'artists') {
      if (disposition === 'unknown') { fields.artists ??= 'unknown'; continue; }
      if (!proposed || !validField(field, proposed) || !quotedArtistName(proposed, evidence) ||
          !artistEvidence.some(text => text.includes(normalizeEvidence(evidence)))) {
        observe({ ...entry, current: null, reason: 'The listing quote does not identify this performer.' });
        continue;
      }
      const name = normalizeArtist(proposed);
      const candidates = input.catalogue.get(name) ?? [];
      const match = candidates.length === 1 ? candidates[0] : undefined;
      const linked = match && input.artistLinks.find(artist => artist.mbid === match.mbid);
      const artistFinding = { ...entry, candidates, current: null, ...(match ? { artistId: match.mbid } : {}) };
      if (linked?.decision === 'dismissed') {
        outcome('kept', { ...artistFinding, reason: 'This artist was dismissed for this event.' });
        fields.artists ??= 'kept';
        continue;
      }
      if (input.artistLinks.some(artist => artist.decision === 'accepted' &&
          (normalizeArtist(artist.name) === name || candidates.some(candidate => candidate.mbid === artist.mbid)))) {
        fields.artists = 'confirmed';
        continue;
      }
      if (disposition === 'attention' || (name.split(' ').length === 1 &&
          (!candidates.length || !input.sources.some(source => quotedArtistName(proposed, source.title))))) {
        observe({ ...artistFinding, reason: 'The listing gives too little detail to identify this performer confidently.' });
        continue;
      }
      if (permissionFor(field, proposed) === 'auto' && disposition === 'suggestion' && match &&
          !input.dismissed.some(old => replacedFinding(old, artistFinding))) {
        proposedArtists.set(match.mbid, artistFinding);
      } else {
        flag({ ...artistFinding, reason: candidates.length > 1 ? 'Several catalogue artists match this performer.' :
          candidates.length === 0 ? 'Artist not in catalogue.' : finding.reason });
      }
      continue;
    }
    if (disposition === 'attention') { flag(entry); continue; }
    const missing = !present(current);
    if (disposition === 'unknown') {
      if (missing && important.some(required => required === field)) flag({ ...entry, reason: 'The source does not establish this event detail.' });
      else fields[field] ??= 'unknown';
      continue;
    }
    if (field !== 'review_status' && ((!missing && (proposed === current || (disposition === 'confirmed' && !proposed))) ||
        (field === 'image' && disposition === 'confirmed'))) {
      const critical = important.some(required => required === field);
      if (critical && ((proposed && proposed !== current) || !canAutoFill(field, String(current), evidence))) {
        fields[field] ??= 'unknown';
      } else fields[field] ??= 'confirmed';
      continue;
    }
    if (disposition === 'confirmed' && field !== 'review_status' && (!proposed || !editable.includes(field as Editable))) {
      if (important.some(required => required === field)) flag({ ...entry, reason: 'The saved event detail is missing.' });
      continue;
    }
    if (field === 'review_status' && proposed === current && proposed !== 'unsure') { fields[field] ??= 'confirmed'; continue; }
    const conflicts = findings.some(other => other !== finding && other.field === field && other.proposed &&
      normalizeEvidence(proposed) !== normalizeEvidence(other.proposed) && (other.disposition === 'suggestion' || other.disposition === 'confirmed'));
    const draft = input.publication.status === 'draft';
    const classify = field === 'review_status' && !input.classificationManual &&
      (missing || current === 'unsure' ? ['music', 'not_music'].includes(proposed) : draft && proposed === 'unsure');
    const pricing = field === 'price_text' || field === 'price_type';
    if (missing && (manual.has(field) || (pricing && input.priceManual))) {
      outcome('kept', { ...entry, reason: 'This field is locked by a manual edit.' });
      fields[field] ??= 'kept';
      continue;
    }
    const fill = missing && (pricing ? validField(field, proposed) : canAutoFill(field, proposed, evidence));
    const copyTitle = (missing || draft) && field === 'title' && validField(field, proposed) &&
      normalizeEvidence(proposed) === normalizeEvidence(evidence) && input.sources.length > 0 &&
      input.sources.every(source => normalizeEvidence(source.title) === normalizeEvidence(proposed));
    if (permissionFor(field, proposed) === 'auto' && !conflicts && !manual.has(field) &&
        (classify || fill || copyTitle) &&
        editable.includes(field as Editable) && !input.dismissed.some(old => replacedFinding(old, entry))) {
      proposedFields.set(field as Editable, finding);
    } else {
      flag(entry);
    }
  }

  if (input.similar.length) flag({ field: 'duplicate', disposition: 'attention', current: null, proposed: '', evidence: '', reason: `Possible duplicate in Seeker: #${input.similar[0].id}.` });
  for (const field of editable) {
    const finding = proposedFields.get(field);
    if (!finding || fields[field] === 'needs_attention') continue;
    const entry = { ...finding, current: updated[field] ?? null };
    if (validDateRange(field, finding.proposed, updated)) apply(field, entry);
    else flag({ ...entry, reason: 'The proposed date conflicts with the saved date range.' });
  }
  for (const [mbid, finding] of proposedArtists) {
    if (!attention.some(item => item.field === 'artists' && item.candidates?.some(candidate => candidate.mbid === mbid))) apply('artists', finding);
  }
  if (!updated.event_date && !fields.event_date) flag({ field: 'event_date', disposition: 'attention', current: null, proposed: '', evidence: '', reason: 'The event date is missing.' });
  if (updated.review_status === 'unsure' && !attention.some(finding => finding.field === 'review_status') && fields.review_status !== 'disabled') {
    flag({ field: 'review_status', disposition: 'attention', current: 'unsure', proposed: '', evidence: '', reason: 'Music classification is unclear.' });
  }

  let publish = false;
  if (allowPublish && !blockedPublication && !attention.length && !input.publication.manual &&
      !input.publication.reviewRequired && input.publication.status === 'draft' && updated.review_status === 'music' &&
      typeof updated.event_date === 'string' && String(updated.event_end_date ?? updated.event_date) >= vilniusToday()) {
    const entry: FindingDetails = { field: 'publication_status', disposition: 'suggestion', current: 'draft', proposed: 'live',
      evidence: '', reason: 'The event is upcoming, classified as music and has no open findings.' };
    publish = rules.permissions.publication_status === 'auto' && !input.dismissed.some(old => replacedFinding(old, entry));
    if (publish) outcome('applied', entry);
    else flag(entry);
  }

  return { fields, actions, attention, changes, updated, publish };
}
