import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import test from 'node:test';
import jwt from 'jsonwebtoken';
import { createCentralDashboard } from '../central-dashboard.js';
import { createGoogleSignIn } from '../google-sign-in.js';
import { createSeekerServer } from '../seeker-server.js';

const origin = 'https://seeker.example.com';
const email = 'admin@gmail.com';
const clientId = 'example.apps.googleusercontent.com';
const sessionSecret = randomBytes(32).toString('base64url');
const signingKey = generateKeyPairSync('rsa', { modulusLength: 2048 });
const publicKey = { ...signingKey.publicKey.export({ format: 'jwk' }), kid: 'google-test-key' };

test('hosted sign-in requires the approved Google identity and protects dashboard and API access', async () => {
  let claims: Record<string, unknown> = {};
  let expectedProof: string;
  let exchanges = 0;
  let dashboardRequests = 0;
  const provider: typeof fetch = async (input, options) => {
    if (input === 'https://www.googleapis.com/oauth2/v3/certs') return Response.json({ keys: [publicKey] });
    assert.equal(input, 'https://oauth2.googleapis.com/token');
    const body = options?.body as URLSearchParams;
    assert.equal(body.get('redirect_uri'), `${origin}/auth/google/callback`);
    assert.equal(createHash('sha256').update(body.get('code_verifier')!).digest('base64url'), expectedProof);
    exchanges++;
    return Response.json({ id_token: jwt.sign(claims, signingKey.privateKey, { algorithm: 'RS256', keyid: publicKey.kid, expiresIn: 600 }) });
  };
  const signIn = createGoogleSignIn(origin, {
    SEEKER_GOOGLE_CLIENT_ID: clientId, SEEKER_GOOGLE_CLIENT_SECRET: 'test-secret',
    SEEKER_GOOGLE_EMAIL: email, SEEKER_SESSION_SECRET: sessionSecret,
  }, provider);
  const handler: ReturnType<typeof createCentralDashboard> = async (req, res) => {
    if (!req.url?.startsWith('/api/')) return false;
    dashboardRequests++;
    res.writeHead(204).end();
    return true;
  };
  const server = createSeekerServer(handler, 4177, { origin, signIn });
  const respond = server.listeners('request')[0];

  async function send(path: string, method = 'GET', headers: IncomingMessage['headers'] = {}) {
    let status = 0;
    let body = '';
    const responseHeaders = new Map<string, string | string[]>();
    const response = {
      setHeader(name: string, value: string) { responseHeaders.set(name.toLowerCase(), value); return this; },
      writeHead(code: number, values: Record<string, string | string[]> = {}) {
        status = code;
        for (const [name, value] of Object.entries(values)) responseHeaders.set(name.toLowerCase(), value);
        return this;
      },
      end(value = '') { body = String(value); return this; },
    } as unknown as ServerResponse;
    await respond({ method, url: path, headers: { host: new URL(origin).host, ...headers } }, response);
    return { status, body, headers: responseHeaders };
  }

  const login = await send('/');
  assert.match(login.body, /Sign in with Google/);
  assert.match(login.body, /rel="manifest" href="\/manifest\.webmanifest"/);
  assert.equal(login.headers.get('cache-control'), 'private, no-store');
  const manifest = await send('/manifest.webmanifest');
  assert.equal(manifest.status, 200);
  assert.equal(manifest.headers.get('content-type'), 'application/manifest+json');
  assert.equal(JSON.parse(manifest.body).display, 'standalone');
  for (const size of [180, 192, 512]) {
    const icon = await send(`/icons/icon-${size}.png`, 'HEAD');
    assert.equal(icon.status, 200);
    assert.equal(icon.headers.get('content-type'), 'image/png');
    assert.equal(icon.body, '');
  }
  assert.equal((await send('/icons/other.png')).status, 401);
  assert.equal((await send('/manifest.webmanifest', 'POST', { origin })).status, 401);
  assert.equal((await send('/api/events')).status, 401);
  const artistPath = '/artist.html?id=12345678-1234-1234-1234-123456789abc';
  assert.match((await send(artistPath)).body, /Sign in with Google/);
  assert.match((await send('/event.html?id=172')).body, /href="\/auth\/google\?event=172"/);
  assert.doesNotMatch((await send('/event.html?id=1%22bad')).body, /event=/);
  assert.equal((await send('/api/artists/12345678-1234-1234-1234-123456789abc')).status, 401);
  assert.equal((await send('/assets/index.js')).status, 401);
  assert.equal((await send('//')).status, 400);
  assert.equal((await send('/', 'GET', { host: 'temporary.hostingersite.com' })).status, 403);
  assert.equal(dashboardRequests, 0);

  async function attempt(overrides: Record<string, unknown> = {}, invalidState = false, path = '/auth/google') {
    const start = await send(path);
    const redirect = new URL(String(start.headers.get('location')));
    assert.equal(redirect.host, 'accounts.google.com');
    expectedProof = redirect.searchParams.get('code_challenge')!;
    claims = { iss: 'https://accounts.google.com', aud: clientId, email, email_verified: true, sub: 'google-user', nonce: redirect.searchParams.get('nonce'), ...overrides };
    const state = invalidState ? 'wrong' : redirect.searchParams.get('state');
    return send(`/auth/google/callback?code=one-time-code&state=${state}`, 'GET', { cookie: String(start.headers.get('set-cookie')).split(';')[0] });
  }

  assert.equal((await attempt({}, true)).headers.get('location'), '/?sign-in=denied');
  assert.equal(exchanges, 0);
  for (const invalid of [{ email: 'another@gmail.com' }, { email_verified: false }, { nonce: 'another' }, { aud: 'another-client' }]) {
    assert.equal((await attempt(invalid)).headers.get('location'), '/?sign-in=denied');
  }
  const callback = await attempt();
  assert.equal(callback.headers.get('location'), '/');
  assert.equal((await attempt({}, false, '/auth/google?event=172')).headers.get('location'), '/event.html?id=172');
  assert.equal((await attempt({}, false, '/auth/google?event=1%2f%2fevil')).headers.get('location'), '/');
  assert.equal(callback.headers.get('referrer-policy'), 'no-referrer');
  const session = callback.headers.get('set-cookie')![1];
  assert.match(session, /HttpOnly; Secure; SameSite=Lax/);
  const cookie = session.split(';')[0];
  const dashboard = await send('/', 'GET', { cookie });
  assert.match(dashboard.body, /data-hosted/);
  assert.match(dashboard.body, /rel="manifest" href="\/manifest\.webmanifest"/);
  assert.equal(dashboard.headers.get('referrer-policy'), 'same-origin');
  assert.doesNotMatch(dashboard.body, /Sign in with Google/);
  assert.match((await send(artistPath, 'GET', { cookie })).body, /data-hosted/);
  assert.equal((await send('/api/events', 'GET', { cookie })).status, 204);
  assert.equal((await send('/api/events/1/review', 'POST', { cookie, origin: 'https://app.example.com' })).status, 403);
  assert.equal((await send('/api/events/1/review', 'POST', { cookie })).status, 403);
  assert.equal((await send('/api/events/1/review', 'POST', { cookie, origin })).status, 204);
  assert.equal((await send('/api/events', 'GET', { cookie: `${cookie}tampered` })).status, 401);
  assert.equal((await send('/auth/logout', 'POST', { cookie, origin })).status, 303);
});

test('local dashboard continues accepting the Vite development origin without login', async () => {
  const key = 'SEEKER_DEV_ORIGIN';
  const before = process.env[key];
  process.env[key] = 'http://127.0.0.1:4177';
  try {
    let reached = false;
    const server = createSeekerServer(async () => { reached = true; return true; }, 4178);
    await server.listeners('request')[0]({ method: 'POST', headers: { host: '127.0.0.1:4178', origin: process.env[key] } }, {});
    assert.equal(reached, true);
  } finally {
    if (before === undefined) delete process.env[key];
    else process.env[key] = before;
  }
});
