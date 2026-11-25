import type { Pool, RowDataPacket } from 'mysql2/promise';
import { vilniusToday } from '../catalogue/catalogue.service.js';
import { fail, transaction } from './history.js';

export type TokenUsage = { input: number; cached: number; output: number };
type Provider = 'openai' | 'gemini';

// Standard text rates in USD per million tokens, checked 2026-11-24.
// https://developers.openai.com/api/docs/pricing
// https://ai.google.dev/gemini-api/docs/pricing
const rates = new Map([
  ['openai:gpt-6-luna', { input: 0.1, cached: 0.01, output: 0.5 }],
  ['openai:gpt-6.1-sol', { input: 2, cached: 0.1, output: 10 }],
  ['openai:gpt-6.1-terra', { input: 1, cached: 0.05, output: 5 }],
  ['openai:gpt-6-astra', { input: 10, cached: 1, output: 50 }],
  ['gemini:gemini-3.5-flash-lite', { input: 0.3, cached: 0.03, output: 2.5 }],
]);

type UsagePayload = {
  usage?: { prompt_tokens?: unknown; prompt_tokens_details?: { cached_tokens?: unknown }; completion_tokens?: unknown };
  usageMetadata?: { promptTokenCount?: unknown; cachedContentTokenCount?: unknown; candidatesTokenCount?: unknown; thoughtsTokenCount?: unknown };
};

function tokenCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 0xffffffff;
}

export function readProviderUsage(provider: Provider, response: UsagePayload | null): TokenUsage | null {
  if (provider === 'gemini') {
    const usage = response?.usageMetadata;
    if (!usage) return null;
    const { promptTokenCount: input, cachedContentTokenCount: cached = 0, candidatesTokenCount = 0, thoughtsTokenCount = 0 } = usage;
    if (!tokenCount(input) || !tokenCount(cached) || !tokenCount(candidatesTokenCount) || !tokenCount(thoughtsTokenCount)) return null;
    const output = candidatesTokenCount + thoughtsTokenCount;
    return cached <= input && tokenCount(output) ? { input, cached, output } : null;
  }
  const input = response?.usage?.prompt_tokens;
  const cached = response?.usage?.prompt_tokens_details?.cached_tokens ?? 0;
  const output = response?.usage?.completion_tokens;
  return tokenCount(input) && tokenCount(cached) && tokenCount(output) && cached <= input ? { input, cached, output } : null;
}

export function estimatedTokenCost(provider: Provider, model: string, usage: TokenUsage) {
  const rate = rates.get(`${provider}:${model}`);
  if (!rate) return null;
  return ((usage.input - usage.cached) * rate.input + usage.cached * rate.cached + usage.output * rate.output) / 1_000_000;
}

export async function beginProviderRequest(pool: Pool, claim: string, verificationId: number, provider: Provider, model: string) {
  await pool.execute(`INSERT INTO verification_provider_requests(id,verification_id,provider,model,requested_at)
    VALUES(?,?,?,?,UTC_TIMESTAMP(3))`, [claim, verificationId, provider, model]);
}

export async function finishProviderRequest(pool: Pool, claim: string, provider: Provider, model: string, usage: TokenUsage | null) {
  await pool.execute(`UPDATE verification_provider_requests SET finished_at=UTC_TIMESTAMP(3),
    input_tokens=?,cached_input_tokens=?,output_tokens=?,estimated_cost_usd=? WHERE id=?`,
  [usage?.input ?? null, usage?.cached ?? null, usage?.output ?? null, usage && estimatedTokenCost(provider, model, usage), claim]);
}

const offsetFormat = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Vilnius', timeZoneName: 'longOffset' });
export const usagePeriods = ['today', 'week', 'month'] as const;
type Period = typeof usagePeriods[number];

function dayOf(date: Date) {
  return date.toISOString().slice(0, 10);
}

function localMidnight(date: string) {
  const utcMidnight = Date.parse(`${date}T00:00:00Z`);
  let instant = utcMidnight;
  // Resolve the offset at local midnight so days that change clocks use the correct boundary.
  for (let iteration = 0; iteration < 2; iteration++) {
    const value = offsetFormat.formatToParts(new Date(instant)).find(part => part.type === 'timeZoneName')?.value;
    const offset = /^GMT([+-])(\d{2}):(\d{2})$/.exec(value ?? '');
    if (!offset) throw Error('Could not determine the Vilnius time offset.');
    const minutes = (Number(offset[2]) * 60 + Number(offset[3])) * (offset[1] === '-' ? -1 : 1);
    instant = utcMidnight - minutes * 60_000;
  }
  return new Date(instant).toISOString().slice(0, 23).replace('T', ' ');
}

export function usageWindow(period: Period, now = new Date()) {
  const start = new Date(`${vilniusToday(now)}T00:00:00Z`);
  if (period === 'week') start.setUTCDate(start.getUTCDate() - (start.getUTCDay() + 6) % 7);
  if (period === 'month') start.setUTCDate(1);
  const end = new Date(start);
  if (period === 'month') end.setUTCMonth(end.getUTCMonth() + 1);
  else end.setUTCDate(end.getUTCDate() + (period === 'week' ? 7 : 1));
  return [localMidnight(dayOf(start)), localMidnight(dayOf(end))] as const;
}

