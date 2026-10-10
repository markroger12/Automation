import { prisma } from './db';
import { DEFAULT_SETTINGS, settingsSchema, type Settings } from '@/lib/settings-schema';

const SETTING_KEYS = Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[];

/** Reads all settings, merged over the defaults. Unknown or invalid stored values fall back to the default. */
export async function getSettings(): Promise<Settings> {
  const rows = await prisma.setting.findMany({ where: { key: { in: SETTING_KEYS as string[] } } });
  const raw: Record<string, unknown> = {};
  for (const row of rows) {
    try {
      raw[row.key] = JSON.parse(row.value);
    } catch {
      // ignore broken rows
    }
  }
  const result: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const key of SETTING_KEYS) {
    if (!(key in raw)) continue;
    const field = settingsSchema.shape[key];
    const parsed = field.safeParse(raw[key]);
    if (parsed.success) result[key] = parsed.data;
  }
  return result as Settings;
}

export async function saveSettings(partial: Partial<Settings>): Promise<Settings> {
  const current = await getSettings();
  const merged = settingsSchema.parse({ ...current, ...partial });
  if (merged.minKeywordOccurrences > merged.maxKeywordOccurrences) {
    merged.maxKeywordOccurrences = merged.minKeywordOccurrences;
  }
  await prisma.$transaction(
    SETTING_KEYS.filter((k) => k in partial).map((key) =>
      prisma.setting.upsert({
        where: { key },
        create: { key, value: JSON.stringify(merged[key]) },
        update: { value: JSON.stringify(merged[key]) },
      }),
    ),
  );
  return merged;
}

/** Writes any default settings that are not stored yet (used by setup). Existing values are kept. */
export async function seedSettings(): Promise<number> {
  const existing = new Set((await prisma.setting.findMany({ select: { key: true } })).map((r) => r.key));
  let created = 0;
  for (const key of SETTING_KEYS) {
    if (existing.has(key)) continue;
    await prisma.setting.create({ data: { key, value: JSON.stringify(DEFAULT_SETTINGS[key]) } });
    created++;
  }
  return created;
}

/** Internal key/value store for things that are not user settings (connection key hash, flags). */
export async function getInternal<T>(key: string, fallback: T): Promise<T> {
  const row = await prisma.setting.findUnique({ where: { key: `internal:${key}` } });
  if (!row) return fallback;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return fallback;
  }
}

export async function setInternal(key: string, value: unknown): Promise<void> {
  const k = `internal:${key}`;
  await prisma.setting.upsert({
    where: { key: k },
    create: { key: k, value: JSON.stringify(value) },
    update: { value: JSON.stringify(value) },
  });
}
