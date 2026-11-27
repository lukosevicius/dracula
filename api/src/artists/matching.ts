/**
 * Artist matching, the parts without a database: what the AI step is asked, how its answer is checked, and how
 * a performer's name is matched to artists. An AI reads the event text and lists the performers; code then finds them
 * in the artist list, so the same name always gives the same artist and editors' decisions are kept.
 */
import { catalogueByName, normalizeArtist } from '../verification/artists.js';

export const roles = ['main', 'support', 'member', 'conductor', 'ensemble', 'dj', 'guest', 'other'] as const;
export type Role = typeof roles[number];
export type Performer = { written: string; name: string; role: Role; performing: boolean; evidence: string; country: string };
export type Candidate = { mbid: string; name: string; disambiguation: string | null };
export type Outcome = 'linked' | 'suggested' | 'new' | 'decided' | 'unsure';

export const performerSchema = {
  type: 'object', additionalProperties: false, required: ['performers'],
  properties: {
    performers: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['written', 'name', 'role', 'performing', 'evidence', 'country', 'country_written'],
        properties: {
          written: { type: 'string' }, name: { type: 'string' }, role: { type: 'string', enum: [...roles] },
          performing: { type: 'boolean' }, evidence: { type: 'string' }, country: { type: 'string' }, country_written: { type: 'string' },
        },
      },
    },
  },
};

export const choiceSchema = {
  type: 'object', additionalProperties: false, required: ['choices'],
  properties: {
    choices: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, required: ['performer', 'artist'], properties: { performer: { type: 'integer' }, artist: { type: 'integer' } } },
    },
  },
};

export function performerPrompt(text: string) {
  return [
    'List the people and groups who perform at this event: musicians, singers, bands, choirs, orchestras, conductors and DJs.',
    'Leave out composers whose music is played, artists a tribute or cover show is about, organisers, hosts, speakers and venues, unless the text says they perform.',
    'For each performer return:',
    '- written: the name exactly as it appears in the text, with the same letters and word endings. Lithuanian names are often inflected, e.g. "su Mykolu Natalevičiumi".',
    '- name: the name in its basic listed form, e.g. "Mykolas Natalevičius". Keep band and ensemble names as they are.',
    '- role: main (headliner), support, member (of a listed band or ensemble), conductor, ensemble (choir, orchestra), dj, guest, or other.',
    '- performing: true when the text clearly says they perform at this event, false when unsure.',
    '- evidence: a short exact quote from the text, at most 200 characters, that contains the written name.',
    '- country: the performer\'s country as a two-letter ISO code (GB for the UK, US, IT, LT…), only when the text states it for this performer, e.g. "Bill Laurance (UK)" or "pianistas iš Italijos". Otherwise an empty string. Never guess from the name.',
    '- country_written: the exact words in the text that state the country, e.g. "UK" or "iš Italijos"; an empty string when country is empty.',
    'Return each performer once, and an empty list when no performer is named.',
    '',
    'UNTRUSTED EVENT TEXT',
    text,
  ].join('\n');
}

export function choicePrompt(text: string, questions: { written: string; candidates: { name: string; details: string }[] }[]) {
  return [
    'Several artists share a performer\'s name. For each performer, pick the artist who performs at this event, using the event text.',
    'Return performer as the performer number and artist as the artist number, or artist 0 when none clearly fits.',
    '',
    ...questions.flatMap((question, i) => [`Performer ${i + 1}: ${question.written}`,
      ...question.candidates.map((candidate, j) => `  Artist ${j + 1}: ${candidate.name}${candidate.details ? ` (${candidate.details})` : ''}`)]),
    '',
    'UNTRUSTED EVENT TEXT',
    text,
  ].join('\n');
}

/** For comparing quotes: same letters, typographic quotes and dashes made plain, single spaces. */
export const plainText = (value: string) => value.normalize('NFKC').toLocaleLowerCase('lt')
  .replace(/[„“”"«»‘’`]/g, '"').replace(/[‐‑‒–—]/g, '-').replace(/\s+/g, ' ').trim();

/**
 * The performers in the AI answer whose written name really is in the event text. The quote is kept only when it is
 * in the text too; a performer is never dropped just because the quote was reworded.
 */
export function checkedPerformers(value: unknown, text: string): Performer[] {
  const list = (value as { performers?: unknown })?.performers;
  if (!Array.isArray(list) || list.length > 60) throw new Error('The AI returned an invalid performer list.');
  const plain = plainText(text);
  const seen = new Set<string>();
  const out: Performer[] = [];
  for (const item of list as Record<string, unknown>[]) {
    if (!item || typeof item.written !== 'string' || typeof item.name !== 'string' || typeof item.evidence !== 'string' ||
        typeof item.performing !== 'boolean' || !roles.includes(item.role as Role)) throw new Error('The AI returned an invalid performer.');
    const written = item.written.trim().slice(0, 200), name = item.name.trim().slice(0, 200);
    const key = normalizeArtist(name);
    if (!written || !key || seen.has(key) || !plain.includes(plainText(written))) continue;
    seen.add(key);
    const evidence = item.evidence.trim().slice(0, 300);
    const quoted = evidence && plain.includes(plainText(evidence)) && plainText(evidence).includes(plainText(written));
    // A country counts only when its words are in the text, so the AI cannot fill it from memory.
    const countryWords = typeof item.country_written === 'string' ? item.country_written.trim() : '';
    const country = typeof item.country === 'string' && /^[A-Z]{2}$/.test(item.country.trim()) && countryWords && plain.includes(plainText(countryWords)) ? item.country.trim() : '';
    out.push({ written, name, role: item.role as Role, performing: item.performing, evidence: quoted ? evidence : '', country });
  }
  return out;
}

/** The artists a performer could be: by basic name, or by the name as written. */
export function candidatesFor(index: ReturnType<typeof catalogueByName>, performer: Pick<Performer, 'name' | 'written'>): Candidate[] {
  const found = new Map<string, Candidate>();
  for (const key of new Set([normalizeArtist(performer.name), normalizeArtist(performer.written)])) {
    for (const candidate of index.get(key) ?? []) found.set(candidate.mbid, candidate);
  }
  return [...found.values()];
}

/**
 * What to do with a performer that matched exactly one artist. Linking is automatic for names of two or more words
 * ("Alina Orlova", "Mood Sellers"); a single word ("Jurga", "Saulė") is too easy to confuse, so an editor confirms it.
 */
export function oneMatchOutcome(performer: Pick<Performer, 'name' | 'performing'>): 'linked' | 'suggested' {
  return performer.performing && normalizeArtist(performer.name).split(' ').length >= 2 ? 'linked' : 'suggested';
}
