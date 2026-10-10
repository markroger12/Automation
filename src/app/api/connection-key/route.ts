import { route } from '@/server/api';
import { clearKeyCache, createConnectionKey } from '@/server/extension-key';
import { getInternal } from '@/server/settings';
import { writeLog } from '@/server/log';

export const dynamic = 'force-dynamic';

export const GET = route(async () => ({
  exists: !!(await getInternal<string | null>('extensionKeyHash', null)),
  createdAt: await getInternal<string | null>('extensionKeyCreatedAt', null),
}));

/** Creates a new connection key. It is shown once; old installs stop working. */
export const POST = route(
  async ({ user }) => {
    const key = await createConnectionKey();
    clearKeyCache();
    await writeLog({ category: 'SESSION', message: `New extension connection key created by ${user.email}; older installs are switched off.` });
    return { key };
  },
  { admin: true },
);
