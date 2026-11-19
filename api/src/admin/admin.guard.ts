import { CanActivate, ExecutionContext, HttpException, Inject, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { AdminService } from './admin.service.js';

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(@Inject(AdminService) private readonly admin: AdminService) {}
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    context.switchToHttp().getResponse().setHeader('Cache-Control', 'no-store');
    if (!this.admin.backend) throw new HttpException({error:'Not found'}, 404);
    if (!this.admin.backend.authorized(request.headers.authorization)) throw new HttpException({error:'Unauthorized'}, 401);
    return true;
  }
}
