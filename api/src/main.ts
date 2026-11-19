import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { APP_CONFIG, type AppConfig } from './config/config.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  app.enableShutdownHooks();
  const config = app.get<AppConfig>(APP_CONFIG);
  await app.listen(config.port, '0.0.0.0');
}

bootstrap().catch((error: unknown) => {
  console.error('Failed to start NestJS API:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
