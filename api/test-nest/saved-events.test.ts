import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AuthController } from '../dist/auth/auth.controller.js';

test('saved events require a session, isolate users, and validate write origins and ids', async () => {
  const calls: { sql: string; params: unknown[] }[] = [];
  const auth = { current: async (session: string) => { if (session !== 'valid') throw new Error('unauthorized'); return {id: 7}; } };
  const db = {pool:{execute: async (sql: string, params: unknown[]) => { calls.push({sql,params}); return [[]]; }}};
  const catalogue = {saved: async (id: number) => [{id}]};
  const config = {publicBaseUrl:'https://api.example.com',authOrigins:['https://app.example.com']};
  const controller = new AuthController(auth as never, config as never, db as never, catalogue as never);
  const request = (body: unknown, origin = 'https://app.example.com', cookie = '__Host-dracula_session=valid') => ({
    headers:{origin,cookie,'content-type':'application/json'},
    async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify(body)); },
  });
  assert.deepEqual(await controller.saved(request(null) as never),{events:[{id:7}]});
  await assert.rejects(() => controller.saved(request(null,undefined,'') as never));
  await assert.rejects(() => controller.saveEvents(request({ids:[1]},'https://evil.example') as never));
  await assert.rejects(() => controller.saveEvents(request({ids:[-1]}) as never));
  await controller.saveEvents(request({ids:[1,2,1]}) as never);
  assert.deepEqual(calls[0].params,[7,1,2]);
  const deleteRequest = {...request(null),params:{id:'2'}};
  await controller.unsaveEvent(deleteRequest as never);
  assert.deepEqual(calls[1].params,[7,2]);
  await assert.rejects(() => controller.unsaveEvent({...deleteRequest,params:{id:'0'}} as never));
});
