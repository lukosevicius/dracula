/**
 * The artist matching step (see matching.ts): reads upcoming music events whose text is new or changed, asks the
 * default Seeker AI provider for the performers, and links them to artists. Clear matches are linked, unclear ones
 * wait in Seeker's "Artists to confirm" list, and names with no artist yet are offered there as new artists.
 */
import { randomUUID } from 'node:crypto';
import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
import { descriptionText } from '../catalogue/description.js';
import { vilniusToday } from '../catalogue/catalogue.service.js';
import { catalogueByName, normalizeArtist, type Artist } from '../verification/artists.js';
import { fail, transaction } from '../verification/history.js';
import { defaultProfileKey, generate, loadProfile, type Profile } from '../verification/providers.js';
import { estimatedTokenCost, type TokenUsage } from '../verification/usage.js';
import { lookUpMusicBrainz } from './musicbrainz-lookup.js';
import { candidatesFor, checkedPerformers, choicePrompt, choiceSchema, oneMatchOutcome, performerPrompt, performerSchema, type Candidate, type Outcome, type Performer, type Role } from './matching.js';

type Found = Performer & { outcome: Outcome; artists: { mbid: string; name: string }[] };
type NewName = { name: string; written: string; role: Role; evidence: string; country?: string; status: 'open' | 'added' | 'dismissed'; mbid?: string };
export type Extraction = { performers: Found[]; new_names: NewName[] };

const maxText = 12_000;
const retryFailedAfterMs = 6 * 3600_000;

// The text the AI reads, and a fingerprint of it, so an event is read again only when its listing changes.
const sourceText = `SELECT event_id, GROUP_CONCAT(CONCAT(source_key,':',source_id,'\\n',content_html) ORDER BY id SEPARATOR '\\n') AS body
  FROM event_sources GROUP BY event_id`;
const waiting = `FROM events e JOIN (${sourceText}) s ON s.event_id=e.id LEFT JOIN artist_extractions x ON x.event_id=e.id
  WHERE e.review_status IN ('music','festival')
    AND (e.event_date IS NULL OR GREATEST(e.event_date, COALESCE(e.event_end_date, e.event_date)) >= ?
      OR EXISTS (SELECT 1 FROM event_times t WHERE t.event_id=e.id AND t.event_date >= ?))
    AND (x.event_id IS NULL OR x.content_hash <> SHA2(CONCAT(e.title,'\\n',s.body),256) OR (x.status='failed' AND x.extracted_at < ?))`;

async function defaultProfile(pool: Pool, secret?: string): Promise<Profile> {
  const [rows] = await pool.execute<RowDataPacket[]>('SELECT setting_value FROM seeker_settings WHERE setting_key=?', [defaultProfileKey]);
  if (!rows[0]) throw fail(409, 'Choose a default AI provider in Seeker Settings first.');
  return loadProfile(pool, Number(rows[0].setting_value), secret);
}

async function catalogue(conn: Pool | PoolConnection) {
  const [rows] = await conn.execute<(RowDataPacket & Artist)[]>('SELECT mbid,name,disambiguation,aliases_json FROM artists');
  return catalogueByName(rows);
}

/** Events still to read, oldest first by date; `count` is how many are left in all. */
async function nextEvents(pool: Pool, limit: number) {
  const today = vilniusToday(), retry = new Date(Date.now() - retryFailedAfterMs).toISOString();
  const [count] = await pool.execute<RowDataPacket[]>(`SELECT COUNT(*) AS n ${waiting}`, [today, today, retry]);
  const [rows] = await pool.execute<RowDataPacket[]>(`SELECT e.id,e.title,SHA2(CONCAT(e.title,'\\n',s.body),256) AS hash ${waiting}
    ORDER BY e.event_date IS NULL, e.event_date, e.id LIMIT ${Number(limit)}`, [today, today, retry]);
  return { remaining: Number(count[0]?.n ?? 0), rows };
}

/** The event title and each listing's description as plain text. */
async function eventText(pool: Pool, id: number, title: string) {
  const [sources] = await pool.execute<RowDataPacket[]>('SELECT content_html FROM event_sources WHERE event_id=? ORDER BY id', [id]);
  const parts = sources.map(source => descriptionText(String(source.content_html ?? '')).trim()).filter(Boolean);
  return [`TITLE: ${descriptionText(title)}`, ...new Set(parts)].join('\n\n').slice(0, maxText);
}

function addUsage(total: TokenUsage, usage: TokenUsage | null) {
  if (usage) { total.input += usage.input; total.cached += usage.cached; total.output += usage.output; }
}

