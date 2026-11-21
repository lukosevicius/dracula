import { All, Controller, Inject, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { createReadStream } from 'node:fs';
import { lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { AdminGuard } from './admin.guard.js';
import { AdminService } from './admin.service.js';
import { ImportsService } from '../imports/imports.service.js';

const types: Record<string, string> = { '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.png':'image/png', '.webp':'image/webp', '.gif':'image/gif' };
function json(res: Response, status: number, body: unknown): void {
  res.setHeader('Cache-Control','no-store'); res.status(status).json(body);
}
function clientError(cause: unknown): {status: number; message: string} | null {
  if (cause instanceof Error && 'status' in cause && typeof cause.status === 'number' && cause.status >= 400 && cause.status < 500) return {status:cause.status,message:cause.message};
  return null;
}

@Controller('v1/admin')
@UseGuards(AdminGuard)
export class AdminController {
  constructor(@Inject(AdminService) private readonly service: AdminService, @Inject(APP_CONFIG) private readonly config: AppConfig, @Inject(ImportsService) private readonly imports: ImportsService) {}

  @All('*path')
  async handle(@Req() req: Request, @Res() res: Response): Promise<void> {
    const admin=this.service.backend!;
    const url=new URL(req.originalUrl,'http://localhost');
    const path=url.pathname;
    try {
      if (req.method==='GET' && path==='/v1/admin/seeker/saved-events') return json(res,200,{events:await admin.savedEvents()});
      if (req.method==='GET' && path==='/v1/admin/seeker/settings') return json(res,200,{settings:await admin.seekerSettings()});
      const savedEvent=/^\/v1\/admin\/seeker\/saved-events\/(\d{1,12})$/.exec(path);
      if(req.method==='DELETE'&&savedEvent&&Number(savedEvent[1])>0){await admin.removeSavedEvent(Number(savedEvent[1]));return json(res,200,{ok:true});}
      if (req.method==='GET' && path==='/v1/admin/jobs') return json(res,200,{jobs:await this.imports.jobs.list()});
      if (req.method==='GET' && path==='/v1/admin/artists') return json(res,200,await admin.artistsDashboard());
      const artistDetail = /^\/v1\/admin\/artists\/([^/]+)$/.exec(path);
      if (req.method === 'GET' && artistDetail) {
        const detail = await admin.getArtist(artistDetail[1]);
        return detail ? json(res, 200, detail) : json(res, 404, { error: 'Artist not found.' });
      }
      if (req.method==='GET' && path==='/v1/admin/ai/artists') return json(res,200,{artists:await this.imports.ai.artists()});
      if (req.method==='GET' && path==='/v1/admin/ai/results') return json(res,200,{results:await this.imports.ai.list()});
      if (req.method==='GET' && path==='/v1/admin/ai/events') return json(res,200,{ids:await this.imports.ai.eventIds(Number(url.searchParams.get('limit')||1))});
      const aiEvent=/^\/v1\/admin\/ai\/events\/(\d{1,12})$/.exec(path);
      if(req.method==='GET' && aiEvent){const event=await this.imports.ai.event(Number(aiEvent[1]));return event?json(res,200,{event}):json(res,404,{error:'Not found'});}
      if(req.method==='GET' && path==='/v1/admin/enrichment') return json(res,200,{events:await admin.enrichmentCandidates(url.searchParams.get('mode'),Number(url.searchParams.get('after')||0),Number(url.searchParams.get('eventId')||0))});
      if(req.method==='GET' && path==='/v1/admin/media') return json(res,200,{ids:await admin.listMedia(Number(url.searchParams.get('after')||0),Number(url.searchParams.get('limit')||100))});
      const imageInfo=/^\/v1\/admin\/images\/(\d{1,12})\/info$/.exec(path);
      if(req.method==='GET' && imageInfo){const record=await admin.getImage(Number(imageInfo[1]));if(!record || !/^\d+(?:-[a-f0-9]{64})?\.(jpg|png|webp|gif)$/.test(record.local_name))return json(res,404,{error:'Not found'});const info=await lstat(join(this.config.imageDir,record.local_name)).catch(()=>null);if(!info?.isFile())return json(res,404,{error:'Not found'});return json(res,200,{source_url:record.source_url,source_modified:record.source_modified});}
      const image=/^\/v1\/admin\/images\/(\d{1,12})$/.exec(path);
      if(req.method==='GET' && image){
        const record=await admin.getImage(Number(image[1]));
        if(!record || !/^\d+(?:-[a-f0-9]{64})?\.(jpg|png|webp|gif)$/.test(record.local_name))return json(res,404,{error:'Not found'});
        const ext=record.local_name.slice(record.local_name.lastIndexOf('.'));
        if(record.mime_type!==types[ext])return json(res,404,{error:'Not found'});
        const file=join(this.config.imageDir,record.local_name),info=await lstat(file).catch(()=>null);
        if(!info?.isFile())return json(res,404,{error:'Not found'});
        res.writeHead(200,{'Content-Type':types[ext],'Content-Length':info.size,'Cache-Control':'private, no-store'});
        const stream=createReadStream(file);stream.on('error',()=>res.destroy());stream.pipe(res);return;
      }
      const avilysImageInfo=/^\/v1\/admin\/event-images\/avilys\/(\d{1,12})\/info$/.exec(path);
      if(req.method==='GET' && avilysImageInfo){const record=await admin.getAvilysImage(Number(avilysImageInfo[1]));if(!record||!/^[A-Za-z0-9._-]+\.(jpg|png|webp|gif)$/.test(record.local_name))return json(res,200,{image:null});const info=await lstat(join(this.config.imageDir,record.local_name)).catch(()=>null);return json(res,200,{image:info?.isFile()?{source_url:record.source_url,width:record.width,height:record.height}:null});}
      const avilysImage=/^\/v1\/admin\/event-images\/avilys\/(\d{1,12})$/.exec(path);
      if(req.method==='GET' && avilysImage){const record=await admin.getAvilysImage(Number(avilysImage[1]));if(!record||!/^[A-Za-z0-9._-]+\.(jpg|png|webp|gif)$/.test(record.local_name))return json(res,404,{error:'Not found'});const ext=record.local_name.slice(record.local_name.lastIndexOf('.'));if(record.mime_type!==types[ext])return json(res,404,{error:'Not found'});const file=join(this.config.imageDir,record.local_name),info=await lstat(file).catch(()=>null);if(!info?.isFile())return json(res,404,{error:'Not found'});res.writeHead(200,{'Content-Type':types[ext],'Content-Length':info.size,'Cache-Control':'private, no-store'});const stream=createReadStream(file);stream.on('error',()=>res.destroy());stream.pipe(res);return;}
      if(req.method==='GET' && path==='/v1/admin/events') return json(res,200,await admin.listEvents(url.searchParams));
      const event=/^\/v1\/admin\/events\/(\d{1,12})$/.exec(path);
      if(req.method==='GET' && event && Number(event[1])>0) return json(res,200,await admin.getEvent(Number(event[1])));
      if(req.method!=='POST')return json(res,405,{error:'Method not allowed'});
      const isVilnius=path==='/v1/admin/imports/vilnius-events/page', isAvilys=path==='/v1/admin/imports/avilys/page';
      const isReservation=path==='/v1/admin/imports/vilnius-events/reserve-request';
      const isArtistImport=path==='/v1/admin/imports/musicbrainz/page', isArtistReservation=path==='/v1/admin/imports/musicbrainz/reserve-request';
      const isAiSave=path==='/v1/admin/ai/results', aiDecision=/^\/v1\/admin\/ai\/results\/(\d{1,12})\/decision$/.exec(path);
      const isSeekerSave=path==='/v1/admin/seeker/saved-events',isSeekerSettings=path==='/v1/admin/seeker/settings';
      const isJobStart=path==='/v1/admin/jobs/start', isImageUpload=path==='/v1/admin/images';
      const isAvilysImageUpload=path==='/v1/admin/event-images/avilys';
      const jobUpdate=/^\/v1\/admin\/jobs\/(\d{1,12})$/.exec(path);
      const route=/^\/v1\/admin\/events\/(\d{1,12})\/(review|details|artist|price|interest-score|confirm-assistant-review|enrich)$/.exec(path);
      if (!isVilnius && !isAvilys && !isReservation && !isArtistImport && !isArtistReservation && !isAiSave && !aiDecision && !isJobStart && !isImageUpload && !isAvilysImageUpload && !isSeekerSave && !isSeekerSettings && !jobUpdate && (!route || !Number.isSafeInteger(Number(route[1])) || Number(route[1])<1)) return json(res,404,{error:'Not found'});
      if(!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || ''))return json(res,415,{error:'Expected JSON'});
      const max=isImageUpload||isAvilysImageUpload?17*1024*1024:isVilnius||isAvilys||isArtistImport?6*1024*1024:isAiSave||route?.[2]==='enrich'?512*1024:isSeekerSettings?65536:isSeekerSave?8192:8192;
      let size=0;const chunks: Buffer[]=[];
      for await (const chunk of req) { const bytes=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);size+=bytes.length;if(size>max)return json(res,413,{error:'Request too large'});chunks.push(bytes); }
      let body: Record<string, unknown>;
      try { body=JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string,unknown>; } catch { return json(res,400,{error:'Invalid JSON'}); }
      if(isAvilys)return json(res,200,{ok:true,...await this.imports.avilys(body)});
      if(isVilnius)return json(res,200,{ok:true,...await this.imports.vilnius(body)});
      if(isArtistImport)return json(res,200,{ok:true,...await this.imports.musicbrainz(body)});
      if(isReservation)return json(res,200,{ok:true,...await admin.reserveVilniusRequest()});
      if(isArtistReservation)return json(res,200,{ok:true,...await this.imports.reserveMusicBrainz()});
      if(isJobStart)return json(res,200,{ok:true,...await this.imports.jobs.start(body.action,body.source,body.limit)});
      if(isImageUpload)return json(res,200,{ok:true,...await this.imports.saveImage(body)});
      if(isAvilysImageUpload)return json(res,200,{ok:true,...await this.imports.saveAvilysImage(body)});
      if(isSeekerSave){await admin.saveEvents(body.ids as number[]);return json(res,200,{ok:true});}
      if(isSeekerSettings){await admin.saveSeekerSetting(body.key as string,body.value);return json(res,200,{ok:true});}
      if(isAiSave){await this.imports.ai.save(body);return json(res,200,{ok:true});}
      if(aiDecision){await this.imports.ai.decision(Number(aiDecision[1]),body.decision);return json(res,200,{ok:true});}
      if(jobUpdate){await this.imports.jobs.update(Number(jobUpdate[1]),body);return json(res,200,{ok:true});}
      if(!route)return json(res,404,{error:'Not found'});
      const id=Number(route[1]);
      switch(route[2]) {
        case 'review': await admin.review(id,body); break;
        case 'details': await admin.details(id,body); break;
        case 'artist': await admin.artist(id,body); break;
        case 'price': await admin.price(id,body); break;
        case 'interest-score': await admin.interestScore(id,body); break;
        case 'confirm-assistant-review': await admin.confirmAssistantReview(id); break;
        case 'enrich': await this.imports.enrich(id,body); break;
      }
      return json(res,200,{ok:true});
    } catch (cause) {
      const problem=clientError(cause);if(problem)return json(res,problem.status,{error:problem.message});
      console.error('Request failed:',cause);return json(res,500,{error:'Service unavailable'});
    }
  }
}
