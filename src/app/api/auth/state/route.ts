import { route } from '@/server/api';
import { userCount } from '@/server/auth';

export const GET = route(async () => ({ hasUsers: (await userCount()) > 0 }), { public: true });
