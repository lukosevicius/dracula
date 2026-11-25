import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { normalizeEventSearch } from '../admin/event-search.js';
import { descriptionText } from '../catalogue/description.js';
import { diff, fail, history, jsonValue, lockEvent, setPublication, snapshot, transaction, type Snapshot } from './history.js';
import { defaultProfileKey, generate, loadProfile } from './providers.js';
import { beginProviderRequest, finishProviderRequest, historicalFinding, type TokenUsage } from './usage.js';
import { catalogueByName, mentionedArtists, normalizeArtist, type Artist } from './artists.js';
import { readRuleVersion, rulesForPreview, type PreviewRules, type Rules } from './rule-settings.js';
import { reconcilePrices } from './prices.js';
import { planVerification, validDateRange, type FindingDetails, type Outcome, type VerificationInput } from './verification-plan.js';
import { editable, evidenceText, parseFindings, reconcileStructuredFields, resultSchema, sourceEvidence, validField, type Editable, type Finding } from './rules.js';

type Task = { id: number; event_id: number; job_id: number; event_revision: number; claim: string; profile_id: number | null; provider: string; model: string; allow_publish: number; actor: string; rules_version_id: number | null; preview_rules: unknown };
const timeFields = ['event_date', 'event_end_date', 'event_time'] as const;
const legacyFields = ['title', ...timeFields, 'venue', 'ticket_url', 'review_status'];
const noProfile = 'No default AI provider was configured. Add one in Seeker Settings and retry.';
const positive = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const trimmed = (value: string) => value.trim().slice(0, 500);

async function profileFor(conn: PoolConnection, id?: number) {
  const [rows] = id
    ? await conn.execute<RowDataPacket[]>('SELECT id,provider,model FROM verification_providers WHERE id=?', [id])
    : await conn.execute<RowDataPacket[]>(`SELECT p.id,p.provider,p.model FROM verification_providers p
        JOIN seeker_settings s ON CAST(s.setting_value AS UNSIGNED)=p.id WHERE s.setting_key=?`, [defaultProfileKey]);
  return rows[0] ?? null;
}

async function enqueue(conn: PoolConnection, jobId: number, event: RowDataPacket) {
  const [active] = await conn.execute<RowDataPacket[]>(`SELECT v.id FROM event_verifications v JOIN verification_jobs j ON j.id=v.job_id
    WHERE v.event_id=? AND v.event_revision=? AND v.status IN ('queued','running') AND j.preview_rules IS NULL LIMIT 1`, [event.id, event.revision]);
  // One provider call per event revision at a time, even across imports and manual batches.
  if (active.length) return false;
  await conn.execute(`INSERT INTO event_verifications(job_id,event_id,event_revision) VALUES(?,?,?)
    ON DUPLICATE KEY UPDATE event_revision=VALUES(event_revision),status='queued',attempts=0,claim=NULL,lease_until=NULL,finished_at=NULL,result=NULL,error_message=NULL`, [jobId, event.id, event.revision]);
  await conn.execute("UPDATE events SET verification_status='queued' WHERE id=?", [event.id]);
  return true;
}

export async function queueAfterImport(conn: PoolConnection, id: number, importJob: number | undefined, verify: boolean, publish: boolean) {
  if (!verify) return;
  const event = await lockEvent(conn, id);
  const profile = await profileFor(conn);
  const [job] = await conn.execute<ResultSetHeader>(`INSERT INTO verification_jobs(profile_id,provider,model,import_job_id,actor,allow_publish,rules_version_id,created_at)
    VALUES(?,?,?,?,'import',?,(SELECT active_version_id FROM verification_rule_state WHERE id=1),UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)`, [profile?.id ?? null, profile?.provider ?? null, profile?.model ?? null, importJob ?? null, publish]);
  await enqueue(conn, job.insertId, event);
}

