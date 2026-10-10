import { route } from '@/server/api';

export const dynamic = 'force-dynamic';
export const GET = route(async () => ({ ok: true, app: 'blog-automation-studio' }), { public: true });
