import { Inject, Injectable, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import mysql, { type Pool } from 'mysql2/promise';
import { APP_CONFIG, type AppConfig } from '../config/config.js';

@Injectable()
export class DatabaseService implements OnModuleInit, OnApplicationShutdown {
  readonly pool: Pool;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.pool = mysql.createPool({
      host: config.dbHost, port: config.dbPort, user: config.dbUser,
      password: config.dbPassword, database: config.dbName, connectionLimit: 5, charset: 'utf8mb4',
    });
  }

  async onModuleInit(): Promise<void> {
    try { await this.pool.query('SELECT 1'); }
    catch (error) { await this.pool.end(); throw error; }
  }

  async onApplicationShutdown(): Promise<void> { await this.pool.end(); }
}