export async function manualVerification(pool: Pool, body: Snapshot, actor: string) {
  const { event_ids, profile_id, request_key, allow_publish } = body;
  if (!Array.isArray(event_ids) || !event_ids.length || event_ids.length > 200 || !event_ids.every(positive) ||
      (profile_id !== undefined && !positive(profile_id)) || (allow_publish !== undefined && typeof allow_publish !== 'boolean') ||
      (request_key !== undefined && (typeof request_key !== 'string' || !/^[\w.-]{1,100}$/.test(request_key)))) throw fail(400, 'Select one to 200 events and a valid AI provider.');
  const ids = [...new Set<number>(event_ids)].sort((a, b) => a - b);
  const hash = createHash('sha256').update(JSON.stringify([ids, profile_id ?? null, allow_publish !== false])).digest('hex');
  return transaction(pool, async conn => {
    const profile = await profileFor(conn, profile_id as number | undefined);
    let jobId: number;
    try {
      const [job] = await conn.execute<ResultSetHeader>(`INSERT INTO verification_jobs(profile_id,provider,model,actor,request_key,request_hash,allow_publish,rules_version_id,created_at)
        VALUES(?,?,?,?,?,?,?,(SELECT active_version_id FROM verification_rule_state WHERE id=1),UTC_TIMESTAMP(3))`, [profile?.id ?? null, profile?.provider ?? null, profile?.model ?? null, actor, request_key ?? null, hash, allow_publish !== false]);
      jobId = job.insertId;
    } catch (error) {
      if (!request_key || (error as { code?: string }).code !== 'ER_DUP_ENTRY') throw error;
      const [old] = await conn.execute<RowDataPacket[]>('SELECT id,request_hash FROM verification_jobs WHERE actor=? AND request_key=? FOR UPDATE', [actor, request_key as string]);
      if (old[0]?.request_hash !== hash) throw fail(409, 'This request key was already used with different options.');
      return { id: Number(old[0].id) };
    }
    if (!profile) throw fail(409, 'Select an AI provider in Seeker Settings before starting verification.');
    let queued = 0;
    for (const id of ids) if (await enqueue(conn, jobId, await lockEvent(conn, id))) queued++;
    return { id: jobId, queued, already_queued: ids.length - queued };
  });
}

export async function queueRulesPreview(pool: Pool, body: Snapshot, actor: string) {
  const { event_id, profile_id, request_key, revision } = body;
  if (!positive(event_id) || (profile_id !== undefined && !positive(profile_id)) ||
      typeof request_key !== 'string' || !/^[\w.-]{1,100}$/.test(request_key)) throw fail(400, 'Select an event and a valid AI provider.');
  const requestKey = request_key;
  const hash = createHash('sha256').update(JSON.stringify(['preview', event_id, profile_id ?? null, revision])).digest('hex');
  return transaction(pool, async conn => {
    const event = await lockEvent(conn, event_id);
    const existing = await findRequest();
    if (existing) return existing;
    const { preview, version } = await rulesForPreview(conn, revision);
    const profile = await profileFor(conn, profile_id as number | undefined);
    if (!profile) throw fail(409, 'Select an AI provider in Seeker Settings before starting a preview.');
    let jobId: number;
    try {
      const [job] = await conn.execute<ResultSetHeader>(`INSERT INTO verification_jobs(profile_id,provider,model,actor,request_key,request_hash,allow_publish,rules_version_id,preview_rules,created_at)
        VALUES(?,?,?,?,?,?,1,?,?,UTC_TIMESTAMP(3))`, [profile.id, profile.provider, profile.model, actor, requestKey, hash, version, JSON.stringify(preview)]);
      jobId = job.insertId;
    } catch (error) {
      if ((error as { code?: string }).code === 'ER_DUP_ENTRY') {
        const replay = await findRequest(true);
        if (replay) return replay;
      }
      throw error;
    }
    await conn.execute('INSERT INTO event_verifications(job_id,event_id,event_revision) VALUES(?,?,?)', [jobId, event_id, event.revision]);
    return { id: jobId };

    async function findRequest(lock = false) {
      const [existing] = await conn.execute<RowDataPacket[]>('SELECT id,request_hash FROM verification_jobs WHERE actor=? AND request_key=?' + (lock ? ' FOR UPDATE' : ''), [actor, requestKey]);
      if (!existing.length) return null;
      if (existing[0].request_hash !== hash) throw fail(409, 'This request key was already used with different options.');
      return { id: Number(existing[0].id) };
    }
  });
}

export async function rulesPreview(pool: Pool, id: number) {
  const [rows] = await pool.execute<(RowDataPacket & {
    event_id: number; status: string; error_message: string | null; result: unknown; model: string;
    rules_version_id: number | null; preview_rules: unknown;
  })[]>(`SELECT v.event_id,v.status,v.error_message,v.result,j.model,j.rules_version_id,j.preview_rules
    FROM event_verifications v JOIN verification_jobs j ON j.id=v.job_id WHERE j.id=? AND j.preview_rules IS NOT NULL`, [id]);
  if (!rows.length) throw fail(404, 'Rules preview not found.');
  const { preview_rules, result, rules_version_id, ...row } = rows[0];
  return { ...row, rules_version_id: rules_version_id ?? 1, draft_revision: jsonValue<PreviewRules>(preview_rules).draft_revision, result: jsonValue<VerificationResult | null>(result) };
}

