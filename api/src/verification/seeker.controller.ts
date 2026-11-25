import { readFile } from 'node:fs/promises';
import { All, Controller, Inject, Req, Res } from '@nestjs/common';
import type { RowDataPacket } from 'mysql2/promise';
import type { Request, Response } from 'express';
import { AdminService } from '../admin/admin.service.js';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { DatabaseService } from '../database/database.service.js';
import { claimImport, identity, importRequest, listAgents, manageAgent, queueImport, type Scope } from './agents.js';
import { fail, type Snapshot } from './history.js';
import { listProviders, manageProvider } from './providers.js';
import { listRules, updateRules } from './rule-settings.js';
import { verificationUsage } from './usage.js';
import { editPublication, manualVerification, proposeFinding, queueRulesPreview, recentVerificationJobs, resolveFinding, rulesPreview, verificationDetails, verificationJob } from './verification.js';

async function readJson(request: Request): Promise<Snapshot> {
  if (!/^application\/json(?:\s*;|$)/i.test(String(request.headers['content-type'] ?? ''))) throw fail(415, 'Expected JSON.');
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    const bytes = Buffer.from(chunk);
    size += bytes.length;
    if (size > 32_768) throw fail(413, 'Request too large.');
    chunks.push(bytes);
  }
  try {
    const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error();
    return data;
  } catch {
    throw fail(400, 'Invalid JSON body.');
  }
}

@Controller('v1/seeker')
export class SeekerController {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(AdminService) private readonly admin: AdminService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @All('*path')
  async handle(@Req() req: Request, @Res() res: Response): Promise<void> {
    res.setHeader('Cache-Control', 'private, no-store');
    const send = (status: number, body: object) => { res.status(status).json(body); };
    const pool = this.db.pool;
    try {
      if (!this.admin.backend) throw fail(404, 'Seeker is unavailable.');
      const access = await identity(pool, req.headers.authorization, this.admin.backend.authorized(req.headers.authorization));
      const require = (scope: Scope | 'admin') => {
        if (scope === 'admin' ? !access.admin : !access.scopes.includes(scope)) throw fail(403, 'This credential lacks the required permission.');
      };
      const url = new URL(req.originalUrl, 'http://localhost');
      const path = url.pathname.slice('/v1/seeker'.length);
      const event = /^\/events\/([1-9]\d{0,11})(?:\/(verification|publication|findings)(?:\/([1-9]\d{0,11}))?)?$/.exec(path);
      const preview = /^\/verification\/rules\/previews\/([1-9]\d{0,14})$/.exec(path);
      const verification = /^\/verification\/jobs\/([1-9]\d{0,11})$/.exec(path);
      const imported = /^\/imports\/([1-9]\d{0,11})$/.exec(path);
      if (req.method === 'GET') {
        if (path === '/openapi.json') {
          return send(200, JSON.parse(await readFile(new URL('../../openapi/seeker.openapi.json', import.meta.url), 'utf8')));
        }
        if (path === '/events') {
          require('events:read');
          return send(200, await this.admin.backend.listEvents(url.searchParams));
        }
        if (event && (!event[2] || event[2] === 'verification') && !event[3]) {
          require('events:read');
          const id = Number(event[1]);
          const before = url.searchParams.get('before');
          if (before && !/^[1-9]\d{0,14}$/.test(before)) throw fail(400, 'Invalid event log cursor.');
          const details = await verificationDetails(pool, id, before ? Number(before) : undefined);
          if (event[2]) return send(200, details);
          const { available_artists: _artists, ...eventData } = await this.admin.backend.getEvent(id);
          return send(200, { ...eventData, verification: details });
        }
        if (path === '/attention-count') {
          require('events:read');
          const [rows] = await pool.execute<RowDataPacket[]>('SELECT COUNT(*) AS count FROM events WHERE needs_attention=1');
          return send(200, { count: Number(rows[0].count) });
        }
        if (path === '/providers') {
          require('admin');
          return send(200, await listProviders(pool, this.config.aiEncryptionKey));
        }
        if (path === '/agents') {
          require('admin');
          return send(200, { agents: await listAgents(pool) });
        }
        if (path === '/verification/rules') {
          require('admin');
          return send(200, await listRules(pool));
        }
        if (preview) {
          require('admin');
          return send(200, await rulesPreview(pool, Number(preview[1])));
        }
        if (path === '/verification/usage') {
          require('admin');
          return send(200, await verificationUsage(pool, url.searchParams));
        }
        if (path === '/verification/jobs') {
          require('verification:run');
          return send(200, { jobs: await recentVerificationJobs(pool) });
        }
        if (verification) {
          require('verification:run');
          return send(200, await verificationJob(pool, Number(verification[1])));
        }
        if (imported) {
          require('imports:run');
          return send(200, await importRequest(pool, Number(imported[1])));
        }
      }
      if (req.method === 'POST') {
        const body = await readJson(req);
        if (path === '/providers') {
          require('admin');
          await manageProvider(pool, this.config.aiEncryptionKey, body);
          return send(200, { ok: true });
        }
        if (path === '/agents') {
          require('admin');
          return send(200, { ok: true, ...await manageAgent(pool, body) });
        }
        if (path === '/verification/rules') {
          require('admin');
          await updateRules(pool, body, access.actor);
          return send(200, { ok: true, ...await listRules(pool) });
        }
        if (path === '/verification/rules/previews') {
          require('admin');
          return send(202, { ok: true, ...await queueRulesPreview(pool, body, access.actor) });
        }
        if (path === '/verification/jobs') {
          require('verification:run');
          if (!access.admin && !body.request_key) throw fail(400, 'Supply a request key for safe retries.');
          if (!access.scopes.includes('publication:write')) body.allow_publish = false;
          return send(202, { ok: true, ...await manualVerification(pool, body, access.actor) });
        }
        if (path === '/imports') {
          require('imports:run');
          if (body.verify_after_import !== false) require('verification:run');
          return send(202, { ok: true, ...await queueImport(pool, body, access.actor, access.scopes.includes('publication:write')) });
        }
        if (path === '/imports/claim') {
          require('admin');
          return send(200, { ok: true, request: await claimImport(pool) });
        }
        if (event?.[2] === 'publication' && !event[3]) {
          require('publication:write');
          await editPublication(pool, Number(event[1]), body, access.actor);
          return send(200, { ok: true });
        }
        if (event?.[2] === 'findings') {
          if (event[3]) {
            require('findings:resolve');
            await resolveFinding(pool, Number(event[1]), Number(event[3]), body, access.actor, access.scopes.includes('publication:write'));
            return send(200, { ok: true });
          }
          require('findings:propose');
          return send(201, { ok: true, ...await proposeFinding(pool, Number(event[1]), body, access.actor) });
        }
      }
      throw fail(404, 'Seeker operation not found.');
    } catch (error) {
      const status = (error as { status?: number }).status;
      if (status && status >= 400 && status < 600 && error instanceof Error) return send(status, { error: error.message });
      console.error('Seeker workflow request failed:', error instanceof Error ? error.name : 'Unknown error');
      return send(500, { error: 'Seeker operation failed.' });
    }
  }
}
