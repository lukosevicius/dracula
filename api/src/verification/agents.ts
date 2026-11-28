import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { fail, jsonValue, transaction, type Snapshot } from './history.js';

export const agentScopes = ['events:read', 'imports:run', 'verification:run', 'findings:propose', 'findings:resolve', 'publication:write'] as const;
export type Scope = typeof agentScopes[number];
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const nameOf = (value: unknown) => typeof value === 'string' ? value.trim() : '';
type Credentials = { admin: boolean; actor: string; scopes: Scope[] };

export async function identity(pool: Pool, header: string | undefined, admin: boolean): Promise<Credentials> {
  if (admin) return { admin: true, actor: 'Seeker editor', scopes: [...agentScopes] };
  const token = /^Bearer (ska_[A-Za-z0-9_-]{43})$/.exec(header ?? '')?.[1];
  if (!token) throw fail(401, 'Supply a Seeker agent credential.');
  const [rows] = await pool.execute<RowDataPacket[]>('SELECT id,name,scopes FROM seeker_agent_keys WHERE token_hash=? AND revoked_at IS NULL', [hash(token)]);
  if (!rows.length) throw fail(401, 'This agent credential is invalid or revoked.');
  return { admin: false, actor: `Agent ${rows[0].id} · ${rows[0].name}`, scopes: jsonValue<Scope[]>(rows[0].scopes) };
}

export async function listAgents(pool: Pool) {
  const [rows] = await pool.execute<RowDataPacket[]>('SELECT id,name,scopes,revoked_at FROM seeker_agent_keys ORDER BY id DESC');
  return rows.map(row => ({ ...row, scopes: jsonValue(row.scopes) }));
}

export async function manageAgent(pool: Pool, body: Snapshot) {
  if (body.action === 'revoke') {
    if (!Number.isSafeInteger(body.id) || Number(body.id) < 1) throw fail(400, 'Invalid agent ID.');
    await pool.execute('UPDATE seeker_agent_keys SET revoked_at=UTC_TIMESTAMP(3) WHERE id=? AND revoked_at IS NULL', [Number(body.id)]);
    return {};
  }
  const name = nameOf(body.name);
  const scopes = body.scopes;
  if (body.action !== 'create' || !name || name.length > 100 || !Array.isArray(scopes) || !scopes.length || scopes.some(scope => !agentScopes.includes(scope))) throw fail(400, 'Enter a name and choose agent permissions.');
  const token = `ska_${randomBytes(32).toString('base64url')}`;
  const [result] = await pool.execute<ResultSetHeader>('INSERT INTO seeker_agent_keys(name,token_hash,scopes) VALUES(?,?,?)', [name, hash(token), JSON.stringify([...new Set(scopes)])]);
  return { id: result.insertId, token };
}

export async function queueImport(pool: Pool, body: Snapshot, actor: string, mayPublish: boolean) {
  const { source, action, request_key, limit = 20, start_page = 1, pages = 1, include_images = false, verify_after_import = true } = body;
  const integer = (value: unknown, max: number) => Number.isInteger(value) && Number(value) >= 1 && Number(value) <= max;
  if (typeof request_key !== 'string' || !/^[\w.-]{1,100}$/.test(request_key) || typeof include_images !== 'boolean' || typeof verify_after_import !== 'boolean' ||
      (source === 'avilys' ? action !== 'import' || !integer(limit, 200) || !integer(start_page, 10_000) :
        source === 'kakava' ? action !== 'import' || !integer(limit, 1000) :
        source !== 'vilnius-events' || !['next','start','sample','refresh'].includes(String(action)) || !integer(pages, 10))) throw fail(400, 'Invalid event import options or request key.');
  const options = { source, action, limit, start_page, pages, include_images, verify_after_import, publish_after_verification: mayPublish };
  return transaction(pool, async conn => {
    const [result] = await conn.execute<ResultSetHeader>(`INSERT INTO seeker_import_requests(actor,request_key,options)
      VALUES(?,?,?) ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)`, [actor, request_key, JSON.stringify(options)]);
    const [rows] = await conn.execute<RowDataPacket[]>('SELECT id,options FROM seeker_import_requests WHERE id=?', [result.insertId]);
    const old = jsonValue<Snapshot>(rows[0].options);
    if (Object.entries(options).some(([key, value]) => old[key] !== value)) throw fail(409, 'This request key was already used with different options.');
    return { id: result.insertId };
  });
}

export async function importRequest(pool: Pool, id: number) {
  const [rows] = await pool.execute<RowDataPacket[]>(`SELECT r.id,r.status,r.options,r.error_message,r.job_id,v.id AS verification_job_id,
    CASE WHEN j.status='running' AND (l.job_id IS NULL OR l.expires_at<=?) THEN 'interrupted' ELSE j.status END AS job_status,
    j.progress_json,j.error_message AS job_error FROM seeker_import_requests r
    LEFT JOIN jobs j ON j.id=r.job_id LEFT JOIN job_leases l ON l.job_id=j.id LEFT JOIN verification_jobs v ON v.import_job_id=r.job_id WHERE r.id=?`, [Date.now(), id]);
  if (!rows.length) throw fail(404, 'Import request not found.');
  const row = rows[0];
  return { ...row, status: row.job_status ?? row.status, error_message: row.job_error ?? row.error_message, options: jsonValue(row.options), progress: row.progress_json ? jsonValue(row.progress_json) : null };
}

export async function claimImport(pool: Pool) {
  return transaction(pool, async conn => {
    const [state] = await conn.execute<RowDataPacket[]>("SELECT source_key FROM source_state WHERE source_key='vilnius-events' FOR UPDATE");
    if (!state.length) return null;
    const [lease] = await conn.execute<RowDataPacket[]>("SELECT job_id FROM job_leases WHERE source_key='vilnius-events' AND expires_at>?", [Date.now()]);
    if (lease.length) return null;
    const [rows] = await conn.execute<RowDataPacket[]>(`SELECT id,options FROM seeker_import_requests WHERE job_id IS NULL
      AND (status='queued' OR (status='running' AND lease_until<UTC_TIMESTAMP(3))) ORDER BY id LIMIT 1 FOR UPDATE`);
    if (!rows.length) return null;
    const claim = randomUUID();
    await conn.execute("UPDATE seeker_import_requests SET claim=?,status='running',lease_until=DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 30 SECOND) WHERE id=?", [claim, rows[0].id]);
    return { id: rows[0].id, claim, options: jsonValue(rows[0].options) };
  });
}

export async function validateImportClaim(conn: PoolConnection, request: unknown, source: string, action: string) {
  if (request === undefined) return null;
  if (!request || typeof request !== 'object') throw fail(400, 'Invalid import claim.');
  const { id, claim } = request as { id?: number; claim?: string };
  if (!Number.isSafeInteger(id) || Number(id) < 1 || typeof claim !== 'string') throw fail(400, 'Invalid import claim.');
  const [rows] = await conn.execute<RowDataPacket[]>(`SELECT options FROM seeker_import_requests
    WHERE id=? AND claim=? AND job_id IS NULL AND status='running' AND lease_until>UTC_TIMESTAMP(3) FOR UPDATE`, [id!, claim]);
  const options = rows[0] && jsonValue<Snapshot>(rows[0].options);
  if (!options || options.source !== source || options.action !== action) throw fail(409, 'This import claim is stale.');
  return id!;
}