export const historicalFinding = 'EXISTS (SELECT 1 FROM verification_findings f WHERE f.verification_id=v.id)';
const metricKeys = ['requests', 'missing_usage', 'unpriced', 'input_tokens', 'cached_input_tokens', 'output_tokens'] as const;

export async function verificationUsage(pool: Pool, query: URLSearchParams) {
  const period = (query.get('period') ?? 'today') as Period;
  const page = Number(query.get('page') ?? '1');
  const limit = 20;
  if (!usagePeriods.includes(period) || !Number.isSafeInteger(page) || page < 1 || page > 10000) throw fail(400, 'Invalid usage period or page.');
  const window = usageWindow(period);
  return transaction(pool, async conn => {
    const [[activity]] = await conn.execute<RowDataPacket[]>(`SELECT
      COALESCE(SUM(v.status='completed'),0) AS completed,
      COALESCE(SUM(v.status='failed'),0) AS failed,
      COALESCE(SUM(v.status='skipped'),0) AS skipped,
      COALESCE(SUM(v.status='completed' AND ${historicalFinding}),0) AS flagged
      FROM event_verifications v WHERE v.finished_at>=? AND v.finished_at<?`, [...window]);
    const [models] = await conn.execute<RowDataPacket[]>(`SELECT p.provider,p.model,COUNT(*) AS requests,
      SUM(p.input_tokens IS NULL) AS missing_usage,
      SUM(p.input_tokens IS NOT NULL AND p.estimated_cost_usd IS NULL) AS unpriced,
      SUM(p.input_tokens) AS input_tokens,SUM(p.cached_input_tokens) AS cached_input_tokens,
      SUM(p.output_tokens) AS output_tokens,SUM(p.estimated_cost_usd) AS cost
      FROM verification_provider_requests p WHERE p.requested_at>=? AND p.requested_at<?
      GROUP BY p.provider,p.model ORDER BY requests DESC,p.provider,p.model`, [...window]);
    const [[count]] = await conn.execute<RowDataPacket[]>('SELECT COUNT(*) AS total FROM verification_jobs WHERE created_at>=? AND created_at<?', [...window]);
    const [runs] = await conn.execute<RowDataPacket[]>(`SELECT j.id,j.provider,j.model,j.import_job_id,j.actor,j.preview,
      DATE_FORMAT(j.created_at,'%Y-%m-%dT%H:%i:%sZ') AS queued_at,
      DATE_FORMAT(j.started_at,'%Y-%m-%dT%H:%i:%sZ') AS started_at,
      COUNT(v.id) AS events,COALESCE(SUM(v.status='completed'),0) AS completed,
      COALESCE(SUM(v.status='failed'),0) AS failed,COALESCE(SUM(v.status='skipped'),0) AS skipped,
      COALESCE(SUM(v.status IN ('queued','running')),0) AS pending,
      COALESCE(SUM(v.status='completed' AND ${historicalFinding}),0) AS flagged
      FROM (SELECT id,provider,model,import_job_id,actor,preview_rules IS NOT NULL AS preview,created_at,started_at FROM verification_jobs
        WHERE created_at>=? AND created_at<? ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?) j
      LEFT JOIN event_verifications v ON v.job_id=j.id GROUP BY j.id,j.provider,j.model,j.import_job_id,j.actor,j.preview,j.created_at,j.started_at
      ORDER BY j.created_at DESC,j.id DESC`, [...window, limit, (page - 1) * limit]);
    const byModel = models.map(row => ({
      provider: String(row.provider), model: String(row.model),
      requests: Number(row.requests), missing_usage: Number(row.missing_usage), unpriced: Number(row.unpriced),
      input_tokens: Number(row.input_tokens), cached_input_tokens: Number(row.cached_input_tokens),
      output_tokens: Number(row.output_tokens), estimated_cost_usd: row.cost === null ? null : Number(row.cost),
    }));
    const usage = { requests: 0, missing_usage: 0, unpriced: 0, input_tokens: 0, cached_input_tokens: 0,
      output_tokens: 0, estimated_cost_usd: null as number | null };
    for (const model of byModel) {
      for (const key of metricKeys) usage[key] += model[key];
      if (model.estimated_cost_usd !== null) usage.estimated_cost_usd = (usage.estimated_cost_usd ?? 0) + model.estimated_cost_usd;
    }
    return {
      activity: { completed: Number(activity.completed), failed: Number(activity.failed), skipped: Number(activity.skipped), flagged: Number(activity.flagged) },
      usage,
      by_model: byModel,
      runs: runs.map(row => ({
        id: Number(row.id), provider: row.provider, model: row.model, import_job_id: row.import_job_id,
        actor: row.actor, preview: Boolean(row.preview), queued_at: row.queued_at, started_at: row.started_at, events: Number(row.events), completed: Number(row.completed),
        failed: Number(row.failed), skipped: Number(row.skipped), pending: Number(row.pending), flagged: Number(row.flagged),
      })),
      page, limit, total: Number(count.total),
    };
  });
}
