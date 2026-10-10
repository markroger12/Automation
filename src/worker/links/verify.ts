import * as cheerio from 'cheerio';
import { checkTrustedUrl, imdbIdFromUrl, titleMatchesPhrase, wikipediaTitleFromUrl, type LinkKind, type LinkSuggestion } from '@/core/external-links';
import type { Lang } from '@/core/language';
import { fetchJson, safeFetch } from '../net/safe-fetch';

export type Fetcher = {
  json<T>(url: string): Promise<T>;
  page(url: string): Promise<{ status: number; url: string; html: string }>;
};

export const defaultFetcher: Fetcher = {
  json: (url) => fetchJson(url, { timeoutMs: 12_000 }),
  async page(url) {
    const r = await safeFetch(url, { accept: 'text/html,application/xhtml+xml', maxBytes: 3 * 1024 * 1024, timeoutMs: 12_000 });
    return { status: r.status, url: r.url, html: r.body.toString('utf8') };
  },
};

export type Verified = { ok: true; phrase: string; url: string; kind: LinkKind; title: string } | { ok: false; phrase: string; url: string; reason: string };

type WikiResponse = { query?: { pages?: Record<string, { missing?: string; invalid?: string; title?: string; fullurl?: string; pageprops?: Record<string, string> }> } };
type WikidataSearch = { search?: { id: string; label?: string }[] };
type WikidataEntities = { entities?: Record<string, { claims?: Record<string, { mainsnak?: { datavalue?: { value?: unknown } } }[]> }> };

/** The page must exist and be about the phrase. */
export async function verifyLink(s: LinkSuggestion, language: Lang, fetcher: Fetcher = defaultFetcher): Promise<Verified> {
  const trust = checkTrustedUrl(s.url, s.phrase, language);
  if (!trust.ok) return { ok: false, phrase: s.phrase, url: s.url, reason: trust.reason };
  try {
    if (trust.kind === 'wikipedia') {
      const u = new URL(s.url);
      const title = wikipediaTitleFromUrl(s.url)!;
      const api = `https://${u.hostname.replace('.m.wikipedia.org', '.wikipedia.org')}/w/api.php?action=query&format=json&redirects=1&prop=pageprops|info&inprop=url&titles=${encodeURIComponent(title)}`;
      const data = await fetcher.json<WikiResponse>(api);
      const page = Object.values(data.query?.pages ?? {})[0];
      if (!page || page.missing !== undefined || page.invalid !== undefined) return { ok: false, phrase: s.phrase, url: s.url, reason: 'the Wikipedia page does not exist' };
      if (page.pageprops && 'disambiguation' in page.pageprops) return { ok: false, phrase: s.phrase, url: s.url, reason: 'it is a disambiguation page' };
      if (!titleMatchesPhrase(page.title ?? '', s.phrase)) return { ok: false, phrase: s.phrase, url: s.url, reason: `the Wikipedia page is about "${page.title}"` };
      return { ok: true, phrase: s.phrase, url: page.fullurl ?? s.url, kind: 'wikipedia', title: page.title ?? title };
    }
    if (trust.kind === 'imdb') {
      const id = imdbIdFromUrl(s.url)!;
      const lang = language === 'German' ? 'de' : 'en';
      const search = await fetcher.json<WikidataSearch>(`https://www.wikidata.org/w/api.php?action=wbsearchentities&format=json&type=item&limit=7&language=${lang}&uselang=${lang}&search=${encodeURIComponent(s.phrase)}`);
      const ids = (search.search ?? []).map((x) => x.id).slice(0, 7);
      if (!ids.length) return { ok: false, phrase: s.phrase, url: s.url, reason: 'Wikidata does not know the phrase, so the IMDb id cannot be checked' };
      const ent = await fetcher.json<WikidataEntities>(`https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=claims&ids=${ids.join('|')}`);
      const match = Object.values(ent.entities ?? {}).some((e) => (e.claims?.P345 ?? []).some((c) => c.mainsnak?.datavalue?.value === id));
      if (!match) return { ok: false, phrase: s.phrase, url: s.url, reason: `IMDb ${id} is not the IMDb id of "${s.phrase}" on Wikidata (P345)` };
      return { ok: true, phrase: s.phrase, url: `https://www.imdb.com/${id.startsWith('nm') ? 'name' : 'title'}/${id}/`, kind: 'imdb', title: s.phrase };
    }
    const res = await fetcher.page(s.url);
    if (res.status !== 200) return { ok: false, phrase: s.phrase, url: s.url, reason: `the page answers HTTP ${res.status}` };
    const $ = cheerio.load(res.html);
    const titles = [$('title').first().text(), $('meta[property="og:title"]').attr('content') ?? '', $('h1').first().text(), $('meta[property="og:site_name"]').attr('content') ?? ''].map((t) => t.replace(/\s+/g, ' ').trim()).filter(Boolean);
    const hit = titles.find((t) => titleMatchesPhrase(t, s.phrase));
    if (!hit) return { ok: false, phrase: s.phrase, url: s.url, reason: `the page title "${titles[0] ?? '(none)'}" does not match "${s.phrase}"` };
    return { ok: true, phrase: s.phrase, url: res.url, kind: trust.kind, title: hit };
  } catch (err) {
    return { ok: false, phrase: s.phrase, url: s.url, reason: `could not check the page (${err instanceof Error ? err.message : String(err)})` };
  }
}
