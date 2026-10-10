import type { QueueJob } from '@prisma/client';
import * as cheerio from 'cheerio';
import { prisma } from '@/server/db';
import { jobData } from '@/server/queue';
import { writeLog } from '@/server/log';
import { boilerplateGrams, compareDocs, distinctivePhrases, docFromHtml, docFromText, wordsIn, type Doc, type Passage } from '@/core/plagiarism';
import { fetchJson, safeFetch } from '../net/safe-fetch';

export type SourceKind = 'own' | 'linked' | 'url' | 'wikipedia' | 'google';
export type PlagiarismInput = {
  taskId?: string | null;
  html: string;
  keyword?: string;
  language: 'English' | 'German';
  urls: string[];
  sources: { own: boolean; links: boolean; wikipedia: boolean; google: boolean };
};
export type SourceReport = { kind: SourceKind; title: string; url: string; passages: Passage[]; countedWords: number; shownWords: number };
export type PlagiarismReport = {
  articleText: string;
  articleWords: number;
  sources: SourceReport[];
  checked: Record<SourceKind, number>;
  problems: { kind: SourceKind; url: string; reason: string }[];
  phrases: string[];
  googleSearches: number;
  countedWords: number;
  shownWords: number;
  ownArticles: number;
  boilerplate: number;
  finishedAt: string;
};

export type PageResult = { status: number; url: string; contentType: string; html: string };
export type SearchHit = { link: string; title: string; position: number };
export type PlagiarismDeps = {
  page(url: string): Promise<PageResult>;
  json<T>(url: string): Promise<T>;
  /** Exact-phrase Google search through serper.dev; null when no key is set. */
  search: ((q: string, language: 'English' | 'German') => Promise<SearchHit[]>) | null;
};

export const MAX_LINKED = 10;
export const MAX_USER_URLS = 10;
export const MAX_GOOGLE_PAGES = 12;
const MAX_PASSAGES_PER_SOURCE = 60;
const MAX_SOURCES = 40;

export function serperSearch(apiKey: string): PlagiarismDeps['search'] {
  return async (q, language) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20_000);
    try {
      const res = await fetch('https://google.serper.dev/search', {
        method: 'POST',
        signal: ctrl.signal,
        headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ q, num: 10, gl: language === 'German' ? 'de' : 'us', hl: language === 'German' ? 'de' : 'en' }),
      });
      if (!res.ok) throw new Error(`serper.dev answered HTTP ${res.status}`);
      const data = (await res.json()) as { organic?: { link?: string; title?: string; position?: number }[] };
      return (data.organic ?? []).filter((o) => o.link).map((o, i) => ({ link: o.link!, title: o.title ?? o.link!, position: o.position ?? i + 1 }));
    } finally {
      clearTimeout(timer);
    }
  };
}

export function defaultDeps(): PlagiarismDeps {
  const key = process.env.SERPER_API_KEY?.trim();
  return {
    async page(url) {
      const r = await safeFetch(url, { accept: 'text/html,application/xhtml+xml,text/plain', maxBytes: 4 * 1024 * 1024, timeoutMs: 15_000, allowHttp: true });
      return { status: r.status, url: r.url, contentType: r.contentType, html: r.body.toString('utf8') };
    },
    json: (url) => fetchJson(url, { timeoutMs: 12_000 }),
    search: key ? serperSearch(key) : null,
  };
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

function cleanUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = '';
    return u.toString();
  } catch {
    return url;
  }
}

/** Links in the article that point away from the owner's websites. */
export function externalLinks(html: string, ownHosts: Set<string>, max = MAX_LINKED): string[] {
  const $ = cheerio.load(html);
  const out: string[] = [];
  $('a[href]').each((_, a) => {
    const href = $(a).attr('href') ?? '';
    if (!/^https?:\/\//i.test(href)) return;
    const host = hostOf(href);
    if (!host || ownHosts.has(host)) return;
    const u = cleanUrl(href);
    if (!out.includes(u)) out.push(u);
  });
  return out.slice(0, max);
}

async function pool<T>(items: T[], size: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) await fn(items[next++]!);
    }),
  );
}

type WikiSearch = { query?: { search?: { title: string }[] } };
type WikiExtract = { query?: { pages?: Record<string, { title?: string; extract?: string; missing?: string; fullurl?: string }> } };