function runContext(task: Task) {
  return { job_id: task.job_id, verification_id: task.id, model: task.model, provider: task.provider, rules_version_id: task.rules_version_id ?? 1,
    trigger: task.actor === 'import' ? 'import' : task.actor.startsWith('Agent ') ? 'agent' : 'manual', triggered_by: task.actor };
}

async function claimTask(pool: Pool): Promise<Task | null> {
  const [rows] = await pool.execute<RowDataPacket[]>(`SELECT v.id,v.event_id,v.job_id,j.profile_id,j.provider,j.model,j.allow_publish,j.rules_version_id,j.preview_rules,j.actor FROM event_verifications v
    JOIN verification_jobs j ON j.id=v.job_id LEFT JOIN job_leases l ON l.job_id=j.import_job_id AND l.expires_at>?
    WHERE (v.status='queued' OR (v.status='running' AND v.lease_until<UTC_TIMESTAMP(3))) AND l.job_id IS NULL ORDER BY v.id LIMIT 1`, [Date.now()]);
  if (!rows.length) return null;
  const row = rows[0];
  return transaction(pool, async conn => {
    const event = await lockEvent(conn, Number(row.event_id));
    const [available] = await conn.execute<RowDataPacket[]>(`SELECT event_revision,attempts FROM event_verifications
      WHERE id=? AND (status='queued' OR (status='running' AND lease_until<UTC_TIMESTAMP(3))) FOR UPDATE`, [row.id]);
    if (!available.length) return null;
    const queued = available[0];
    const changed = Number(event.revision) !== Number(queued.event_revision);
    const exhausted = Number(queued.attempts) >= 2;
    if (changed || exhausted) {
      const status = changed ? 'skipped' : 'failed';
      const reason = changed ? 'Event changed before verification.' : 'The verification worker was interrupted twice. Retry from Seeker.';
      await conn.execute('UPDATE event_verifications SET status=?,finished_at=UTC_TIMESTAMP(3),claim=NULL,lease_until=NULL,error_message=? WHERE id=?', [status, reason, row.id]);
      if (row.preview_rules) return null;
      await history(conn, Number(event.id), changed ? 'verification_skipped' : 'verification_failed', 'AI verification', {}, { ...runContext(row as unknown as Task), error: reason });
      const [newer] = await conn.execute<RowDataPacket[]>(`SELECT v.id FROM event_verifications v JOIN verification_jobs j ON j.id=v.job_id WHERE v.event_id=? AND v.id>? AND v.status IN ('queued','running','completed') AND j.preview_rules IS NULL LIMIT 1`, [event.id, row.id]);
      if (!newer.length) await conn.execute('UPDATE events SET verification_status=? WHERE id=?', [changed ? 'stale' : 'failed', event.id]);
      return null;
    }
    const claim = randomUUID();
    await conn.execute(`UPDATE event_verifications SET status='running',attempts=attempts+1,claim=?,lease_until=DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 120 SECOND) WHERE id=?`, [claim, row.id]);
    await conn.execute('UPDATE verification_jobs SET started_at=UTC_TIMESTAMP(3) WHERE id=? AND started_at IS NULL', [row.job_id]);
    if (!row.preview_rules) await conn.execute("UPDATE events SET verification_status='verifying' WHERE id=?", [row.event_id]);
    return { ...row, event_revision: queued.event_revision, claim } as unknown as Task;
  });
}

