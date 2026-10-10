import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestDb } from '../helpers/test-db';

setupTestDb();
const { prisma } = await import('@/server/db');
const { runPlagiarismCheck } = await import('@/worker/plagiarism/run');
type Deps = import('@/worker/plagiarism/run').PlagiarismDeps;

const BOILER = 'If you enjoyed reading this article please share it with your friends and family members.';
const COPIED = 'Sweeney spent two summers training with stunt coordinators before filming the demanding action sequences for the thriller.';
const OWN_REUSED = 'Her production company champions unconventional screenplays written by emerging storytellers from smaller towns across America.';
const WIKI = 'Sweeney was raised in Spokane, where she attended Saint George’s School and developed an early interest in acting.';

const ARTICLE = `<h2>Career</h2>
<p>${COPIED} She later talked about it in several interviews.</p>
<p>${OWN_REUSED}</p>
<p>Sweeney was raised in Spokane, where she went to Saint George’s School and soon developed an early interest in acting.</p>
<p>See <a href="https://source.example/news/sweeney">this report</a>, <a href="https://www.myblog.example/older-post">our older post</a> and <a href="https://files.example/doc.pdf">the PDF</a>.</p>
<p>${BOILER}</p>`;

const pages: Record<string, { status: number; contentType: string; html: string }> = {
  'https://source.example/news/sweeney': {
    status: 200,
    contentType: 'text/html; charset=utf-8',
    html: `<html><head><title>Sweeney report</title></head><body><nav>Home News Celebrities Movies Contact us and many more links</nav><article><p>Intro of the report.</p><p>${COPIED}</p></article><footer>${BOILER}</footer></body></html>`,
  },
  'https://files.example/doc.pdf': { status: 200, contentType: 'application/pdf', html: '%PDF' },
  'https://google-hit.example/story': {
    status: 200,
    contentType: 'text/html',
    html: `<html><head><title>Fan page</title></head><body><main><p>Fans love this news about the actress and her many new projects. ${OWN_REUSED}</p></main></body></html>`,
  },
};

const fetched: string[] = [];
const searches: string[] = [];
const deps: Deps = {
  async page(url) {
    fetched.push(url);
    const p = pages[url];
    if (!p) throw new Error('HTTP 404');
    return { ...p, url };
  },
  async json<T>(url: string) {
    if (url.includes('list=search')) return { query: { search: [{ title: 'Sydney Sweeney' }] } } as T;
    return { query: { pages: { '1': { title: 'Sydney Sweeney', fullurl: 'https://en.wikipedia.org/wiki/Sydney_Sweeney', extract: `== Early life ==\n${WIKI}\n== Career ==\nShe began acting in 2009.` } } } } as T;
  },
  async search(q) {
    searches.push(q);
    return searches.length === 1 ? [{ link: 'https://google-hit.example/story', title: 'Fan page', position: 1 }, { link: 'https://myblog.example/x', title: 'Own', position: 2 }] : [];
  },
};

describe('Plagiarism check', () => {
  beforeAll(async () => {
    await prisma.website.create({ data: { name: 'My blog', url: 'https://myblog.example', adminUrl: 'https://myblog.example/wp-admin' } });
    for (let i = 0; i < 6; i++) {
      await prisma.articleTask.create({
        data: {
          moduleKey: 'celebrity-writer',
          keyword: `person ${i}`,
          targetCountry: 'United States',
          language: 'English',
          selectedTitle: `Person ${i} Biography`,
          contentHtml: `<p>Person ${i} has a story of their own with number ${i * 13}.</p>${i === 0 ? `<p>${OWN_REUSED}</p>` : ''}<p>${BOILER}</p>`,
        },
      });
    }
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('collects every kind of source and shows the evidence without a verdict', async () => {
    const steps: string[] = [];
    const r = await runPlagiarismCheck(
      { html: ARTICLE, keyword: 'Sydney Sweeney', language: 'English', urls: ['https://missing.example/page'], sources: { own: true, links: true, wikipedia: true, google: true } },
      deps,
      async (s) => {
        steps.push(s);
      },
    );
    expect(steps[0]).toBe('Reading your own articles');

    // Own hosts are never fetched; linked pages, the added address and Google hits are.
    expect(fetched).not.toContain('https://www.myblog.example/older-post');
    expect(fetched).not.toContain('https://myblog.example/x');
    expect(fetched).toEqual(expect.arrayContaining(['https://source.example/news/sweeney', 'https://files.example/doc.pdf', 'https://missing.example/page', 'https://google-hit.example/story']));
    expect(r.problems.map((p) => [p.kind, p.url, p.reason])).toEqual(
      expect.arrayContaining([
        ['linked', 'https://files.example/doc.pdf', 'not a web page (application/pdf)'],
        ['url', 'https://missing.example/page', 'HTTP 404'],
      ]),
    );

    const byKind = (k: string) => r.sources.filter((s) => s.kind === k);
    const linked = byKind('linked')[0]!;
    expect(linked.title).toBe('Sweeney report');
    expect(linked.passages.filter((p) => p.counted).map((p) => p.articleText)).toEqual([COPIED.replace(/\.$/, '')]);

    const own = byKind('own');
    expect(own).toHaveLength(6);
    const person0 = own.find((s) => s.title === 'Person 0 Biography')!;
    expect(person0.url).toMatch(/^\/articles\//);
    expect(person0.passages.find((p) => p.counted)!.articleText).toBe(OWN_REUSED.replace(/\.$/, ''));
    // The sign-off line is in every own article: shown, never counted.
    for (const s of own) expect(s.passages.filter((p) => p.why === 'boilerplate').length).toBe(1);
    expect(r.boilerplate).toBeGreaterThan(0);

    const wiki = byKind('wikipedia')[0]!;
    expect(wiki.url).toBe('https://en.wikipedia.org/wiki/Sydney_Sweeney');
    expect(wiki.passages[0]).toMatchObject({ kind: 'close', counted: true });

    expect(byKind('google')[0]!.title).toBe('Fan page');
    expect(r.googleSearches).toBe(searches.length);
    expect(searches.length).toBeGreaterThan(0);
    expect(searches.length).toBeLessThanOrEqual(10);
    for (const q of searches) expect(q).toMatch(/^"[^"\d]+"$/);
    expect(r.checked).toMatchObject({ own: 6, linked: 1, url: 0, wikipedia: 1, google: 1 });
    expect(r.countedWords).toBeGreaterThan(0);
    expect(r.countedWords).toBeLessThan(r.articleWords);
    expect(JSON.stringify(r)).not.toMatch(/percent|plagiarized/i);
  });

  it('skips Google when no key is set and refuses an article that is too short', async () => {
    searches.length = 0;
    const r = await runPlagiarismCheck({ html: ARTICLE, language: 'English', urls: [], sources: { own: false, links: false, wikipedia: false, google: true } }, { ...deps, search: null });
    expect(searches).toHaveLength(0);
    expect(r.sources).toHaveLength(0);
    await expect(runPlagiarismCheck({ html: '<p>Too short.</p>', language: 'English', urls: [], sources: { own: true, links: true, wikipedia: true, google: false } }, deps)).rejects.toThrow(/too short/);
  });
});
