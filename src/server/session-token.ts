import { SignJWT, jwtVerify } from 'jose';

/** Cookie and token helpers that are safe to use from middleware (no database access). */
export const SESSION_COOKIE = 'bas_session';
export const CSRF_COOKIE = 'bas_csrf';
export const CSRF_HEADER = 'x-csrf-token';
export const SESSION_DAYS = 30;

export type SessionClaims = { sub: string; email: string; role: 'ADMIN' | 'EDITOR' };

function secretKey(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error('SESSION_SECRET is missing or too short. Run `npm run setup` to create .env.');
  }
  return new TextEncoder().encode(secret);
}

export async function signSession(claims: SessionClaims): Promise<string> {
  return new SignJWT({ email: claims.email, role: claims.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(secretKey());
}

export async function verifySession(token: string | undefined | null): Promise<SessionClaims | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: ['HS256'] });
    if (typeof payload.sub !== 'string') return null;
    const role = payload.role === 'ADMIN' ? 'ADMIN' : 'EDITOR';
    return { sub: payload.sub, email: String(payload.email ?? ''), role };
  } catch {
    return null;
  }
}

export function randomToken(bytes = 24): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  let s = '';
  for (const b of arr) s += b.toString(16).padStart(2, '0');
  return s;
}

/** Constant-time string comparison. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