/** Reads one event and saves its performers and links. Provider errors are saved on the event and thrown. */
async function extractOne(pool: Pool, profile: Profile, event: RowDataPacket, request: typeof fetch) {
  const text = await eventText(pool, Number(event.id), String(event.title));
  const usage: TokenUsage = { input: 0, cached: 0, output: 0 };
  const save = async (status: string, result: Extraction, error: string | null) => {
    const cost = estimatedTokenCost(profile.provider, profile.model, usage);
    await pool.execute(`INSERT INTO artist_extractions(event_id,content_hash,provider,model,extracted_at,status,result,input_tokens,output_tokens,cost_usd,error_message)
      VALUES(?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE content_hash=VALUES(content_hash),provider=VALUES(provider),model=VALUES(model),
      extracted_at=VALUES(extracted_at),status=VALUES(status),result=VALUES(result),input_tokens=VALUES(input_tokens),output_tokens=VALUES(output_tokens),
      cost_usd=VALUES(cost_usd),error_message=VALUES(error_message)`,
    [event.id, event.hash, profile.provider, profile.model, new Date().toISOString(), status, JSON.stringify(result), usage.input, usage.output, cost, error?.slice(0, 1000) ?? null]);
    return cost ?? 0;
  };
  let performers: Performer[];
  try {
    performers = checkedPerformers(await generate(profile, performerPrompt(text), performerSchema, request, 3000, u => addUsage(usage, u)), text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await save('failed', { performers: [], new_names: [] }, message);
    throw Object.assign(fail((error as { status?: number }).status ?? 502, message), { saved: true });
  }

  const index = await catalogue(pool);
  const [decided] = await pool.execute<RowDataPacket[]>('SELECT artist_mbid FROM event_artist_decisions WHERE event_id=?', [event.id]);
  const known = new Set(decided.map(row => String(row.artist_mbid)));
  const [previous] = await pool.execute<RowDataPacket[]>('SELECT result FROM artist_extractions WHERE event_id=?', [event.id]);
  const dismissedNames = new Set<string>(previousNewNames(previous[0]?.result).filter(name => name.status === 'dismissed').map(name => normalizeArtist(name.name)));

  const found: Found[] = performers.map(performer => ({ ...performer, outcome: 'unsure' as Outcome, artists: [] }));
  const ambiguous: { performer: Found; candidates: Candidate[] }[] = [];
  for (const performer of found) {
    const candidates = candidatesFor(index, performer);
    performer.artists = candidates.slice(0, 5).map(({ mbid, name }) => ({ mbid, name }));
    if (candidates.some(candidate => known.has(candidate.mbid))) performer.outcome = 'decided';
    else if (!candidates.length) performer.outcome = performer.performing ? 'new' : 'unsure';
    else if (candidates.length === 1) performer.outcome = performer.performing ? oneMatchOutcome(performer) : 'suggested';
    else ambiguous.push({ performer, candidates: candidates.slice(0, 5) });
  }
  if (ambiguous.length) {
    try {
      const [details] = await pool.execute<RowDataPacket[]>(`SELECT mbid,artist_type,area,disambiguation FROM artists WHERE mbid IN (${ambiguous.flatMap(item => item.candidates).map(() => '?').join(',')})`,
        ambiguous.flatMap(item => item.candidates.map(candidate => candidate.mbid)));
      const about = new Map(details.map(row => [String(row.mbid), [row.disambiguation, row.artist_type, row.area].filter(Boolean).join(', ')]));
      const answer = await generate(profile, choicePrompt(text, ambiguous.map(item => ({ written: item.performer.written, candidates: item.candidates.map(c => ({ name: c.name, details: about.get(c.mbid) ?? '' })) }))),
        choiceSchema, request, 800, u => addUsage(usage, u)) as { choices?: { performer?: unknown; artist?: unknown }[] };
      for (const choice of Array.isArray(answer?.choices) ? answer.choices : []) {
        const item = ambiguous[Number(choice.performer) - 1], picked = item?.candidates[Number(choice.artist) - 1];
        if (item && picked) item.performer.artists = [{ mbid: picked.mbid, name: picked.name }];
      }
    } catch { /* Without a pick, every candidate is offered to the editor. */ }
    for (const item of ambiguous) item.performer.outcome = 'suggested';
  }

  const newNames: NewName[] = found.filter(p => p.outcome === 'new' && !dismissedNames.has(normalizeArtist(p.name)))
    .map(p => ({ name: p.name, written: p.written, role: p.role, evidence: p.evidence, country: p.country, status: 'open' }));
  await transaction(pool, async conn => {
    for (const performer of found) {
      if (performer.outcome !== 'linked' && performer.outcome !== 'suggested') continue;
      for (const artist of performer.outcome === 'linked' ? performer.artists.slice(0, 1) : performer.artists.slice(0, 3)) {
        await conn.execute(`INSERT IGNORE INTO event_artist_decisions(event_id,artist_mbid,decision,role,evidence,decided_by) VALUES(?,?,?,?,?,'ai')`,
          [event.id, artist.mbid, performer.outcome === 'linked' ? 'accepted' : 'suggested', performer.role, performer.evidence || null]);
      }
    }
  });
  const result = { performers: found, new_names: newNames };
  const cost = await save('completed', result, null);
  return { result, cost };
}

function previousNewNames(value: unknown): NewName[] {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return Array.isArray(parsed?.new_names) ? parsed.new_names : [];
  } catch { return []; }
}

