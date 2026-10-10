/** Parses a JSON column. Never throws: returns the fallback on bad or empty input. */
export function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (raw === null || raw === undefined || raw === '') return fallback;
  try {
    const value = JSON.parse(raw) as unknown;
    return (value ?? fallback) as T;
  } catch {
    return fallback;
  }
}

export function toJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}

export function stringArray(raw: string | null | undefined): string[] {
  const v = parseJson<unknown>(raw, []);
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

/** Shortens a JSON value to at most `max` characters (for logs and debug snapshots). */
export function clipJson(value: unknown, max = 4000): string {
  const text = JSON.stringify(value ?? null);
  if (text.length <= max) return text;
  return JSON.stringify({ truncated: true, preview: text.slice(0, max - 60) });
}
