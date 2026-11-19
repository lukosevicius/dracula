import { All, Controller, Inject, Req, Res } from '@nestjs/common';
import { createReadStream } from 'node:fs';
import { lstat } from 'node:fs/promises';
import { join } from 'node:path';
import type { Request, Response } from 'express';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { CatalogueService, type DateFilter } from './catalogue.service.js';

const filters = new Set(['upcoming','today','tomorrow','weekend','custom','all','past','unknown']);
const types: Record<string, string> = { '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.png':'image/png', '.webp':'image/webp', '.gif':'image/gif' };
function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0,10) === value;
}
function json(res: Response, status: number, body: unknown): void {
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).json(body);
}

@Controller()
export class CatalogueController {
  constructor(@Inject(CatalogueService) private readonly catalogue: CatalogueService, @Inject(APP_CONFIG) private readonly config: AppConfig) {}

  @All('v1/events')
  async list(@Req() req: Request, @Res() res: Response): Promise<void> {
    if (req.method !== 'GET') return json(res, 405, {error:'Method not allowed'});
    const params = new URL(req.originalUrl, 'http://localhost').searchParams;
    try {
      if (params.has('filter') || params.has('offset')) {
        const filter=params.get('filter') ?? 'upcoming', offset=params.get('offset') ?? '0', limit=params.get('limit') ?? '30';
        const from=params.get('from') ?? '', to=params.get('to') ?? '';
        if (!filters.has(filter) || !/^\d{1,8}$/.test(offset) || !/^\d{1,3}$/.test(limit) || Number(limit)<1 || Number(limit)>100 || (filter==='custom' && (!validDate(from) || (to && (!validDate(to) || to<from))))) return json(res,400,{error:'Invalid filter or pagination'});
        return json(res,200,await this.catalogue.page({offset:Number(offset),limit:Number(limit),filter:filter as DateFilter,from,to}));
      }
      const after=params.get('after') ?? '0', limit=params.get('limit') ?? '30';
      if (!/^\d{1,12}$/.test(after) || !/^\d{1,3}$/.test(limit) || Number(limit)<1 || Number(limit)>100) return json(res,400,{error:'Invalid pagination'});
      return json(res,200,await this.catalogue.list(Number(after),Number(limit)));
    } catch (error) { console.error('Request failed:', error); return json(res,500,{error:'Service unavailable'}); }
  }

  @All('v1/events/:id')
  async event(@Req() req: Request, @Res() res: Response): Promise<void> {
    if (req.method !== 'GET') return json(res,405,{error:'Method not allowed'});
    if (!/^\d{1,12}$/.test(req.params.id as string)) return json(res,404,{error:'Not found'});
    try { const result=await this.catalogue.get(Number(req.params.id)); return result ? json(res,200,result) : json(res,404,{error:'Not found'}); }
    catch (error) { console.error('Request failed:', error); return json(res,500,{error:'Service unavailable'}); }
  }

  @All('v1/images/:name')
  async image(@Req() req: Request, @Res() res: Response): Promise<void> {
    if (req.method !== 'GET') return json(res,405,{error:'Method not allowed'});
    const name=req.params.name as string;
    if (!/^[A-Za-z0-9._-]+$/.test(name) || name === '.' || name === '..') return json(res,404,{error:'Not found'});
    const ext=name.slice(name.lastIndexOf('.')).toLowerCase();
    try {
      if (!types[ext] || !await this.catalogue.hasImage(name)) return json(res,404,{error:'Not found'});
      const file=join(this.config.imageDir,name), info=await lstat(file).catch(() => null);
      if (!info?.isFile()) return json(res,404,{error:'Not found'});
      res.writeHead(200,{'Content-Type':types[ext],'Content-Length':info.size,'Cache-Control':'public, max-age=3600'});
      const stream=createReadStream(file); stream.on('error',()=>res.destroy()); stream.pipe(res);
    } catch (error) { console.error('Request failed:', error); return json(res,500,{error:'Service unavailable'}); }
  }
}