/** Reads up to `limit` waiting events. Stops at the first provider error, which is reported after the event is saved. */
export async function extractArtists(pool: Pool, secret: string | undefined, input: Record<string, unknown>, request = fetch) {
  const limit = input.limit === undefined ? 5 : Number(input.limit);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 20) throw fail(400, 'Choose a limit from 1 to 20.');
  const profile = await defaultProfile(pool, secret);
  const { rows, remaining } = await nextEvents(pool, limit);
  const totals = { processed: 0, linked: 0, suggested: 0, new_names: 0, cost_usd: 0 };
  for (const row of rows) {
    const { result, cost } = await extractOne(pool, profile, row, request);
    totals.processed++;
    totals.cost_usd += cost;
    totals.linked += result.performers.filter(p => p.outcome === 'linked').length;
    totals.suggested += result.performers.filter(p => p.outcome === 'suggested').length;
    totals.new_names += result.new_names.length;
  }
  return { ...totals, remaining: Math.max(0, remaining - totals.processed), model: `${profile.provider}:${profile.model}` };
}

// The most important role a name has across its events; band members, guests and others are shown folded away.
const roleOrder: Role[] = ['main', 'ensemble', 'conductor', 'dj', 'support', 'guest', 'member', 'other'];
const minorRoles: Role[] = ['guest', 'member', 'other'];

/** Seeker's "Artists to confirm": suggested links, and each new name once with every upcoming event that names it. */
export async function artistReview(pool: Pool) {
  const today = vilniusToday();
  const upcoming = `(e.event_date IS NULL OR GREATEST(e.event_date, COALESCE(e.event_end_date, e.event_date)) >= ?)`;
  const [links] = await pool.execute<RowDataPacket[]>(`SELECT d.event_id,e.title,e.event_date,e.venue,d.artist_mbid AS mbid,a.name,a.artist_type,a.area,a.disambiguation,d.role,d.evidence
    FROM event_artist_decisions d JOIN events e ON e.id=d.event_id JOIN artists a ON a.mbid=d.artist_mbid
    WHERE d.decision='suggested' AND ${upcoming} ORDER BY e.event_date IS NULL, e.event_date, e.id, a.name LIMIT 300`, [today]);
  const [rows] = await pool.execute<RowDataPacket[]>(`SELECT x.event_id,e.title,e.event_date,e.venue,x.result FROM artist_extractions x JOIN events e ON e.id=x.event_id
    WHERE x.status='completed' AND x.result LIKE '%"status":"open"%' AND ${upcoming} ORDER BY e.event_date IS NULL, e.event_date, e.id LIMIT 1000`, [today]);
  const groups = new Map<string, { name: string; role: Role; country: string; minor: boolean; events: { event_id: number; title: string; event_date: string | null; venue: string | null; written: string; role: Role; evidence: string }[] }>();
  for (const row of rows) for (const item of previousNewNames(row.result).filter(name => name.status === 'open')) {
    const key = normalizeArtist(item.name);
    const group = groups.get(key) ?? { name: item.name, role: item.role, country: '', minor: true, events: [] };
    if (roleOrder.indexOf(item.role) < roleOrder.indexOf(group.role)) group.role = item.role;
    group.country ||= item.country ?? '';
    group.events.push({ event_id: Number(row.event_id), title: row.title, event_date: row.event_date, venue: row.venue, written: item.written, role: item.role, evidence: item.evidence });
    groups.set(key, group);
  }
  const newNames = [...groups.values()].map(group => ({ ...group, minor: minorRoles.includes(group.role) }))
    .sort((a, b) => b.events.length - a.events.length || a.name.localeCompare(b.name, 'lt'));
  const [stats] = await pool.execute<RowDataPacket[]>(`SELECT COUNT(*) AS events, SUM(status='failed') AS failed, COALESCE(SUM(cost_usd),0) AS cost_usd, MAX(extracted_at) AS last_run FROM artist_extractions`);
  const retry = new Date(Date.now() - retryFailedAfterMs).toISOString();
  const [left] = await pool.execute<RowDataPacket[]>(`SELECT COUNT(*) AS n ${waiting}`, [today, today, retry]);
  return {
    links, new_names: newNames,
    stats: { events: Number(stats[0]?.events ?? 0), failed: Number(stats[0]?.failed ?? 0), cost_usd: Number(stats[0]?.cost_usd ?? 0), last_run: stats[0]?.last_run ?? null, waiting: Number(left[0]?.n ?? 0) },
  };
}

