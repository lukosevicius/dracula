export interface AppConfig {
  dbHost: string;
  dbPort: number;
  dbUser: string;
  dbPassword: string;
  dbName: string;
  publicBaseUrl: string;
  imageDir: string;
  port: number;
  adminToken?: string;
}

function port(value: string | undefined, fallback: number, name: string): number {
  const result = value === undefined || value === '' ? fallback : Number(value);
  if (!Number.isInteger(result) || result < 1 || result > 65535) throw new Error(`Invalid ${name}.`);
  return result;
}

export function loadConfig(env: NodeJS.ProcessEnv): AppConfig {
  const required = ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME', 'PUBLIC_BASE_URL', 'IMAGE_DIR'] as const;
  for (const name of required) if (!env[name]) throw new Error(`Missing ${name}`);
  let base: URL;
  try { base = new URL(env.PUBLIC_BASE_URL!); } catch { throw new Error('PUBLIC_BASE_URL must be an HTTP(S) origin'); }
  if (!['https:', 'http:'].includes(base.protocol) || base.pathname !== '/' || base.search || base.hash || base.username || base.password) {
    throw new Error('PUBLIC_BASE_URL must be an HTTP(S) origin');
  }
  if (env.ADMIN_TOKEN && base.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)) {
    throw new Error('Admin access requires HTTPS outside local development.');
  }
  return {
    dbHost: env.DB_HOST!, dbPort: port(env.DB_PORT, 3306, 'DB_PORT'),
    dbUser: env.DB_USER!, dbPassword: env.DB_PASSWORD!, dbName: env.DB_NAME!,
    publicBaseUrl: base.origin, imageDir: env.IMAGE_DIR!, port: port(env.PORT, 3000, 'PORT'),
    adminToken: env.ADMIN_TOKEN || undefined,
  };
}

export const APP_CONFIG = Symbol('APP_CONFIG');
