import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Test } from '@nestjs/testing';
import { AppModule } from '../dist/app.module.js';
import { APP_CONFIG, loadConfig } from '../dist/config/config.js';
import { DatabaseService } from '../dist/database/database.service.js';

const env = { DB_HOST: '127.0.0.1', DB_USER: 'test', DB_PASSWORD: 'test', DB_NAME: 'test', PUBLIC_BASE_URL: 'http://localhost:3000', IMAGE_DIR: '/tmp/images' };

test('configuration validates required values, ports, origins and admin transport', () => {
  assert.equal(loadConfig(env).dbPort, 3306);
  assert.equal(loadConfig(env).port, 3000);
  assert.throws(() => loadConfig({ ...env, DB_USER: '' }), /Missing DB_USER/);
  assert.throws(() => loadConfig({ ...env, DB_PORT: '99999' }), /Invalid DB_PORT/);
  assert.throws(() => loadConfig({ ...env, PORT: 'abc' }), /Invalid PORT/);
  assert.throws(() => loadConfig({ ...env, PUBLIC_BASE_URL: 'https://example.org/path' }), /origin/);
  assert.throws(() => loadConfig({ ...env, PUBLIC_BASE_URL: 'http://example.org', ADMIN_TOKEN: 'token' }), /HTTPS/);
  assert.equal(loadConfig({ ...env, ADMIN_TOKEN: 'token' }).adminToken, 'token');
});

test('Nest app serves the health endpoint and shuts down its database provider', async () => {
  let stopped = false;
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(APP_CONFIG).useValue(loadConfig(env))
    .overrideProvider(DatabaseService).useValue({ onApplicationShutdown() { stopped = true; } })
    .compile();
  const app = module.createNestApplication({ logger: false });
  try {
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address();
    const response = await fetch(`http://127.0.0.1:${address.port}/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 'ok' });
  } finally { await app.close(); }
  assert.equal(stopped, true);
});
