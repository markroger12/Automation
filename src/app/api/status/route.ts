import { route } from '@/server/api';
import { getSystemStatus } from '@/server/status';

export const dynamic = 'force-dynamic';
export const GET = route(async () => getSystemStatus());
