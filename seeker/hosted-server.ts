import { createGoogleSignIn } from './google-sign-in.js';
import { startSeeker } from './seeker-server.js';

const origin = process.env.SEEKER_PUBLIC_ORIGIN ?? '';
const url = URL.parse(origin);
if (!url || url.protocol !== 'https:' || origin !== url.origin) {
  throw new Error('Set SEEKER_PUBLIC_ORIGIN to the HTTPS Seeker origin, without a trailing slash.');
}

startSeeker({ origin, signIn: createGoogleSignIn(origin, process.env) });
