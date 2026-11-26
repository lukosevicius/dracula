import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { AddressInfo } from 'node:net';
import { AppModule } from '../dist/app.module.js';
import { CatalogueService } from '../dist/catalogue/catalogue.service.js';
import { APP_CONFIG } from '../dist/config/config.js';
import { DatabaseService } from '../dist/database/database.service.js';
import { AdminService } from '../dist/admin/admin.service.js';

export function createCatalogue(pool: unknown, publicBaseUrl: string) {
  return new CatalogueService({pool} as unknown as DatabaseService,{publicBaseUrl} as import('../dist/config/config.js').AppConfig);
}

// A node:http-shaped adapter used by the existing isolated HTTP tests.
export function createApp(catalogue: Partial<Pick<CatalogueService, 'list' | 'page' | 'get' | 'hasImage'>>, imageDir: string, backend: unknown = null) {
  let app: INestApplication;
  return {
    listen(port: number,host: string,callback: () => void) {
      (async () => {
        const config={dbHost:'127.0.0.1',dbPort:3306,dbUser:'test',dbPassword:'test',dbName:'test',publicBaseUrl:'http://localhost',imageDir,port:3000};
        const module=await Test.createTestingModule({imports:[AppModule]})
          .overrideProvider(APP_CONFIG).useValue(config)
          .overrideProvider(DatabaseService).useValue({pool:{}})
          .overrideProvider(CatalogueService).useValue(catalogue)
          .overrideProvider(AdminService).useValue({backend}).compile();
        app=module.createNestApplication({logger:false,bodyParser:false});
        await app.listen(port,host);callback();
      })().catch(error=>{throw error;});
    },
    address() { return app.getHttpServer().address() as AddressInfo; },
    close(callback: (error?: Error) => void) { app.close().then(()=>callback(),callback); },
  };
}

/** Adds migrations 018–020 (merges, end time, showtimes) to an SQLite fixture after its own tables and rows exist. */
export function addMergeTables(db: { exec(sql: string): void }) {
  try { db.exec('ALTER TABLE event_sources ADD COLUMN is_secondary INTEGER NOT NULL DEFAULT 0'); } catch { /* Fixture has no source table. */ }
  try { db.exec('ALTER TABLE events ADD COLUMN event_end_time TEXT'); } catch { /* Fixture has no events table, or already has the column. */ }
  db.exec('CREATE TABLE IF NOT EXISTS removed_listings(source_key TEXT NOT NULL,source_id TEXT NOT NULL,removed_at TEXT NOT NULL,PRIMARY KEY(source_key,source_id))');
  db.exec('CREATE TABLE IF NOT EXISTS event_times(id INTEGER PRIMARY KEY,event_id INTEGER NOT NULL,event_date TEXT NOT NULL,event_time TEXT,event_end_time TEXT)');
  db.exec(`CREATE TABLE IF NOT EXISTS event_redirects(old_event_id INTEGER PRIMARY KEY,event_id INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS event_duplicate_dismissals(first_event_id INTEGER,second_event_id INTEGER,PRIMARY KEY(first_event_id,second_event_id))`);
}
