import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';

const [origin, expectedSha] = process.argv.slice(2);
assert.match(expectedSha, /^[0-9a-f]{40}$/);

async function request(path, status) {
  const url = new URL(path, origin);
  url.searchParams.set('release_check', expectedSha);
  const response = await fetch(url, {
    headers: { 'cache-control': 'no-cache' },
    redirect: 'manual',
    signal: AbortSignal.timeout(10_000),
  });
  assert.equal(response.status, status, `${path}: expected HTTP ${status}, got ${response.status}`);
  assert.equal(response.headers.get('x-seeker-release'), expectedSha, `${path}: expected release ${expectedSha}`);
  return response;
}

async function verify() {
  for (const path of ['/', '/vilnius-events.html']) {
    const response = await request(path, 200);
    assert.match(await response.text(), /href="\/auth\/google"/, `${path}: missing Google sign-in`);
  }
  for (const path of ['/api/dashboard', '/api/events']) {
    const response = await request(path, 401);
    await response.body?.cancel();
  }
  const manifest = await request('/manifest.webmanifest', 200);
  assert.equal((await manifest.json()).name, 'Seeker');
}

for (let attempt = 1; ; attempt++) {
  try {
    await verify();
    console.log(`Verified Seeker release ${expectedSha}, Google sign-in and the PWA manifest.`);
    break;
  } catch (error) {
    if (attempt === 12) throw error;
    await delay(5000);
  }
}
