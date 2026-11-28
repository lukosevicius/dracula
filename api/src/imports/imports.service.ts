import { Inject, Injectable } from '@nestjs/common';
import { importVilniusPage } from './vilnius.js';
import { importAvilysPage } from './avilys.js';
import { importKakavaPage } from './kakava.js';
import { importMusicBrainzPage, reserveMusicBrainz } from './musicbrainz.js';
import { saveImage, saveSourceImage, type ImageSourceKey } from './images.js';
import { enrichEvent } from './enrich.js';
import { createJobs } from '../jobs/jobs.js';
import { createAi } from '../admin/ai.js';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { DatabaseService } from '../database/database.service.js';

type Input = Record<string, unknown>;
type Result = Record<string, unknown>;
interface Jobs { list(): Promise<unknown>; start(action: unknown, source: unknown, limit: unknown, request?: unknown): Promise<Result>; update(id: number, input: Input): Promise<void> }

/** Import, image, enrichment, AI and job operations used by the NestJS API. */
@Injectable()
export class ImportsService {
  readonly jobs: Jobs;
  readonly ai: ReturnType<typeof createAi>;
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService, @Inject(APP_CONFIG) private readonly config: AppConfig) {
    this.jobs = createJobs(db.pool);
    this.ai = createAi(db.pool);
  }
  vilnius(input: Input): Promise<Result> { return importVilniusPage(this.db.pool,input); }
  avilys(input: Input): Promise<Result> { return importAvilysPage(this.db.pool,input); }
  kakava(input: Input): Promise<Result> { return importKakavaPage(this.db.pool,input); }
  musicbrainz(input: Input): Promise<Result> { return importMusicBrainzPage(this.db.pool,input); }
  reserveMusicBrainz(): Promise<Result> { return reserveMusicBrainz(this.db.pool); }
  saveImage(input: Input): Promise<Result> { return saveImage(this.db.pool,this.config.imageDir,input); }
  saveSourceImage(key: ImageSourceKey, input: Input): Promise<Result> { return saveSourceImage(this.db.pool,this.config.imageDir,input,key); }
  enrich(id: number,input: Input): Promise<void> { return enrichEvent(this.db.pool,id,input); }
}
