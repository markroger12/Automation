const SECRET_KEY = /pass(word|wd)?|secret|token|api[-_]?key|authorization|cookie|session|credential|nonce|bearer/i;

/** Replaces credential-like fields (password, token, cookie…) with "[redacted]", recursively. */
export function redact<T>(value: T, depth = 0): T {
  if (depth > 8 || value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1)) as unknown as T;
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEY.test(k) && v !== null && v !== undefined && typeof v !== 'boolean' && typeof v !== 'number') {
        out[k] = '[redacted]';
      } else {
        out[k] = redact(v, depth + 1);
      }
    }
    return out as T;
  }
  if (typeof value === 'string') return redactString(value) as unknown as T;
  return value;
}

/** Hides connection keys and bearer tokens inside free text. */
export function redactString(text: string): string {
  return text
    .replace(/\bbas_[A-Za-z0-9_-]{8,}/g, 'bas_[redacted]')
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, '$1[redacted]');
}
