import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCentralApi } from './central-api.js';
import { createCentralDashboard } from './central-dashboard.js';
import type { createGoogleSignIn } from './google-sign-in.js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const clientDir = join(root, 'client', 'dist');
const dashboardPages = new Set(['/', '/artists.html', '/vilnius-events.html', '/avilys.html', '/ai-evaluation.html', '/saved-events.html', '/settings.html']);
const installAssets = new Set(['/manifest.webmanifest', '/icons/icon-180.png', '/icons/icon-192.png', '/icons/icon-512.png']);
const types: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
};

type HostedAccess = { origin: string; signIn: ReturnType<typeof createGoogleSignIn>; releaseSha?: string };

const signInPage = (denied: boolean) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#100f15"><link rel="manifest" href="/manifest.webmanifest">
<link rel="apple-touch-icon" href="/icons/icon-180.png"><link rel="icon" type="image/png" href="/icons/icon-192.png">
<title>Sign in to Seeker</title><style>
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#100f15;color:#faf8ff;font:16px system-ui}
main{max-width:28rem;padding:2rem} a{display:inline-block;padding:.75rem 1rem;border-radius:.5rem;background:#faf8ff;color:#100f15;font-weight:600}
</style></head><body><main><h1>Seeker</h1>${denied ? '<p>Sign-in failed. Try again with the approved Google account.</p>' : ''}
<a href="/auth/google">Sign in with Google</a></main></body></html>`;

export function createSeekerServer(handle: ReturnType<typeof createCentralDashboard>, port: number, hosted?: HostedAccess) {
  const hosts = hosted ? [new URL(hosted.origin).host] : [`127.0.0.1:${port}`, `localhost:${port}`];
  const origins = new Set(hosted ? [hosted.origin] : [
    ...hosts.map(host => `http://${host}`), process.env.SEEKER_DEV_ORIGIN,
  ]);

  return createServer(async (req, res) => {
    if (hosted) {
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('X-Frame-Options', 'DENY');
      res.setHeader('X-Robots-Tag', 'noindex');
      res.setHeader('Referrer-Policy', 'same-origin');
    }
    const reject = (status: number, message: string) => {
      res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(message);
    };
    if (!hosts.includes(req.headers.host ?? '')) return reject(403, 'Forbidden');
    if (hosted?.releaseSha) res.setHeader('X-Seeker-Release', hosted.releaseSha);
    const origin = req.headers.origin;
    const isWrite = req.method !== 'GET' && req.method !== 'HEAD';
    if ((origin && !origins.has(origin)) || (hosted && isWrite && origin !== hosted.origin)) {
      return reject(403, 'Forbidden');
    }
    const url = URL.parse(req.url || '/', 'http://localhost');
    if (!url || url.origin !== 'http://localhost') return reject(400, 'Invalid request URL');
    const isInstallAsset = (req.method === 'GET' || req.method === 'HEAD') && installAssets.has(url.pathname);
    if (hosted && !isInstallAsset) {
      if (await hosted.signIn.handle(req, res, url)) return;
      if (!hosted.signIn.isSignedIn(req)) {
        if (req.method === 'GET' && dashboardPages.has(url.pathname)) {
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
          return res.end(signInPage(url.searchParams.get('sign-in') === 'denied'));
        }
        res.writeHead(401, { 'content-type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ error: 'Sign in to Seeker. Reload this page to continue.' }));
      }
      if (req.method === 'POST' && url.pathname === '/auth/logout') return hosted.signIn.signOut(res);
    }
    if (await handle(req, res)) return;
    if (req.method !== 'GET' && !isInstallAsset) return reject(405, 'Method not allowed');
    let pathname: string;
    try { pathname = decodeURIComponent(url.pathname); }
    catch { return reject(400, 'Invalid path'); }
    const file = normalize(join(clientDir, dashboardPages.has(pathname) ? 'index.html' : pathname));
    if (!file.startsWith(`${clientDir}/`)) return reject(403, 'Forbidden');
    try {
      const data = await readFile(file);
      res.writeHead(200, {
        'content-type': types[extname(file)] || 'application/octet-stream',
        'cache-control': hosted ? 'private, no-store' : 'no-cache', 'x-content-type-options': 'nosniff',
      });
      if (req.method === 'HEAD') return res.end();
      res.end(hosted && dashboardPages.has(pathname) ? data.toString('utf8').replace('<body>', '<body data-hosted>') : data);
    } catch { reject(404, 'Not found'); }
  });
}

export function startSeeker(hosted?: HostedAccess) {
  const { CENTRAL_API_URL, CENTRAL_API_TOKEN, PORT } = process.env;
  if (!CENTRAL_API_URL || !CENTRAL_API_TOKEN) throw new Error('Set CENTRAL_API_URL and CENTRAL_API_TOKEN.');
  const port = Number(PORT || 4177);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT.');
  const api = createCentralApi(CENTRAL_API_URL, CENTRAL_API_TOKEN);
  const handle = createCentralDashboard(api, undefined, { allowJobs: !hosted });
  const server = createSeekerServer(handle, port, hosted);
  server.listen(port, hosted ? '0.0.0.0' : '127.0.0.1', () => {
    console.log(`Seeker at ${hosted?.origin ?? `http://127.0.0.1:${port}`}`);
  });
}
