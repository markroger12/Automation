import { route } from '@/server/api';
import { endSession } from '@/server/auth';

export const POST = route(
  async () => {
    await endSession();
    return { ok: true };
  },
  { public: true },
);