async function getInput(pool: Pool, id: number) {
  return transaction(pool, async conn => {
    const event = await lockEvent(conn, id);
    const [sources] = await conn.execute<RowDataPacket[]>(
      `SELECT s.*,v.title AS original_title FROM event_sources s LEFT JOIN vilnius_events v
        ON s.source_key='vilnius-events' AND v.source_id=CAST(s.source_id AS UNSIGNED) WHERE s.event_id=? ORDER BY s.id`, [id]);
    const [images] = await conn.execute<RowDataPacket[]>(`SELECT source_url,width,height FROM event_images WHERE event_id=?
      UNION ALL SELECT i.source_url,i.width,i.height FROM event_sources s JOIN vilnius_events v ON v.source_id=CAST(s.source_id AS UNSIGNED)
      JOIN vilnius_images i ON i.media_id=v.featured_media WHERE s.event_id=? AND s.source_key='vilnius-events'`, [id, id]);
    const [artists] = await conn.execute<(RowDataPacket & Artist)[]>('SELECT mbid,name,disambiguation,aliases_json FROM artists');
    const [artistLinks] = await conn.execute<(RowDataPacket & VerificationInput['artistLinks'][number])[]>(
      'SELECT a.mbid,a.name,d.decision FROM event_artist_decisions d JOIN artists a ON a.mbid=d.artist_mbid WHERE d.event_id=? ORDER BY a.mbid', [id]);
    const [prices] = await conn.execute<RowDataPacket[]>('SELECT manual FROM event_prices WHERE event_id=?', [id]);
    const [previous] = await conn.execute<RowDataPacket[]>(`SELECT finding,status,verification_id FROM verification_findings
      WHERE event_id=? AND (status='dismissed' OR (status='open' AND verification_id IS NULL))`, [id]);
    const [matches] = event.event_date ? await conn.execute<RowDataPacket[]>('SELECT id,title,venue FROM events WHERE event_date=? AND id<>? LIMIT 200', [event.event_date, id]) : [[]];
    const similar = matches.filter(row => normalizeEventSearch(row.title) === normalizeEventSearch(event.title) &&
      (!row.venue || !event.venue || normalizeEventSearch(row.venue) === normalizeEventSearch(event.venue)));
    const values = {
      ...await snapshot(conn, id, event),
      title: descriptionText(event.title),
      source_url: sources[0]?.source_url ?? null,
      about_url: event.about_url_override ?? sources[0]?.about_url ?? null,
      artists: artistLinks.filter(artist => artist.decision === 'accepted'),
      image: images[0] ?? null,
    } as Snapshot;
    delete values.interest_score;
    delete values.publication_status;
    const manualFields = jsonValue<string[]>(event.manual_fields);
    const listings = sources.slice(0, 3).map((source, position) => sourceEvidence({
      ...source,
      fallback_title: position === 0 && !manualFields.includes('title') ? values.title : undefined,
    }));
    const catalogue = catalogueByName(artists);
    return {
      values, sources: listings, manualFields, similar: similar.map(row => ({ id: Number(row.id) })), artistLinks, catalogue,
      priceManual: Boolean(prices[0]?.manual),
      classificationManual: Boolean(event.classification_manual),
      publication: { status: String(event.publication_status), manual: Boolean(event.publication_manual), reviewRequired: Boolean(event.publication_review_required) },
      dismissed: previous.filter(row => row.status === 'dismissed').map(row => jsonValue<FindingDetails>(row.finding)),
      externalFinding: previous.some(row => row.status === 'open'),
    };
  });
}

async function findArtist(conn: PoolConnection, value: string) {
  const [artists] = await conn.execute<(RowDataPacket & Artist)[]>('SELECT mbid,name,disambiguation,aliases_json FROM artists');
  const matches = catalogueByName(artists).get(normalizeArtist(value));
  return matches?.length === 1 ? matches[0].mbid : undefined;
}

async function applyField(conn: PoolConnection, event: RowDataPacket, field: Editable, value: string, manual: boolean, artistId?: string) {
  if (!validField(field, value)) throw fail(400, 'The proposed value is not valid for this field.');
  const id = Number(event.id);
  if (!validDateRange(field, value, event)) throw fail(409, 'The date range conflicts with the current event. Edit both dates in Event details.');
  const [sources] = await conn.execute<RowDataPacket[]>("SELECT source_id FROM event_sources WHERE event_id=? AND source_key='vilnius-events'", [id]);
  const legacy = sources[0]?.source_id;
  if (field === 'artists') {
    const mbid = artistId ?? await findArtist(conn, value);
    if (!mbid) throw fail(409, 'Select the correct artist in Event details. The name has no unique catalogue match.');
    if (artistId) {
      const [matches] = await conn.execute<RowDataPacket[]>('SELECT mbid FROM artists WHERE mbid=?', [artistId]);
      if (!matches.length) throw fail(409, 'This artist is no longer in the catalogue.');
    }
    for (const [table, key] of [...(legacy ? [['vilnius_event_artists', legacy]] : []), ['event_artist_decisions', id]]) {
      await conn.execute(`INSERT INTO ${table}(event_id,artist_mbid,decision) VALUES(?,?,'accepted') ON DUPLICATE KEY UPDATE decision='accepted'`, [key, mbid]);
    }
  } else if (field === 'price_type' || field === 'price_text') {
    const [rows] = await conn.execute<RowDataPacket[]>('SELECT price_type,price_text,manual FROM event_prices WHERE event_id=?', [id]);
    const type = field === 'price_type' ? value : rows[0]?.price_type ?? 'unknown';
    const text = field === 'price_text' ? value : rows[0]?.price_text ?? null;
    await conn.execute(`INSERT INTO event_prices(event_id,price_type,price_text,manual,checked_at) VALUES(?,?,?,?,?)
      ON DUPLICATE KEY UPDATE price_type=VALUES(price_type),price_text=VALUES(price_text),manual=VALUES(manual),checked_at=VALUES(checked_at)`, [id, type, text, manual || Boolean(rows[0]?.manual) ? 1 : 0, new Date().toISOString()]);
  } else {
    const column = field === 'description' ? 'description_override' : field === 'about_url' ? 'about_url_override' : field;
    await conn.execute(`UPDATE events SET ${column}=? WHERE id=?`, [value, id]);
    event[column] = value;
    if (legacy && legacyFields.includes(field)) await conn.execute(`UPDATE vilnius_events SET ${field}=? WHERE source_id=?`, [value, legacy]);
    if (manual) {
      const manualFields = [...new Set([...jsonValue<string[]>(event.manual_fields), field])];
      event.manual_fields = JSON.stringify(manualFields);
      await conn.execute('UPDATE events SET manual_fields=?,classification_manual=IF(?,1,classification_manual) WHERE id=?', [event.manual_fields, field === 'review_status', id]);
      if (legacy) await conn.execute('UPDATE vilnius_events SET manual_fields=?,details_manual=1 WHERE source_id=?', [event.manual_fields, legacy]);
    }
  }
}

