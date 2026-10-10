import type { Page } from 'playwright';
import { checkPublishRequest } from '@/core/publish-guard';

/**
 * WordPress REST calls made from inside the logged-in admin page: the browser's own cookies plus the
 * wpApiSettings nonce. No passwords or Application Passwords are stored or typed.
 */

export type WpRestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  /** Raw upload (media library) */
  upload?: { base64: string; filename: string; mime: string };
  /** Only the Workflow scheduler passes ['future'], and only for websites allowed to publish */
  allowedStatuses?: string[];
};

export type WpRestResult<T> = { status: number; ok: boolean; data: T; text: string; total?: number; totalPages?: number };

export class WpRestError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
    this.name = 'WpRestError';
  }
}

type RestEnv = { root: string; nonce: string };
const envCache = new WeakMap<Page, RestEnv>();

/** "https://site.com/blog/wp-admin/" → "https://site.com/blog" */
export function siteBaseFromAdmin(adminUrl: string): string {
  const u = new URL(adminUrl);
  const idx = u.pathname.indexOf('/wp-admin');
  const basePath = idx >= 0 ? u.pathname.slice(0, idx) : u.pathname.replace(/\/+$/, '');
  return `${u.origin}${basePath}`.replace(/\/+$/, '');
}

export function buildRestUrl(root: string, path: string, query?: WpRestOptions['query']): string {
  const cleanPath = '/' + path.replace(/^\/+/, '');
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined) params.set(k, String(v));
  const qs = params.toString();
  if (root.includes('rest_route=')) return `${root}${cleanPath}${qs ? `&${qs}` : ''}`;
  return `${root.replace(/\/+$/, '')}${cleanPath}${qs ? `?${qs}` : ''}`;
}

async function restEnv(page: Page, adminUrl: string): Promise<RestEnv> {
  const cached = envCache.get(page);
  if (cached) return cached;
  const base = siteBaseFromAdmin(adminUrl);
  const found = await page.evaluate(() => {
    const w = window as unknown as { wpApiSettings?: { root?: string; nonce?: string }; wp?: { apiFetch?: { nonceMiddleware?: { nonce?: string } } } };
    return { root: w.wpApiSettings?.root ?? null, nonce: w.wpApiSettings?.nonce ?? w.wp?.apiFetch?.nonceMiddleware?.nonce ?? null };
  });
  let nonce = found.nonce;
  if (!nonce) {
    // Core action that returns a REST nonce for the logged-in user (works on classic-editor admin pages too).
    nonce = await page.evaluate(async (url: string) => {
      const res = await fetch(url, { credentials: 'include' });
      const text = (await res.text()).trim();
      return res.ok && /^[a-f0-9]{6,}$/i.test(text) ? text : null;
    }, `${base}/wp-admin/admin-ajax.php?action=rest-nonce`);
  }
  if (!nonce) throw new WpRestError(401, 'Could not get a WordPress REST nonce — is the session still logged in?');
  const env = { root: found.root ?? `${base}/wp-json/`, nonce };
  envCache.set(page, env);
  return env;
}

export function forgetRestEnv(page: Page): void {
  envCache.delete(page);
}

export async function wpRest<T = unknown>(page: Page, adminUrl: string, opts: WpRestOptions): Promise<WpRestResult<T>> {
  const env = await restEnv(page, adminUrl);
  const method = opts.method ?? (opts.body !== undefined || opts.upload ? 'POST' : 'GET');
  let url = buildRestUrl(env.root, opts.path, opts.query);
  const bodyText = opts.body !== undefined ? JSON.stringify(opts.body) : null;

  // Second line of defence next to the network guard: never send a publishing request by mistake.
  const decision = checkPublishRequest({ method, url, body: bodyText }, { allowedStatuses: opts.allowedStatuses });
  if (decision.block) throw new WpRestError(403, `Blocked by the publish guard: ${decision.reason}`);

  const call = (target: string) =>
    page.evaluate(
      async (a: { url: string; method: string; nonce: string; body: string | null; upload: WpRestOptions['upload'] | null }) => {
        const headers: Record<string, string> = { 'X-WP-Nonce': a.nonce, Accept: 'application/json' };
        let body: BodyInit | undefined;
        if (a.upload) {
          const bin = atob(a.upload.base64);
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          body = new Blob([bytes], { type: a.upload.mime });
          headers['Content-Type'] = a.upload.mime;
          headers['Content-Disposition'] = `attachment; filename="${a.upload.filename.replace(/"/g, '')}"`;
        } else if (a.body !== null) {
          headers['Content-Type'] = 'application/json';
          body = a.body;
        }
        const res = await fetch(a.url, { method: a.method, credentials: 'include', headers, body });
        return { status: res.status, text: await res.text(), total: res.headers.get('X-WP-Total'), totalPages: res.headers.get('X-WP-TotalPages'), type: res.headers.get('content-type') ?? '' };
      },
      { url: target, method, nonce: env.nonce, body: bodyText, upload: opts.upload ?? null },
    );

  let res = await call(url);
  // Sites without pretty permalinks answer /wp-json/ with an HTML 404: switch to ?rest_route=.
  if (res.status === 404 && !env.root.includes('rest_route=') && !res.type.includes('json')) {
    env.root = `${siteBaseFromAdmin(adminUrl)}/?rest_route=`;
    url = buildRestUrl(env.root, opts.path, opts.query);
    res = await call(url);
  }
  let data: unknown = null;
  try {
    data = res.text ? JSON.parse(res.text) : null;
  } catch {
    data = null;
  }
  const ok = res.status >= 200 && res.status < 300;
  return { status: res.status, ok, data: data as T, text: res.text, total: res.total ? Number(res.total) : undefined, totalPages: res.totalPages ? Number(res.totalPages) : undefined };
}

/** Like wpRest but throws a readable error unless the response is 2xx. */
export async function wpRestOk<T = unknown>(page: Page, adminUrl: string, opts: WpRestOptions): Promise<T> {
  const res = await wpRest<T>(page, adminUrl, opts);
  if (!res.ok) {
    const err = res.data as { message?: string; code?: string } | null;
    throw new WpRestError(res.status, `WordPress ${opts.method ?? 'GET'} ${opts.path} failed (${res.status}): ${err?.message ?? res.text.slice(0, 200)}`, err?.code);
  }
  return res.data;
}
