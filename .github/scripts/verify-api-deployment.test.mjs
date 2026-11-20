import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchingBuild, validEvents } from './verify-api-deployment.mjs';

test('selects newest matching release build, not another branch or commit', () => {
  const build = (hash, branch, state, created_at) => ({state, created_at, options:{source_type:'git',source_options:{branch,commit:{hash}}}});
  const old = build('wanted','api-deploy','completed','2026-01-01T00:00:00Z');
  const newer = build('wanted','api-deploy','failed','2026-01-02T00:00:00Z');
  assert.equal(matchingBuild([old,build('wrong','api-deploy','completed','2026-01-04T00:00:00Z'),build('wanted','main','completed','2026-01-03T00:00:00Z'),newer], 'wanted'), newer);
  assert.equal(matchingBuild([old], 'other'), undefined);
});
test('accepts empty event pages and rejects invalid pagination or totals', () => {
  assert.equal(validEvents({items:[],total:0,nextOffset:null}), true);
  assert.equal(validEvents({items:[],total:1,nextOffset:1}), true);
  for (const page of [null, {}, {items:[],total:-1,nextOffset:null}, {items:[],total:1,nextOffset:0}, {items:[],total:1}, {items:'bad',total:1,nextOffset:null}]) assert.equal(validEvents(page), false);
});