/**
 * An editor's answer to a new name, for every upcoming event that names it. "add" looks the name up in MusicBrainz:
 * one clear match adds that artist with its real country; otherwise Dracula adds its own artist with the edited name
 * and country. "dismiss" hides the name on those events, also when they are read again.
 */
export async function decideNewArtist(pool: Pool, input: Record<string, unknown>, request = fetch) {
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  const shown = typeof input.display_name === 'string' && input.display_name.trim() ? input.display_name.trim() : name;
  const country = typeof input.country === 'string' ? input.country.trim().toUpperCase() : '';
  if (!name || name.length > 200 || shown.length > 200 || (country && !/^[A-Z]{2}$/.test(country)) || !['add', 'dismiss'].includes(String(input.decision))) throw fail(400, 'Invalid new artist decision.');
  const key = normalizeArtist(name);
  const found = input.decision === 'add' ? await lookUpMusicBrainz(pool, shown, request) : null;
  return transaction(pool, async conn => {
    const [rows] = await conn.execute<RowDataPacket[]>(`SELECT event_id,result FROM artist_extractions WHERE status='completed' AND result LIKE '%"status":"open"%' FOR UPDATE`);
    const offers = rows.flatMap(row => previousNewNames(row.result).filter(item => item.status === 'open' && normalizeArtist(item.name) === key).map(item => ({ eventId: Number(row.event_id), item })));
    if (!offers.length) throw fail(404, 'This name is no longer waiting for a decision.');
    if (input.decision === 'dismiss') {
      for (const offer of offers) await updateNewName(conn, offer.eventId, key, { status: 'dismissed' });
      return { linked: 0 };
    }
    const now = new Date().toISOString();
    const written = [...new Set(offers.map(offer => offer.item.written).filter(value => normalizeArtist(value) !== normalizeArtist(shown)))];
    let mbid: string, source: 'musicbrainz' | 'dracula', savedCountry: string | null;
    if (found) {
      mbid = found.mbid; source = 'musicbrainz'; savedCountry = found.country ?? (country || null);
      await conn.execute(`INSERT INTO artists(mbid,name,sort_name,artist_type,country,area,disambiguation,aliases_json,source_url,first_seen_at,updated_at,source)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,'musicbrainz') ON DUPLICATE KEY UPDATE updated_at=VALUES(updated_at)`,
      [mbid, found.name, found.sort_name, found.artist_type, savedCountry, found.area, found.disambiguation, JSON.stringify([...new Set([...found.aliases, ...written])]), `https://musicbrainz.org/artist/${mbid}`, now, now]);
    } else {
      const existing = (await catalogue(conn)).get(normalizeArtist(shown)) ?? [];
      source = 'dracula'; savedCountry = country || null;
      if (existing[0]) mbid = existing[0].mbid;
      else {
        mbid = randomUUID();
        await conn.execute(`INSERT INTO artists(mbid,name,country,aliases_json,source_url,first_seen_at,updated_at,source) VALUES(?,?,?,?,'',?,?,'dracula')`,
          [mbid, shown, savedCountry, JSON.stringify(written), now, now]);
      }
    }
    for (const offer of offers) {
      await conn.execute(`INSERT IGNORE INTO event_artist_decisions(event_id,artist_mbid,decision,role,evidence,decided_by) VALUES(?,?,'accepted',?,?,'editor')`,
        [offer.eventId, mbid, offer.item.role, offer.item.evidence || null]);
      await updateNewName(conn, offer.eventId, key, { status: 'added', mbid });
    }
    return { mbid, linked: offers.length, source, country: savedCountry, name: found?.name ?? shown };
  });
}

async function updateNewName(conn: PoolConnection, eventId: number, key: string, change: Partial<NewName>) {
  const [rows] = await conn.execute<RowDataPacket[]>('SELECT result FROM artist_extractions WHERE event_id=?', [eventId]);
  let parsed: Extraction;
  try { parsed = JSON.parse(String(rows[0]?.result)); } catch { return; }
  parsed.new_names = (parsed.new_names ?? []).map(item => item.status === 'open' && normalizeArtist(item.name) === key ? { ...item, ...change } : item);
  await conn.execute('UPDATE artist_extractions SET result=? WHERE event_id=?', [JSON.stringify(parsed), eventId]);
}
