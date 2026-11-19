import { apiUrl } from '../utils/events-api';

export type UserProfile = { id: number; displayName: string; profileImageUrl: string | null };
export class AuthError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${apiUrl}${path}`, { ...init, credentials: 'include', cache: 'no-store' });
  if (!response.ok) throw new AuthError(response.status, `Authentication request failed (${response.status})`);
  return response.json() as Promise<T>;
}
export const getProfile = () => request<{ user: UserProfile }>('/v1/me');
export const getChallenge = () => request<{ nonce: string }>('/v1/auth/challenge', { method: 'POST' });
export const googleLogin = (credential: string) => request<{ user: UserProfile }>('/v1/auth/google', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ credential }),
});
export const updateProfile = (displayName: string) => request<{ user: UserProfile }>('/v1/me', {
  method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ displayName }),
});
export const logout = () => request<{ ok: boolean }>('/v1/auth/logout', { method: 'POST' });
