type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

/** Fixed-window limiter kept in memory (one dashboard process). Returns seconds to wait, or 0 when allowed. */
export function rateLimit(key: string, limit: number, windowMs: number): number {
  const now = Date.now();
  if (buckets.size > 5000) {
    for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
  }
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return 0;
  }
  bucket.count++;
  if (bucket.count > limit) return Math.ceil((bucket.resetAt - now) / 1000);
  return 0;
}

export function resetRateLimit(key: string): void {
  buckets.delete(key);
}

/** Peeks without counting. */
export function isLimited(key: string, limit: number): number {
  const b = buckets.get(key);
  if (!b || b.resetAt <= Date.now()) return 0;
  return b.count >= limit ? Math.ceil((b.resetAt - Date.now()) / 1000) : 0;
}
