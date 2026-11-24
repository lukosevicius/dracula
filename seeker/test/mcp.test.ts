import test from 'node:test';
import assert from 'node:assert/strict';

test('MCP discovers Seeker tools and forwards a validated, idempotent verification request', async () => {
  const script = new URL('../../scripts/mcp.mjs', import.meta.url).href;
  const { createMcp } = await import(script);
  const credential = 'ska_' + 't'.repeat(43);
  let calls = 0;
  const handle = createMcp('https://api.example.test', credential, async (url: URL, init: RequestInit) => {
    calls++;
    assert.equal(url.pathname, '/v1/seeker/verification/jobs');
    assert.equal(new Headers(init.headers).get('authorization'), `Bearer ${credential}`);
    assert.deepEqual(JSON.parse(String(init.body)), { request_key: 'job-42', event_ids: [42], allow_publish: false });
    return Response.json({ ok: true, id: 8 }, { status: 202 });
  });
  const call = (method: string, params = {}) => handle({ jsonrpc: '2.0', id: 1, method, params });
  const tools = await call('tools/list');
  assert.ok(tools.result.tools.some((tool: {name: string}) => tool.name === 'set_event_publication'));
  const invalid = await call('tools/call', { name: 'verify_events', arguments: { event_ids: [42] } });
  assert.equal(invalid.error.code, -32602);
  const run = await call('tools/call', { name: 'verify_events', arguments: { event_ids: [42], request_key: 'job-42', allow_publish: false } });
  assert.deepEqual(JSON.parse(run.result.content[0].text), { ok: true, id: 8 });
  assert.equal(calls, 1);
});
