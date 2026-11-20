import { BadRequestException, Controller, Delete, ForbiddenException, Get, HttpCode, Inject, Options, Patch, Post, Req, Res, UnauthorizedException, UnsupportedMediaTypeException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { AuthService } from './auth.service.js';

async function jsonBody(req: Request): Promise<Record<string, unknown>> {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) throw new UnsupportedMediaTypeException('Expected JSON');
  let size=0; const chunks: Buffer[]=[];
  for await (const chunk of req) { const data=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk); size+=data.length; if(size>16384) throw new BadRequestException('Request too large'); chunks.push(data); }
  let body: unknown; try { body=JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new BadRequestException('Invalid JSON'); }
  if (!body || typeof body!=='object' || Array.isArray(body)) throw new BadRequestException('Invalid JSON');
  return body as Record<string,unknown>;
}
function cookie(req: Request, name: string): string {
  const values=(req.headers.cookie || '').split(';').map(item=>item.trim()).filter(item=>item.startsWith(`${name}=`));
  return values.length===1 ? values[0].slice(name.length+1) : '';
}
@Controller('v1')
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService, @Inject(APP_CONFIG) private readonly config: AppConfig) {}
  private get secure(): boolean { return new URL(this.config.publicBaseUrl).protocol==='https:'; }
  private name(kind: string): string { return `${this.secure ? '__Host-' : ''}dracula_${kind}`; }
  private options() { return {httpOnly:true,secure:this.secure,sameSite:'lax' as const,path:'/'}; }
  private origin(req: Request): void { if (!req.headers.origin || !this.config.authOrigins?.includes(req.headers.origin)) throw new ForbiddenException('Invalid origin'); }
  private preflight(req: Request, res: Response): void {
    this.origin(req);
    res.vary('Origin'); res.setHeader('Access-Control-Allow-Origin',req.headers.origin!);
    res.setHeader('Access-Control-Allow-Credentials','true');
    res.setHeader('Access-Control-Allow-Headers','Content-Type');
    res.setHeader('Access-Control-Allow-Methods','GET, POST, PATCH, DELETE, OPTIONS');
  }
  @Options('me') @HttpCode(204)
  preflightMe(@Req() req: Request, @Res({passthrough:true}) res: Response): void { this.preflight(req,res); }
  @Options('auth/*path') @HttpCode(204)
  preflightAuth(@Req() req: Request, @Res({passthrough:true}) res: Response): void { this.preflight(req,res); }
  @Post('auth/challenge') @HttpCode(200)
  async challenge(@Req() req: Request, @Res({passthrough:true}) res: Response) {
    this.origin(req); const {challenge,nonce}=await this.auth.challenge();
    res.cookie(this.name('challenge'),challenge,{...this.options(),maxAge:5*60*1000}); return {nonce};
  }
  @Post('auth/google') @HttpCode(200)
  async login(@Req() req: Request, @Res({passthrough:true}) res: Response) {
    this.origin(req); const body=await jsonBody(req);
    if (typeof body.credential!=='string') throw new BadRequestException('Invalid credential');
    const result=await this.auth.login(body.credential,cookie(req,this.name('challenge')));
    res.clearCookie(this.name('challenge'),this.options()); res.cookie(this.name('session'),result.session,{...this.options(),maxAge:30*24*60*60*1000});
    return {user:result.user};
  }
  @Get('me') async me(@Req() req: Request) { return {user:await this.auth.current(cookie(req,this.name('session')))}; }
  @Patch('me') async update(@Req() req: Request) {
    this.origin(req); const session=cookie(req,this.name('session')); if (!session) throw new UnauthorizedException();
    const body=await jsonBody(req);
    if (typeof body.displayName!=='string' || !body.displayName.trim() || Array.from(body.displayName.trim()).length>191) throw new BadRequestException('Invalid display name');
    return {user:await this.auth.update(session,body.displayName.trim())};
  }
  @Delete('me') @HttpCode(200)
  async deleteAccount(@Req() req: Request, @Res({passthrough:true}) res: Response) {
    this.origin(req);
    await this.auth.deleteAccount(cookie(req,this.name('session')));
    res.clearCookie(this.name('session'),this.options());
    return {ok:true};
  }
  @Post('auth/logout') @HttpCode(200)
  async logout(@Req() req: Request, @Res({passthrough:true}) res: Response) {
    this.origin(req); await this.auth.logout(cookie(req,this.name('session'))); res.clearCookie(this.name('session'),this.options()); return {ok:true};
  }
}
