import { z } from 'zod';
import { ApiError, readJson, route } from '@/server/api';
import { hashPassword } from '@/server/auth';
import { prisma } from '@/server/db';

export const dynamic = 'force-dynamic';

export const GET = route(async () => ({
  users: await prisma.user.findMany({
    select: { id: true, name: true, email: true, role: true, lastLoginAt: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  }),
}));

const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(10).max(200),
  role: z.enum(['ADMIN', 'EDITOR']).default('EDITOR'),
});

export const POST = route(
  async ({ req }) => {
    const body = await readJson(req, createSchema);
    if (await prisma.user.findUnique({ where: { email: body.email } })) throw new ApiError(409, 'A user with this email exists.');
    const user = await prisma.user.create({
      data: { name: body.name, email: body.email, role: body.role, passwordHash: await hashPassword(body.password) },
      select: { id: true, name: true, email: true, role: true },
    });
    return { user };
  },
  { admin: true },
);
