import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { fail, jsonValue, transaction, type Snapshot } from './history.js';

export const permissions = ['auto', 'review', 'disabled'] as const;
type Permission = typeof permissions[number];
const actions = {
  title: ['Change event title', 'review'],
  description: ['Change event description', 'review'],
  event_date: ['Set start date', 'auto'],
  event_end_date: ['Set end date', 'auto'],
  event_time: ['Set start time', 'auto'],
  venue: ['Set venue', 'auto'],
  city: ['Set city', 'auto'],
  ticket_url: ['Set ticket link', 'auto'],
  about_url: ['Set original event link', 'auto'],
  price_type: ['Set price type', 'auto'],
  price_text: ['Set price', 'auto'],
  artists: ['Link a catalogue artist', 'auto'],
  music: ['Mark as Music', 'auto'],
  not_music: ['Mark as Not music', 'auto'],
  unsure: ['Set music classification to Unsure', 'review'],
  publication_status: ['Publish in Dracula', 'auto'],
} satisfies Record<string, [string, Permission]>;

export type RuleAction = keyof typeof actions;
export type Rules = { markdown: string; permissions: Record<RuleAction, Permission> };
export type PreviewRules = { rules: Rules; draft_revision: number | null };
const actionEntries = Object.entries(actions) as [RuleAction, [string, Permission]][];
export const defaultRules: Rules = {
  markdown: `# Music classification

Classify concerts, live performances, DJ sets and events where music is the main activity as music. Use not_music when the main activity is unrelated to music. Use unsure if the listing does not establish which applies.

# Performers

Use the artist catalogue candidates when they match a performer actually appearing at this event. Check both the title and description. A tribute subject, composer, influence or person merely mentioned in the listing is not a performer. Report each performer separately using their exact listed name and quote the text that identifies them. Include international performers and performers missing from the catalogue.

# Dates, times and venue

Use Vilnius local time. Distinguish the performance start from doors, the end time and the date the listing was published. Use structured source values as evidence. Flag explicit disagreements between the listing text and structured values, and quote the competing value. Never infer a missing year or time.

# Price and other details

Mark an event as free only when the listing explicitly says admission is free. Leave unknown optional values unknown. Flag cancellations and potential duplicates when the evidence supports them.`,
  permissions: Object.fromEntries(actionEntries.map(([key, [, permission]]) => [key, permission])) as Rules['permissions'],
};

type RuleState = RowDataPacket & { active_version_id: number | null; draft: unknown; revision: number };

export async function readRuleVersion(db: Pool | PoolConnection, id: number | null): Promise<Rules> {
  if (id === null || id === 1) return defaultRules;
  const [rows] = await db.execute<RowDataPacket[]>('SELECT rules FROM verification_rule_versions WHERE id=?', [id]);
  if (!rows.length) throw fail(404, 'Rules version not found.');
  return jsonValue<Rules>(rows[0].rules);
}

async function ruleState(db: Pool | PoolConnection, lock = false): Promise<RuleState> {
  const [[state]] = await db.execute<RuleState[]>('SELECT active_version_id,draft,revision FROM verification_rule_state WHERE id=1' + (lock ? ' FOR UPDATE' : ''));
  if (!state) throw fail(503, 'AI rules are unavailable.');
  return state;
}

export async function listRules(pool: Pool) {
  return transaction(pool, async conn => {
    const state = await ruleState(conn);
    const [versions] = await conn.execute<RowDataPacket[]>(`SELECT id,activated_by,DATE_FORMAT(activated_at,'%Y-%m-%dT%H:%i:%sZ') AS activated_at
      FROM verification_rule_versions ORDER BY id DESC`);
    return {
      revision: Number(state.revision),
      active: { id: state.active_version_id ?? 1, ...await readRuleVersion(conn, state.active_version_id) },
      draft: jsonValue<Rules | null>(state.draft),
      versions: [...versions, { id: 1, activated_by: 'Seeker defaults', activated_at: null }],
      actions: actionEntries.map(([key, [label]]) => ({ key, label })),
    };
  });
}

function extractRules(body: Snapshot): Rules {
  const { markdown, permissions: selection } = body;
  if (typeof markdown !== 'string' || Buffer.byteLength(markdown, 'utf8') > 12_000 ||
      !selection || typeof selection !== 'object' || Array.isArray(selection) || Object.keys(selection).length !== actionEntries.length) {
    throw fail(400, 'Supply Markdown rules up to 12 KB and a permission for each action.');
  }
  const provided = selection as Record<string, Permission>;
  if (!actionEntries.every(([key]) => permissions.includes(provided[key]))) throw fail(400, 'Select a valid permission for every action.');
  return { markdown, permissions: Object.fromEntries(actionEntries.map(([key]) => [key, provided[key]])) as Rules['permissions'] };
}

function checkRuleRevision(state: RuleState, revision: unknown) {
  if (Number(state.revision) !== revision) throw fail(409, 'The AI rules changed. Reload the page before continuing.');
}

export async function updateRules(pool: Pool, body: Snapshot, actor: string) {
  return transaction(pool, async conn => {
    const state = await ruleState(conn, true);
    checkRuleRevision(state, body.revision);
    if (body.action === 'save' || body.action === 'restore' || body.action === 'discard') {
      let draft: Rules | null = null;
      if (body.action === 'save') draft = extractRules(body);
      if (body.action === 'restore') {
        if (typeof body.version_id !== 'number' || !Number.isSafeInteger(body.version_id) || body.version_id < 1) throw fail(400, 'Select a rules version.');
        draft = await readRuleVersion(conn, body.version_id);
      }
      await conn.execute('UPDATE verification_rule_state SET draft=?,revision=revision+1 WHERE id=1', [draft ? JSON.stringify(draft) : null]);
      return;
    }
    if (body.action === 'activate' && state.draft) {
      const [version] = await conn.execute<ResultSetHeader>(
        'INSERT INTO verification_rule_versions(rules,activated_by,activated_at) VALUES(?,?,UTC_TIMESTAMP(3))',
        [JSON.stringify(jsonValue<Rules>(state.draft)), actor],
      );
      await conn.execute('UPDATE verification_rule_state SET draft=NULL,active_version_id=?,revision=revision+1 WHERE id=1', [version.insertId]);
      return;
    }
    throw fail(400, 'Save a draft before activating it.');
  });
}

export async function rulesForPreview(conn: PoolConnection, revision: unknown) {
  const state = await ruleState(conn);
  checkRuleRevision(state, revision);
  const draft = jsonValue<Rules | null>(state.draft);
  const preview: PreviewRules = {
    rules: draft ?? await readRuleVersion(conn, state.active_version_id),
    draft_revision: draft ? Number(state.revision) : null,
  };
  return { preview, version: state.active_version_id };
}