function verificationResult(input: VerificationInput, plan: ReturnType<typeof planVerification>, findings: Finding[]) {
  return { fields: plan.fields, actions: plan.actions, findings, changes: diff(input.values, plan.updated) };
}

type VerificationResult = ReturnType<typeof verificationResult>;

async function finishTask(pool: Pool, task: Task, assessment?: { input: VerificationInput; findings: Finding[]; rules: Rules }, failure?: string) {
  await transaction(pool, async conn => {
    const event = await lockEvent(conn, Number(task.event_id));
    const [rows] = await conn.execute<RowDataPacket[]>("SELECT claim FROM event_verifications WHERE id=? AND status='running' FOR UPDATE", [task.id]);
    if (rows[0]?.claim !== task.claim) return;
    const preview = Boolean(task.preview_rules);
    const id = Number(event.id);
    const actor = task.model ? `AI · ${task.model}` : 'AI verification';
    const context = runContext(task);

    if (Number(event.revision) !== Number(task.event_revision)) {
      const error = 'Event changed while verification was running.';
      await finish('skipped', error);
      if (preview) return;
      await history(conn, id, 'verification_skipped', actor, {}, { ...context, error });
      if (event.verification_status === 'verifying') {
        const [current] = await conn.execute<RowDataPacket[]>(`SELECT v.id FROM event_verifications v JOIN verification_jobs j ON j.id=v.job_id
          WHERE v.event_id=? AND v.event_revision=? AND v.status IN ('queued','running','completed') AND j.preview_rules IS NULL LIMIT 1`, [id, event.revision]);
        if (!current.length) await conn.execute("UPDATE events SET verification_status='stale' WHERE id=?", [id]);
      }
      return;
    }
    if (!assessment) {
      const error = failure ?? 'Could not verify this event.';
      await finish('failed', error);
      if (preview) return;
      await conn.execute("UPDATE events SET verification_status='failed' WHERE id=?", [id]);
      await history(conn, id, 'verification_failed', actor, {}, { ...context, error });
      return;
    }

    const { input, findings, rules } = assessment;
    const plan = planVerification(input, findings, rules, Boolean(task.allow_publish));
    const result = verificationResult(input, plan, findings);
    if (!preview) {
      for (const { field, finding } of plan.changes) await applyField(conn, event, field, finding.proposed, false, finding.artistId);
      await conn.execute("UPDATE verification_findings SET status='superseded' WHERE event_id=? AND status='open' AND verification_id IS NOT NULL", [id]);
      for (const finding of plan.attention) {
        await conn.execute('INSERT INTO verification_findings(event_id,verification_id,field_name,finding) VALUES(?,?,?,?)', [id, task.id, finding.field, JSON.stringify(finding)]);
      }
      const needsAttention = input.externalFinding || plan.attention.length > 0;
      const needsPublicationReview = input.externalFinding || plan.attention.some(finding => finding.field !== 'publication_status');
      await conn.execute("UPDATE events SET verification_status='verified',needs_attention=?,publication_review_required=IF(publication_status='draft' AND ?,1,publication_review_required),revision=revision+? WHERE id=?",
        [needsAttention, needsPublicationReview, Object.keys(result.changes).length ? 1 : 0, id]);
      await history(conn, id, 'verified', actor, result.changes, { ...context, actions: plan.actions });
      if (plan.publish) await setPublication(conn, event, 'live', actor, false, context);
    }
    await finish('completed', null, result);

    async function finish(status: string, message: string | null, result?: object) {
      await conn.execute('UPDATE event_verifications SET status=?,error_message=?,result=?,finished_at=UTC_TIMESTAMP(3),claim=NULL,lease_until=NULL WHERE id=?',
        [status, message, result ? JSON.stringify(result) : null, task.id]);
    }
  });
}

