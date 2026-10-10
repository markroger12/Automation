import crypto from 'node:crypto';
import { getInternal, setInternal } from './settings';

/** Connection keys look like bas_<random>. Only the SHA-256 hash is stored; a new key switches off old installs. */
export function hashKey(key: string): string {
  return crypto.createHash('sha256').update(key, 'utf8').digest('hex');
}

export async function createConnectionKey(): Promise<string> {
  const key = `bas_${crypto.randomBytes(24).toString('base64url')}`;
  await setInternal('extensionKeyHash', hashKey(key));
  await setInternal('extensionKeyCreatedAt', new Date().toISOString());
  return key;
}

let cache: { hash: string | null; at: number } | null = null;

export async function verifyConnectionKey(authorization: string | null): Promise<boolean> {
  const m = /^Bearer\s+(bas_[A-Za-z0-9_-]{10,})$/.exec(authorization ?? '');
  if (!m) return false;
  if (!cache || Date.now() - cache.at > 5_000) {
    cache = { hash: await getInternal<string | null>('extensionKeyHash', null), at: Date.now() };
  }
  if (!cache.hash) return false;
  const given = Buffer.from(hashKey(m[1]!), 'hex');
  const stored = Buffer.from(cache.hash, 'hex');
  return given.length === stored.length && crypto.timingSafeEqual(given, stored);
}

export function clearKeyCache(): void {
  cache = null;
}
