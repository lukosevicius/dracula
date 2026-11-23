import { createHash, createPublicKey, randomBytes, type JsonWebKey, type KeyObject } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import jwt from 'jsonwebtoken';

const googleIssuer = 'https://accounts.google.com';
const signingKeysUrl = 'https://www.googleapis.com/oauth2/v3/certs';
const challengeCookie = '__Host-seeker-challenge';
const sessionCookie = '__Host-seeker-session';
const challengeSeconds = 600;
const sessionSeconds = 8 * 60 * 60;
const randomToken = () => randomBytes(32).toString('base64url');

function readCookie(request: IncomingMessage, name: string) {
  return request.headers.cookie?.split(';').map(value => value.trim()).find(value => value.startsWith(`${name}=`))?.slice(name.length + 1);
}

function cookie(name: string, value: string, seconds: number) {
  return `${name}=${value}; Path=/; Max-Age=${seconds}; HttpOnly; Secure; SameSite=Lax`;
}

export function createGoogleSignIn(origin: string, env: NodeJS.ProcessEnv, request = fetch) {
  const { SEEKER_GOOGLE_CLIENT_ID: clientId, SEEKER_GOOGLE_CLIENT_SECRET: clientSecret, SEEKER_SESSION_SECRET: secret } = env;
  const email = env.SEEKER_GOOGLE_EMAIL?.trim().toLowerCase() ?? '';
  if (!clientId?.endsWith('.apps.googleusercontent.com') || !clientSecret) throw new Error('Set the Seeker Google OAuth client ID and secret.');
  if (!secret || !/^[A-Za-z0-9_-]{43,}$/.test(secret)) throw new Error('Set SEEKER_SESSION_SECRET to a random base64url secret of at least 32 bytes.');
  if (!/^[^\s@,]+@gmail\.com$/.test(email)) throw new Error('Set SEEKER_GOOGLE_EMAIL to a single approved Gmail address.');

  const redirectUri = `${origin}/auth/google/callback`;
  let keys = new Map<string, KeyObject>();
  let keysExpireAt = 0;
  let nextKeyFetchAt = 0;
  let keyFetch: Promise<void> | undefined;

  async function loadKeys() {
    const response = await request(signingKeysUrl, { redirect: 'error', signal: AbortSignal.timeout(5_000) });
    if (!response.ok) throw new Error('Google signing keys are unavailable.');
    const body = await response.json() as { keys?: (JsonWebKey & { kid?: string })[] };
    if (!Array.isArray(body.keys)) throw new Error('Invalid Google signing keys.');
    const updated = new Map<string, KeyObject>();
    for (const key of body.keys) {
      if (key?.kty === 'RSA' && typeof key.kid === 'string') updated.set(key.kid, createPublicKey({ key, format: 'jwk' }));
    }
    if (!updated.size) throw new Error('No Google signing keys.');
    keys = updated;
    keysExpireAt = Date.now() + 10 * 60_000;
  }

  async function verifyIdentity(token: unknown, nonce: string) {
    if (typeof token !== 'string' || token.length > 8192) return false;
    const decoded = jwt.decode(token, { complete: true });
    if (decoded?.header.alg !== 'RS256' || typeof decoded.header.kid !== 'string') return false;
    const keyId = decoded.header.kid;
    const now = Date.now();
    if (now >= keysExpireAt || !keys.has(keyId)) {
      if (!keyFetch && now >= nextKeyFetchAt) {
        nextKeyFetchAt = now + 30_000;
        keyFetch = loadKeys().finally(() => { keyFetch = undefined; });
      }
      await keyFetch;
    }
    const key = Date.now() < keysExpireAt ? keys.get(keyId) : undefined;
    if (!key) return false;
    const payload = jwt.verify(token, key, {
      algorithms: ['RS256'], issuer: [googleIssuer, 'accounts.google.com'], audience: clientId,
    });
    return typeof payload === 'object' && Number.isFinite(payload.exp) && payload.nonce === nonce
      && payload.email_verified === true && typeof payload.email === 'string' && payload.email.toLowerCase() === email
      && (payload.azp === undefined || payload.azp === clientId);
  }

  function readTicket(value: string | undefined, audience: string) {
    if (!value || value.length > 2048) return undefined;
    try {
      const payload = jwt.verify(value, secret, { algorithms: ['HS256'], issuer: origin, audience });
      if (typeof payload === 'object' && Number.isFinite(payload.exp)) return payload;
    } catch { return undefined; }
  }

  return {
    isSignedIn(req: IncomingMessage) {
      return readTicket(readCookie(req, sessionCookie), 'seeker-session')?.sub === email;
    },
    async handle(req: IncomingMessage, res: ServerResponse, url: URL) {
      if (req.method === 'GET' && url.pathname === '/auth/google') {
        const state = randomToken(), nonce = randomToken(), verifier = randomToken();
        const proof = createHash('sha256').update(verifier).digest('base64url');
        const eventId = url.searchParams.get('event');
        const returnTo = eventId && /^[1-9]\d{0,11}$/.test(eventId) ? `/event.html?id=${eventId}` : '/';
        const ticket = jwt.sign({ state, nonce, verifier, returnTo }, secret, { issuer: origin, audience: 'seeker-challenge', expiresIn: challengeSeconds });
        const google = new URL('/o/oauth2/v2/auth', googleIssuer);
        google.search = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope: 'openid email', state, nonce, code_challenge: proof, code_challenge_method: 'S256', prompt: 'select_account' }).toString();
        res.writeHead(303, { location: google.href, 'set-cookie': cookie(challengeCookie, ticket, challengeSeconds) }).end();
        return true;
      }
      if (req.method !== 'GET' || url.pathname !== '/auth/google/callback') return false;
      res.setHeader('Referrer-Policy', 'no-referrer');
      res.setHeader('Set-Cookie', cookie(challengeCookie, '', 0));
      const challenge = readTicket(readCookie(req, challengeCookie), 'seeker-challenge');
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      try {
        if (!code || code.length > 2048 || !state || challenge?.state !== state || typeof challenge.nonce !== 'string' || typeof challenge.verifier !== 'string') {
          throw new Error('Invalid sign-in request.');
        }
        const response = await request('https://oauth2.googleapis.com/token', {
          method: 'POST', redirect: 'error', signal: AbortSignal.timeout(8_000),
          body: new URLSearchParams({ grant_type: 'authorization_code', client_id: clientId, client_secret: clientSecret,
            redirect_uri: redirectUri, code, code_verifier: challenge.verifier }),
        });
        if (!response.ok || !await verifyIdentity((await response.json()).id_token, challenge.nonce)) throw new Error('Sign-in denied.');
        const session = jwt.sign({}, secret, { issuer: origin, subject: email, audience: 'seeker-session', expiresIn: sessionSeconds });
        const destination = typeof challenge.returnTo === 'string' && /^\/event\.html\?id=[1-9]\d{0,11}$/.test(challenge.returnTo) ? challenge.returnTo : '/';
        res.writeHead(303, { location: destination, 'set-cookie': [cookie(challengeCookie, '', 0), cookie(sessionCookie, session, sessionSeconds)] }).end();
      } catch {
        res.writeHead(303, { location: '/?sign-in=denied' }).end();
      }
      return true;
    },
    signOut(res: ServerResponse) {
      res.writeHead(303, { location: '/', 'set-cookie': cookie(sessionCookie, '', 0) }).end();
    },
  };
}