export function createVerificationWorker(pool: Pool, secret?: string, request = fetch) {
  return async () => {
    const task = await claimTask(pool);
    if (!task) return false;
    let assessment: { input: VerificationInput; findings: Finding[]; rules: Rules };
    try {
      if (!task.profile_id) throw fail(409, noProfile);
      const profile = await loadProfile(pool, Number(task.profile_id), secret);
      if (task.provider !== profile.provider || task.model !== profile.model) throw fail(409, 'The selected model changed. Start a new verification run.');
      const savedPreview = jsonValue<PreviewRules | null>(task.preview_rules);
      const rules = savedPreview?.rules ?? await readRuleVersion(pool, task.rules_version_id);
      const input = await getInput(pool, Number(task.event_id));
      const candidates = mentionedArtists(input.catalogue, String(input.values.title), input.sources.flatMap(source =>
        [source.title, source.description].filter((value): value is string => typeof value === 'string')));
      const prompt = [
        'Verify the saved event against the source listings. Return a result for event_date, event_time, venue, and review_status. Use source descriptions as evidence. Report other fields only when they supply a useful correction, missing detail, or explicit conflict.',
        'Each listing has structured_fields extracted from its source data. A matching structured field is enough to confirm the saved value even if the description omits it. Quote the structured value directly.',
        'Use confirmed when evidence supports a saved value, suggestion for a missing or incorrect value, attention for ambiguity or conflicts, and unknown when both structured data and description lack evidence. Quote verbatim source text or a complete structured source value as evidence.',
        'Dates must be YYYY-MM-DD. Times are HH:MM in Europe/Vilnius. Avilys local_start is Vilnius wall time, even when source_start ends in Z.',
        'For review_status return music, not_music, or unsure with evidence. For an identified performer return one suggestion with their exact listed name per performer and quote the source title or description, including the name. Use attention if their performance is ambiguous. Catalogue candidates are hints and are never evidence.',
        'Check the general ticket price and distinguish it from reservation fees, age exemptions, and optional extras. An explicit positive ticket price means paid admission. Return attention only for a material pricing conflict or ambiguity supported by the listing.',
        '',
        'ADDITIONAL RULES FROM THE SEEKER EDITOR',
        rules.markdown,
        '',
        'UNTRUSTED EVENT DATA',
        JSON.stringify({ event: input.values, source_listings: input.sources, artist_catalogue_candidates: candidates }),
      ].join('\n');
      await beginProviderRequest(pool, task.claim, task.id, profile.provider, profile.model);
      let usage: TokenUsage | null = null;
      let result: unknown;
      try {
        result = await generate(profile, prompt, resultSchema, request, undefined, captured => { usage = captured; });
      } finally {
        await finishProviderRequest(pool, task.claim, profile.provider, profile.model, usage);
      }
      const parsed = parseFindings(result, evidenceText(input.sources));
      const findings = reconcilePrices(reconcileStructuredFields(parsed, input.sources, input.values, input.manualFields), input.sources, input.values);
      assessment = { input, findings, rules };
    } catch (error) {
      await finishTask(pool, task, undefined, trimmed(error instanceof Error && (error as {status?: number}).status ? error.message : 'Verification could not process this event.'));
      return true;
    }
    await finishTask(pool, task, assessment);
    return true;
  };
}

export async function verificationJob(pool: Pool, id: number) {
  const [jobs] = await pool.execute<RowDataPacket[]>('SELECT id,provider,model,import_job_id,actor,COALESCE(rules_version_id,1) AS rules_version_id,created_at FROM verification_jobs WHERE id=? AND preview_rules IS NULL', [id]);
  if (!jobs.length) throw fail(404, 'Verification job not found.');
  const [events] = await pool.execute<RowDataPacket[]>(`SELECT v.event_id,e.title,v.status,v.error_message,e.needs_attention,e.publication_status,
    ${historicalFinding} AS flagged FROM event_verifications v JOIN events e ON e.id=v.event_id WHERE v.job_id=? ORDER BY v.id`, [id]);
  const counts = { queued: 0, running: 0, completed: 0, failed: 0, skipped: 0, flagged: 0 };
  for (const event of events) {
    counts[event.status as 'queued']++;
    if (event.needs_attention && event.status === 'completed') counts.flagged++;
  }
  return { ...jobs[0], counts, events };
}

