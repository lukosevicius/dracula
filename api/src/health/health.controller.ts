import { Controller, Get, Header } from '@nestjs/common';
import { readFileSync } from 'node:fs';

@Controller()
export class HealthController {
  @Get('health')
  @Header('Cache-Control', 'no-store')
  health(): { status: string } { return { status: 'ok' }; }

  @Get('version')
  @Header('Cache-Control', 'no-store')
  version(): { fingerprint: string } {
    return JSON.parse(readFileSync(new URL('../release.json', import.meta.url), 'utf8')) as { fingerprint: string };
  }
}
