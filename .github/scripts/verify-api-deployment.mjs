import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

export function matchingBuild(builds, sha) {
  return builds.filter(b => b.options?.source_type === 'git' && b.options?.source_options?.branch === 'api-deploy' && b.options?.source_options?.commit?.hash === sha)
    .sort((a,b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
}
export function validEvents(page) {
  return Array.isArray(page?.items) && Number.isSafeInteger(page.total) && page.total >= 0 && (page.nextOffset === null || (Number.isSafeInteger(page.nextOffset) && page.nextOffset > 0));
}

async function main() {
const { HOSTINGER_API_TOKEN: token, HOSTINGER_SSH_USER: username, RELEASE_SHA: sha, EXPECTED_FINGERPRINT: fingerprint } = process.env;
if (!token || !/^[a-zA-Z0-9_-]+$/.test(username || '') || !/^[a-f0-9]{40}$/.test(sha || '') || !/^[a-f0-9]{64}$/.test(fingerprint || '')) throw Error('Missing or invalid deployment verification configuration');
const buildsUrl = `https://developers.hostinger.com/api/hosting/v1/accounts/${username}/websites/api.dracula.lt/nodejs/builds?per_page=100`;
const deadline = Date.now() + 15 * 60_000;
let last = '';
while (Date.now() < deadline) {
  try {
    const response = await fetch(buildsUrl, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
    if ([401,403].includes(response.status)) throw Error(`Hostinger authentication failed (${response.status})`);
    if (!response.ok) throw Error(`Hostinger builds request returned ${response.status}`);
    const body = await response.json();
    if (!Array.isArray(body.data)) throw Error('Invalid Hostinger builds response');
    const build = matchingBuild(body.data, sha);
    if (!build) throw Error('Waiting for Hostinger to register the expected commit');
    if (build.state === 'failed') throw Error('Hostinger build failed');
    if (build.state !== 'completed') throw Error(`Hostinger build state: ${build.state}`);
    const version = await fetch('https://api.dracula.lt/version', { cache:'no-store', signal:AbortSignal.timeout(15000) });
    if (!version.ok || (await version.json()).fingerprint !== fingerprint) throw Error('Waiting for expected API code to serve traffic');
    const events = await fetch('https://api.dracula.lt/v1/events?filter=upcoming&limit=1&offset=0', { cache:'no-store', signal:AbortSignal.timeout(15000) });
    if (!events.ok) throw Error(`Live events returned ${events.status}`);
    const page = await events.json();
    if (!validEvents(page)) throw Error('Invalid live events response');
    console.log(`Hostinger build ${build.uuid} completed for ${sha}; live fingerprint and events verified.`);
    process.exit(0);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown verification error';
    if (message !== last) console.log(message);
    last = message;
    if (/authentication failed|Hostinger build failed/.test(message)) throw error;
    await delay(10000);
  }
}
throw Error(`Deployment verification timed out: ${last}`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { console.error(error.message); process.exitCode = 1; });