export async function verificationDetails(pool: Pool, id: number, before?: number) {
  const [events] = await pool.execute<(RowDataPacket & {
    id: number; revision: number; publication_status: 'draft' | 'live'; verification_status: string; needs_attention: number;
  })[]>('SELECT id,revision,publication_status,verification_status,needs_attention FROM events WHERE id=?', [id]);
  if (!events.length) throw fail(404, 'Event not found.');
  const [findings] = await pool.execute<RowDataPacket[]>("SELECT id,finding FROM verification_findings WHERE event_id=? AND status='open' ORDER BY id", [id]);
  const [runs] = await pool.execute<(RowDataPacket & {
    id: number; job_id: number; status: string; finished_at: string | null; error_message: string | null; result: unknown;
    provider: string | null; model: string | null; actor: string; rules_version_id: number;
  })[]>(`SELECT v.id,v.job_id,v.status,v.finished_at,v.error_message,v.result,j.provider,j.model,j.actor,COALESCE(j.rules_version_id,1) AS rules_version_id FROM event_verifications v
    JOIN verification_jobs j ON j.id=v.job_id WHERE v.event_id=? AND j.preview_rules IS NULL ORDER BY v.id DESC LIMIT 1`, [id]);
  const [log] = await pool.execute<RowDataPacket[]>(`SELECT id,action,actor,DATE_FORMAT(occurred_at,'%Y-%m-%dT%H:%i:%sZ') AS occurred_at,changes,context
    FROM event_history WHERE event_id=? AND id<? ORDER BY id DESC LIMIT 41`, [id, before ?? Number.MAX_SAFE_INTEGER]);
  return {
    ...events[0], findings: findings.map(row => ({ id: row.id, ...jsonValue<FindingDetails>(row.finding) })),
    last_run: runs[0] ? { ...runs[0], result: jsonValue<VerificationResult | null>(runs[0].result) } : null,
    log: log.slice(0, 40).map(row => ({ ...row, changes: jsonValue<Snapshot>(row.changes), context: jsonValue<Partial<ReturnType<typeof runContext>> & { actions?: Outcome[] } & Snapshot>(row.context) })),
    next_before: log.length > 40 ? log[39].id : null,
  };
}

export async function editPublication(pool: Pool, id: number, input: Snapshot, actor: string) {
  if (input.status !== 'draft' && input.status !== 'live') throw fail(400, 'Publication must be Draft or Live.');
  await transaction(pool, async conn => {
    const event = await lockEvent(conn, id);
    checkRevision(event, input.revision);
    await setPublication(conn, event, input.status as 'draft' | 'live', actor, true);
  });
}

function checkRevision(event: RowDataPacket, revision: unknown) {
  if (!positive(revision)) throw fail(400, 'Supply the current event revision.');
  if (Number(event.revision) !== revision) throw fail(409, 'This event changed. Reload it before applying your decision.');
}

export async function resolveFinding(pool: Pool, eventId: number, findingId: number, input: Snapshot, actor: string, mayPublish = true) {
  if (!['approve', 'dismiss'].includes(String(input.decision)) ||
      (input.value !== undefined && typeof input.value !== 'string') ||
      (input.artist_id !== undefined && typeof input.artist_id !== 'string') ||
      (input.keep_current !== undefined && typeof input.keep_current !== 'boolean')) throw fail(400, 'Choose approve or dismiss.');
  await transaction(pool, async conn => {
    const event = await lockEvent(conn, eventId);
    checkRevision(event, input.revision);
    const [rows] = await conn.execute<RowDataPacket[]>("SELECT finding,verification_id FROM verification_findings WHERE id=? AND event_id=? AND status='open' FOR UPDATE", [findingId, eventId]);
    if (!rows.length) throw fail(409, 'This finding was already resolved or replaced.');
    const finding = jsonValue<FindingDetails>(rows[0].finding);
    const approved = input.decision === 'approve';
    const context = { finding_id: findingId, verification_id: rows[0].verification_id, field: finding.field, evidence: finding.evidence,
      proposed: finding.proposed, current: finding.current };
    let changes = {};
    if (finding.field === 'publication_status') {
      if (!mayPublish) throw fail(403, 'This credential lacks the publication permission.');
      if (approved) {
        if (event.publication_status !== finding.current || event.review_status !== 'music') throw fail(409, 'The event changed. Review it before publishing.');
        await setPublication(conn, event, 'live', actor, true, context);
      }
    } else if (approved || input.keep_current) {
      if (!editable.includes(finding.field as Editable)) throw fail(400, 'This finding needs a manual review before dismissal.');
      const field = finding.field as Editable;
      const before = await snapshot(conn, eventId, event);
      const observed = await currentValue(conn, event, before, field);
      if (field !== 'artists' && (observed ?? null) !== (finding.current ?? null)) throw fail(409, 'The field changed since this finding was created. Edit the field directly or run verification again.');

      const value = typeof input.value === 'string' ? input.value.trim() : finding.proposed;
      if (field === 'artists' && approved && finding.candidates) {
        const candidate = finding.candidates.find(artist => artist.mbid === (input.artist_id ?? finding.artistId));
        if (!candidate) throw fail(400, 'Choose an artist from the suggested catalogue matches.');
        await applyField(conn, event, field, candidate.name, true, candidate.mbid);
      } else if (approved) {
        await applyField(conn, event, field, value, true, value === finding.proposed ? finding.artistId : undefined);
      } else if (field !== 'artists' && typeof observed === 'string' && validField(field, observed)) {
        await applyField(conn, event, field, observed, true);
      } else {
        throw fail(400, 'There is no saved value to keep.');
      }

      if (approved) {
        const after = await snapshot(conn, eventId, event);
        changes = field === 'description' || field === 'about_url' ? diff({ [field]: observed }, { [field]: value }) : diff(before, after);
      }
    }
    await conn.execute('UPDATE verification_findings SET status=?,resolved_by=? WHERE id=?', [approved ? 'approved' : 'dismissed', actor, findingId]);
    await conn.execute(`UPDATE events SET revision=revision+1,needs_attention=EXISTS(SELECT 1 FROM verification_findings WHERE event_id=? AND status='open') WHERE id=?`, [eventId, eventId]);
    await history(conn, eventId, approved ? 'finding_approved' : 'finding_dismissed', actor, changes, context);
  });
}