function wikiTitleFromUrl(url: string): string | null {
  const m = /^https?:\/\/(?:[a-z]+\.)?(?:m\.)?wikipedia\.org\/wiki\/([^?#]+)/i.exec(url);
  return m ? decodeURIComponent(m[1]!).replace(/_/g, ' ') : null;
}

/** Collects the sources, compares the article with each one and returns the evidence. */
export async function runPlagiarismCheck(input: PlagiarismInput, deps: PlagiarismDeps, progress: (step: string) => Promise<void> = async () => undefined): Promise<PlagiarismReport> {
  const article = docFromHtml(input.html);
  if (article.tokens.length < 20) throw new Error('The article is too short to check (fewer than 20 words).');
  const sources: SourceReport[] = [];
  const problems: PlagiarismReport['problems'] = [];
  const checked: Record<SourceKind, number> = { own: 0, linked: 0, url: 0, wikipedia: 0, google: 0 };
  const seen = new Set<string>();

  const websites = await prisma.website.findMany({ select: { url: true } });
  const ownHosts = new Set(websites.map((w) => hostOf(w.url)).filter(Boolean));

  // The owner's articles: compared one by one, and used to recognise boilerplate.
  await progress('Reading your own articles');
  const own = await prisma.articleTask.findMany({
    where: { id: input.taskId ? { not: input.taskId } : undefined, OR: [{ contentHtml: { not: null } }, { bodyHtml: { not: null } }] },
    orderBy: { createdAt: 'desc' },
    take: 500,
    select: { id: true, keyword: true, selectedTitle: true, contentHtml: true, bodyHtml: true },
  });
  const ownDocs = own.map((t) => ({ t, doc: docFromHtml(t.contentHtml || t.bodyHtml || '') }));
  const boiler = boilerplateGrams(ownDocs.map((o) => o.doc));

  const add = (kind: SourceKind, title: string, url: string, doc: Doc) => {
    checked[kind]++;
    const r = compareDocs(article, doc, boiler);
    if (r.passages.length) sources.push({ kind, title, url, passages: r.passages.slice(0, MAX_PASSAGES_PER_SOURCE), countedWords: r.countedWords, shownWords: r.shownWords });
  };

  if (input.sources.own) for (const { t, doc } of ownDocs) add('own', t.selectedTitle || t.keyword, `/articles/${t.id}`, doc);

  const fetchPage = async (kind: SourceKind, url: string, title?: string) => {
    const key = cleanUrl(url);
    if (seen.has(key)) return;
    seen.add(key);
    try {
      const r = await deps.page(url);
      if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
      if (r.contentType && !/html|xml|text\/plain/i.test(r.contentType)) throw new Error(`not a web page (${r.contentType.split(';')[0]})`);
      const doc = /text\/plain/i.test(r.contentType) ? docFromText(r.html) : docFromHtml(r.html, { page: true });
      if (doc.tokens.length < 20) throw new Error('no readable text (the page may need JavaScript or a login)');
      const pageTitle = title || cheerio.load(r.html)('title').first().text().trim() || url;
      add(kind, pageTitle.slice(0, 200), r.url || url, doc);
    } catch (err) {
      problems.push({ kind, url, reason: err instanceof Error ? err.message : String(err) });
    }
  };

  const linked = input.sources.links ? externalLinks(input.html, ownHosts) : [];
  const userUrls = input.urls.slice(0, MAX_USER_URLS);
  if (linked.length || userUrls.length) {
    await progress(`Reading ${linked.length + userUrls.length} linked and added pages`);
    await pool([...linked.map((u) => ['linked', u] as const), ...userUrls.map((u) => ['url', u] as const)], 4, ([kind, u]) => fetchPage(kind, u));
  }

  if (input.sources.wikipedia) {
    await progress('Searching Wikipedia');
    const lang = input.language === 'German' ? 'de' : 'en';
    const api = `https://${lang}.wikipedia.org/w/api.php?format=json&formatversion=1`;
    const query = input.keyword?.trim() || article.text.split('\n')[0]!.slice(0, 120);
    const already = new Set([...linked, ...userUrls].map(wikiTitleFromUrl).filter(Boolean).map((t) => t!.toLowerCase()));
    try {
      const s = await deps.json<WikiSearch>(`${api}&action=query&list=search&srlimit=3&srsearch=${encodeURIComponent(query)}`);
      for (const hit of s.query?.search ?? []) {
        if (already.has(hit.title.toLowerCase())) continue;
        try {
          const e = await deps.json<WikiExtract>(`${api}&action=query&prop=extracts|info&inprop=url&explaintext=1&redirects=1&titles=${encodeURIComponent(hit.title)}`);
          const page = Object.values(e.query?.pages ?? {})[0];
          if (!page?.extract) continue;
          const text = page.extract.replace(/^=+\s*(.*?)\s*=+\s*$/gm, '$1');
          add('wikipedia', `Wikipedia: ${page.title ?? hit.title}`, page.fullurl ?? `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(hit.title.replace(/ /g, '_'))}`, docFromText(text));
        } catch (err) {
          problems.push({ kind: 'wikipedia', url: hit.title, reason: err instanceof Error ? err.message : String(err) });
        }
      }
    } catch (err) {
      problems.push({ kind: 'wikipedia', url: `${lang}.wikipedia.org`, reason: err instanceof Error ? err.message : String(err) });
    }
  }

  let phrases: string[] = [];
  let googleSearches = 0;
  if (input.sources.google && deps.search) {
    phrases = distinctivePhrases(article, boiler, 10, 10);
    await progress(`Searching Google for ${phrases.length} phrases`);
    const found = new Map<string, { title: string; hits: number; best: number; link: string }>();
    for (const phrase of phrases) {
      try {
        googleSearches++;
        for (const h of await deps.search(`"${phrase}"`, input.language)) {
          const host = hostOf(h.link);
          if (!host || ownHosts.has(host)) continue;
          const key = cleanUrl(h.link);
          const f = found.get(key) ?? { title: h.title, hits: 0, best: 99, link: h.link };
          f.hits++;
          f.best = Math.min(f.best, h.position);
          found.set(key, f);
        }
      } catch (err) {
        problems.push({ kind: 'google', url: `"${phrase}"`, reason: err instanceof Error ? err.message : String(err) });
        if (/HTTP (401|403)/.test(String(err))) break;
      }
    }
    const top = [...found.values()].sort((a, b) => b.hits - a.hits || a.best - b.best).slice(0, MAX_GOOGLE_PAGES);
    if (top.length) {
      await progress(`Reading ${top.length} pages from Google`);
      await pool(top, 4, (f) => fetchPage('google', f.link, f.title));
    }
  }

  sources.sort((a, b) => b.countedWords - a.countedWords || b.shownWords - a.shownWords);
  const kept = sources.slice(0, MAX_SOURCES);
  const all = kept.flatMap((s) => s.passages);
  return {
    articleText: article.text,
    articleWords: article.tokens.length,
    sources: kept,
    checked,
    problems,
    phrases,
    googleSearches,
    countedWords: wordsIn(article, all.filter((p) => p.counted)),
    shownWords: wordsIn(article, all),
    ownArticles: ownDocs.length,
    boilerplate: boiler.size,
    finishedAt: new Date().toISOString(),
  };
}

/** "plagiarism" queue: runs a check from the Plagiarism Check page. Nothing is changed in the article. */
export async function handlePlagiarismJob(job: QueueJob): Promise<PlagiarismReport> {
  const input = jobData<PlagiarismInput>(job, { html: '', language: 'English', urls: [], sources: { own: true, links: true, wikipedia: true, google: false } });
  const report = await runPlagiarismCheck(input, defaultDeps(), async (step) => {
    await prisma.queueJob.update({ where: { id: job.id }, data: { progress: JSON.stringify({ step }), heartbeatAt: new Date() } });
  });
  const counted = report.sources.reduce((n, s) => n + s.passages.filter((p) => p.counted).length, 0);
  await writeLog({
    taskId: input.taskId ?? null,
    category: 'SEO',
    stage: 'PLAGIARISM',
    message: `Plagiarism check: ${counted} counted passage(s) in ${report.sources.length} source(s); ${Object.values(report.checked).reduce((a, b) => a + b, 0)} sources checked${report.googleSearches ? `, ${report.googleSearches} Google searches` : ''}.`,
  });
  return report;
}
