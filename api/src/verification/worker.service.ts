import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { DatabaseService } from '../database/database.service.js';
import { createVerificationWorker } from './verification.js';

@Injectable()
export class VerificationWorker implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setTimeout>;
  private active?: Promise<boolean>;
  private stopping = false;

  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onModuleInit() {
    if (!this.config.adminToken || this.config.disableVerificationWorker) return;
    const work = createVerificationWorker(this.db.pool, this.config.aiEncryptionKey);
    const tick = async () => {
      if (this.stopping) return;
      let processed = false;
      try {
        this.active = work();
        processed = await this.active;
      } catch {
        console.error('Seeker verification worker could not process a job.');
      } finally {
        this.active = undefined;
        if (!this.stopping) this.timer = setTimeout(tick, processed ? 300 : 5000).unref();
      }
    };
    this.timer = setTimeout(tick, 5000).unref();
  }

  async onModuleDestroy() {
    this.stopping = true;
    clearTimeout(this.timer);
    await this.active?.catch(() => undefined);
  }
}