async function currentValue(conn: PoolConnection, event: RowDataPacket, values: Snapshot, field: Editable) {
  if (field === 'title') return descriptionText(event.title);
  if (field !== 'description' && field !== 'about_url') return values[field];
  const [sources] = await conn.execute<RowDataPacket[]>('SELECT content_html,about_url FROM event_sources WHERE event_id=? ORDER BY id LIMIT 1', [event.id]);
  return field === 'description' ? event.description_override ?? descriptionText(sources[0]?.content_html).slice(0, 6000)
    : event.about_url_override ?? sources[0]?.about_url;
}

export async function proposeFinding(pool: Pool, id: number, input: Snapshot, actor: string) {
  const field = input.field as Editable, value = input.value, reason = input.reason;
  if (!editable.includes(field) || typeof value !== 'string' || !validField(field, value) ||
      typeof reason !== 'string' || !reason.trim() || reason.length > 500) throw fail(400, 'Supply an editable field, proposed value, and reason.');
  return transaction(pool, async conn => {
    const event = await lockEvent(conn, id);
    checkRevision(event, input.revision);
    const values = await snapshot(conn, id, event);
    const current = await currentValue(conn, event, values, field);
    const finding: FindingDetails = { field, disposition: 'suggestion', proposed: value.trim(), current: current ?? null, evidence: '', reason: reason.trim() };
    const [result] = await conn.execute<ResultSetHeader>('INSERT INTO verification_findings(event_id,verification_id,field_name,finding) VALUES(?,NULL,?,?)', [id, field, JSON.stringify(finding)]);
    await conn.execute("UPDATE events SET needs_attention=1,publication_review_required=IF(publication_status='draft',1,publication_review_required),revision=revision+1,verification_status=IF(verification_status IN ('queued','verifying'),'stale',verification_status) WHERE id=?", [id]);
    await history(conn, id, 'edit_proposed', actor, {}, { finding_id: result.insertId, field, proposed: value });
    return { id: result.insertId };
  });
}

export async function recentVerificationJobs(pool: Pool) {
  const [rows] = await pool.execute<RowDataPacket[]>(`SELECT j.id,j.provider,j.model,j.import_job_id,j.created_at,COUNT(v.id) AS total,
    COALESCE(SUM(v.status='queued'),0) AS queued,COALESCE(SUM(v.status='running'),0) AS running,
    COALESCE(SUM(v.status='completed'),0) AS completed,COALESCE(SUM(v.status='failed'),0) AS failed,
    COALESCE(SUM(v.status='skipped'),0) AS skipped,COALESCE(SUM(v.status='completed' AND e.needs_attention=1),0) AS flagged,
    MAX(v.error_message) AS error_message
    FROM (SELECT * FROM verification_jobs WHERE preview_rules IS NULL ORDER BY id DESC LIMIT 10) j
    LEFT JOIN event_verifications v ON v.job_id=j.id LEFT JOIN events e ON e.id=v.event_id
    GROUP BY j.id,j.provider,j.model,j.import_job_id,j.created_at ORDER BY j.id DESC`);
  return rows.map(row => ({ ...row, ...Object.fromEntries(['total', 'queued', 'running', 'completed', 'failed', 'skipped', 'flagged'].map(key => [key, Number(row[key])])) }));
}
