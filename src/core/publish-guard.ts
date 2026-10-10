/**
 * Publish guard: decides whether an outgoing editor request would publish, schedule, make private or
 * submit a post for review. The worker aborts such requests at the network level for every WordPress page,
 * unless the request comes from the Workflow scheduler for a website allowed to publish by itself.
 */

export const BLOCKED_STATUSES = ['publish', 'future', 'private', 'pending'] as const;
export type PostStatus = (typeof BLOCKED_STATUSES)[number] | 'draft' | string;

export type GuardRequest = { method: string; url: string; body?: string | null; headers?: Record<string, string | undefined> };
export type GuardOptions = { allowedStatuses?: string[] };
export type GuardDecision = { block: boolean; reason?: string };

const REST_POST_ROUTE = /\/wp\/v2\/([a-z0-9_-]+)(?:\/(\d+))?\/?$/i;
const NON_POST_TYPES = new Set(['media', 'categories', 'tags', 'users', 'comments', 'settings', 'taxonomies', 'types', 'statuses', 'search', 'block-renderer', 'themes', 'plugins', 'menus', 'menu-items', 'menu-locations', 'sidebars', 'widgets', 'widget-types', 'global-styles', 'templates', 'template-parts', 'navigation', 'font-families', 'font-collections', 'block-directory', 'pattern-directory', 'block-patterns', 'block-types']);

function restRoute(url: URL): string | null {
  const qp = url.searchParams.get('rest_route');
  if (qp) return qp;
  const idx = url.pathname.indexOf('/wp-json/');
  if (idx >= 0) return url.pathname.slice(idx + '/wp-json'.length);
  return null;
}

function effectiveMethod(req: GuardRequest, url: URL): string {
  const override = req.headers?.['x-http-method-override'] ?? req.headers?.['X-HTTP-Method-Override'] ?? url.searchParams.get('_method') ?? undefined;
  return (override ?? req.method).toUpperCase();
}

function parseBody(body: string | null | undefined): { json?: unknown; form?: URLSearchParams; raw: string } {
  const raw = body ?? '';
  const trimmed = raw.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return { json: JSON.parse(trimmed), raw };
    } catch {
      return { raw };
    }
  }
  if (/^[^=&\s]+=/.test(trimmed)) {
    try {
      return { form: new URLSearchParams(trimmed), raw };
    } catch {
      return { raw };
    }
  }
  return { raw };
}

function isBlockedStatus(status: unknown, allowed: string[]): boolean {
  if (typeof status !== 'string') return false;
  const s = status.toLowerCase();
  return (BLOCKED_STATUSES as readonly string[]).includes(s) && !allowed.includes(s);
}

/** Multipart bodies (classic editor forms) — look for name="field" parts. */
function multipartFields(raw: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = /name="([^"]+)"\r?\n\r?\n([^\r\n]*)/g;
  for (const m of raw.matchAll(re)) out.set(m[1]!, m[2]!);
  return out;
}

export function checkPublishRequest(req: GuardRequest, opts: GuardOptions = {}): GuardDecision {
  const allowed = (opts.allowedStatuses ?? []).map((s) => s.toLowerCase());
  let url: URL;
  try {
    url = new URL(req.url);
  } catch {
    return { block: false };
  }
  const method = effectiveMethod(req, url);
  if (!['POST', 'PUT', 'PATCH'].includes(method)) return { block: false };
  const body = parseBody(req.body);

  // XML-RPC can publish (wp.newPost / wp.editPost); never needed by this app.
  if (/\/xmlrpc\.php$/i.test(url.pathname)) return { block: true, reason: 'XML-RPC request' };

  // REST API
  const route = restRoute(url);
  if (route) {
    if (/^\/batch\/v1\/?$/i.test(route)) {
      const requests = (body.json as { requests?: { path?: string; body?: unknown; method?: string }[] } | undefined)?.requests ?? [];
      for (const r of requests) {
        const inner = checkPublishRequest(
          { method: r.method ?? 'POST', url: `${url.origin}/wp-json${r.path ?? ''}`, body: JSON.stringify(r.body ?? {}) },
          opts,
        );
        if (inner.block) return { block: true, reason: `batch: ${inner.reason}` };
      }
      return { block: false };
    }
    const m = REST_POST_ROUTE.exec(route.split('?')[0]!);
    if (m && !NON_POST_TYPES.has(m[1]!.toLowerCase())) {
      const json = body.json as Record<string, unknown> | undefined;
      const status = json?.status ?? body.form?.get('status') ?? url.searchParams.get('status');
      if (isBlockedStatus(status, allowed)) return { block: true, reason: `REST ${m[1]} status "${status}"` };
    }
    return { block: false };
  }

  // Classic admin forms and admin-ajax (quick edit / bulk edit)
  if (/\/wp-admin\/(post\.php|post-new\.php|edit\.php|admin-ajax\.php)$/i.test(url.pathname)) {
    const fields = body.form ?? new URLSearchParams();
    const multi = body.form ? null : multipartFields(body.raw);
    const get = (k: string) => fields.get(k) ?? multi?.get(k) ?? null;
    const has = (k: string) => fields.has(k) || !!multi?.has(k);
    if (has('publish') && !allowed.includes('publish') && !allowed.includes('future')) return { block: true, reason: 'classic editor Publish button' };
    // post_status = classic editor, _status = quick/bulk edit. (hidden_post_status is the previous status.)
    for (const key of ['post_status', '_status']) {
      if (isBlockedStatus(get(key), allowed)) return { block: true, reason: `form field ${key}="${get(key)}"` };
    }
    if (get('visibility') === 'private' && !allowed.includes('private')) return { block: true, reason: 'private visibility' };
  }
  return { block: false };
}
