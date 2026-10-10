import { z } from 'zod';
import { ApiError, readJson, route } from '@/server/api';
import { hashPassword, startSession, userCount } from '@/server/auth';
import { prisma } from '@/server/db';
import { rateLimit } from '@/server/rate-limit';

const schema = z.object({
  name: z.string().trim().min(1).max(80),
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(10, 'Use at least 10 characters.').max(200),
});

/** First-run admin. Only works while no user exists. */
export const POST = route(
  async ({ req }) => {
    const ip = req.headers.get('x-forwarded-for') ?? 'local';
    if (rateLimit(`setup:${ip}`, 10, 15 * 60_000)) throw new ApiError(429, 'Too many attempts. Wait a few minutes.');
    const body = await readJson(req, schema);
    const user = await prisma.$transaction(async (tx) => {
      if ((await tx.user.count()) > 0) throw new ApiError(403, 'An admin already exists. Sign in instead.');
      return tx.user.create({
        data: { name: body.name, email: body.email, passwordHash: await hashPassword(body.password), role: 'ADMIN' },
        select: { id: true, email: true, name: true, role: true },
      });
    });
    await startSession(user, req.nextUrl.protocol === 'https:');
    return { ok: true, users: await userCount() };
  },
  { public: true },
);
