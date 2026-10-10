import { route, readJson, ApiError } from '@/server/api';
import { getSettings, saveSettings } from '@/server/settings';
import { settingsSchema, selectorOverridesSchema } from '@/lib/settings-schema';
import { writeLog } from '@/server/log';

export const dynamic = 'force-dynamic';

export const GET = route(async () => ({ settings: await getSettings() }));

export const PUT = route(
  async ({ req, user }) => {
    const body = await readJson(req, settingsSchema.partial());
    if (body.selectorOverrides !== undefined) {
      try {
        selectorOverridesSchema.parse(JSON.parse(body.selectorOverrides || '{}'));
      } catch {
        throw new ApiError(400, 'Selector overrides must be JSON like {"rankmath.score": [".selector"]}.');
      }
    }
    const settings = await saveSettings(body);
    await writeLog({ category: 'SYSTEM', message: `Settings saved by ${user.email}`, data: { changed: Object.keys(body) } });
    return { settings };
  },
  { admin: true },
);
