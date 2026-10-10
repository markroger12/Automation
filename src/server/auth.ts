import bcrypt from 'bcryptjs';
import { cookies } from 'next/headers';
import type { User } from '@prisma/client';
import { prisma } from './db';
import { SESSION_COOKIE, SESSION_DAYS, signSession, verifySession } from './session-token';

export type SessionUser = Pick<User, 'id' | 'email' | 'name' | 'role'>;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  try {
    return await bcrypt.compare(password, hash);
  } catch {
    return false;
  }
}

/** The signed-in user, or null. Reads the HTTP-only session cookie. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const claims = await verifySession(store.get(SESSION_COOKIE)?.value);
  if (!claims) return null;
  return prisma.user.findUnique({ where: { id: claims.sub }, select: { id: true, email: true, name: true, role: true } });
}

export async function startSession(user: SessionUser, secure: boolean): Promise<void> {
  const token = await signSession({ sub: user.id, email: user.email, role: user.role });
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
    maxAge: SESSION_DAYS * 86_400,
  });
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
}

export async function endSession(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

export async function userCount(): Promise<number> {
  return prisma.user.count();
}
