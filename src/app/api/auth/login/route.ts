import { z } from 'zod';
import { ApiError, readJson, route } from '@/server/api';
import bcrypt from 'bcryptjs';
import { startSession, verifyPassword } from '@/server/auth';
import { prisma } from '@/server/db';
import { isLimited, rateLimit, resetRateLimit } from '@/server/rate-limit';
import { writeLog } from '@/server/log';

const schema = z.object({ email: z.string().trim().toLowerCase().max(200), password: z.string().max(200) });

const WINDOW = 15 * 60_000;
let dummyHash: string | null = null;

export const POST = route(
  async ({ req }) => {
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
    if (rateLimit(`login-ip:${ip}`, 30, WINDOW)) throw new ApiError(429, 'Too many sign-in attempts. Wait 15 minutes.');
    const body = await readJson(req, schema);
    const emailKey = `login-fail:${body.email}`;
    const wait = isLimited(emailKey, 5);
    if (wait) throw new ApiError(429, `Too many failed attempts for this email. Try again in ${Math.ceil(wait / 60)} minutes.`);

    const user = await prisma.user.findUnique({ where: { email: body.email } });
    // Always run bcrypt so timing does not reveal whether the email exists.
    dummyHash ??= await bcrypt.hash('no-user-has-this-password', 12);
    const ok = await verifyPassword(body.password, user?.passwordHash ?? dummyHash);
    if (!user || !ok) {
      rateLimit(emailKey, 5, WINDOW);
      await writeLog({ level: 'WARN', category: 'SYSTEM', message: `Failed sign-in for ${body.email}` });
      throw new ApiError(401, 'Wrong email or password.');
    }
    resetRateLimit(emailKey);
    await startSession({ id: user.id, email: user.email, name: user.name, role: user.role }, req.nextUrl.protocol === 'https:');
    return { ok: true };
  },
  { public: true },
);
