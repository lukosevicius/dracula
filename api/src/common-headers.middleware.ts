import { Inject, Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { APP_CONFIG, type AppConfig } from './config/config.js';

@Injectable()
export class CommonHeadersMiddleware implements NestMiddleware {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}
  use(req: Request, res: Response, next: NextFunction): void {
    const path = new URL(req.originalUrl, 'http://localhost').pathname;
    const isUserRoute = path === '/v1/me' || path.startsWith('/v1/auth/');
    if (isUserRoute) {
      res.setHeader('Cache-Control', 'no-store');
      res.vary('Origin');
      const origin = req.headers.origin;
      if (origin && this.config.authOrigins?.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
      }
      if (req.method === 'OPTIONS') { res.status(origin && this.config.authOrigins?.includes(origin) ? 204 : 403).end(); return; }
    } else res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  }
}
