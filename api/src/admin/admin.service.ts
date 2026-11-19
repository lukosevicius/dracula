import { Inject, Injectable } from '@nestjs/common';
import { createAdmin } from './admin.js';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { DatabaseService } from '../database/database.service.js';

// Application service for Seeker operations and token validation.
@Injectable()
export class AdminService {
  readonly backend: ReturnType<typeof createAdmin> | null;
  constructor(@Inject(DatabaseService) db: DatabaseService, @Inject(APP_CONFIG) config: AppConfig) {
    this.backend = config.adminToken ? createAdmin(db.pool, config.adminToken) : null;
  }
}
