import { ApiError, route } from '@/server/api';
import { prisma } from '@/server/db';

export const DELETE = route<{ id: string }>(
  async ({ params, user }) => {
    if (params.id === user.id) throw new ApiError(400, 'You cannot delete your own account.');
    const target = await prisma.user.findUnique({ where: { id: params.id } });
    if (!target) throw new ApiError(404, 'User not found.');
    if (target.role === 'ADMIN' && (await prisma.user.count({ where: { role: 'ADMIN' } })) <= 1) {
      throw new ApiError(400, 'The last admin cannot be deleted.');
    }
    await prisma.user.delete({ where: { id: params.id } });
    return { ok: true };
  },
  { admin: true },
);
