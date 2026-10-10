import dns from 'node:dns/promises';
import net from 'node:net';
import { isPrivateAddress } from '@/core/net-guard';

export type SafeFetchOptions = {
  maxBytes?: number;
  timeoutMs?: number;
  maxRedirects?: number;
  accept?: string;
  /** Only for owner-configured addresses (their own website); never for addresses from ChatGPT answers. */
  allowPrivate?: boolean;
  allowHttp?: boolean;
};

export type SafeResponse = { status: number; url: string; contentType: string; body: Buffer };

export class FetchBlockedError extends Error {}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36 BlogAutomationStudio';

async function checkHost(url: URL, opts: SafeFetchOptions) {
  if (url.protocol !== 'https:' && !(opts.allowHttp && url.protocol === 'http:')) throw new FetchBlockedError(`Only https addresses are allowed (${url.protocol}).`);
  if (opts.allowPrivate) return;
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) throw new FetchBlockedError(`Blocked host ${host}`);
  const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true, verbatim: true });
  if (!addrs.length) throw new FetchBlockedError(`Cannot resolve ${host}`);
  for (const a of addrs) if (isPrivateAddress(a.address)) throw new FetchBlockedError(`Blocked private address for ${host}`);
}

/**
 * fetch() for addresses that come from outside (ChatGPT answers, image search): https only, DNS check against
 * private/loopback addresses on every redirect, no cookies, size cap, timeout.
 */
export async function safeFetch(input: string, opts: SafeFetchOptions = {}): Promise<SafeResponse> {
  const maxBytes = opts.maxBytes ?? 12 * 1024 * 1024;
  let url = new URL(input);
  for (let hop = 0; hop <= (opts.maxRedirects ?? 5); hop++) {
    await checkHost(url, opts);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 15_000);
    let res: Response;
    try {
      res = await fetch(url, { redirect: 'manual', signal: ctrl.signal, credentials: 'omit', headers: { 'User-Agent': UA, Accept: opts.accept ?? '*/*', 'Accept-Language': 'en,de;q=0.8' } });
    } finally {
      clearTimeout(timer);
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      url = new URL(res.headers.get('location')!, url);
      continue;
    }
    const len = Number(res.headers.get('content-length') ?? 0);
    if (len > maxBytes) throw new FetchBlockedError(`Response too large (${len} bytes)`);
    const reader = res.body?.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    if (reader) {
      const ctrl2 = setTimeout(() => reader.cancel().catch(() => undefined), opts.timeoutMs ?? 15_000);
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value.byteLength;
          if (total > maxBytes) {
            await reader.cancel().catch(() => undefined);
            throw new FetchBlockedError(`Response larger than ${maxBytes} bytes`);
          }
          chunks.push(value);
        }
      } finally {
        clearTimeout(ctrl2);
      }
    }
    return { status: res.status, url: url.toString(), contentType: res.headers.get('content-type') ?? '', body: Buffer.concat(chunks) };
  }
  throw new FetchBlockedError('Too many redirects');
}

export async function fetchJson<T>(url: string, opts: SafeFetchOptions = {}): Promise<T> {
  const res = await safeFetch(url, { accept: 'application/json', maxBytes: 5 * 1024 * 1024, ...opts });
  if (res.status !== 200) throw new Error(`HTTP ${res.status} for ${url}`);
  return JSON.parse(res.body.toString('utf8')) as T;
}
