import type { Page } from 'playwright';
import type { Website } from '@prisma/client';
import { findFirst, selectorsFor } from '../selectors';
import { openAdmin } from './session';

export type RankMathTest = { text: string; status: 'ok' | 'fail' | 'warning' };
export type RankMathReading = { score: number | null; tests: RankMathTest[]; focusKeyword: string | null; editor: 'block' | 'classic' | 'unknown' };

/** "andre rock 79" → keyword plus a score is fine; any other extra words are not. */
export function focusKeywordMatches(shown: string, keyword: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
  const s = norm(shown).replace(/\s*\d{1,3}\s*$/, '');
  return s === norm(keyword);
}

export function parseScore(text: string | null | undefined): number | null {
  const m = /(\d{1,3})\s*(?:\/\s*100)?/.exec(text ?? '');
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 0 && n <= 100 ? n : null;
}

async function dismissGuides(page: Page) {
  for (let i = 0; i < 3; i++) {
    const close = await findFirst(page, 'wp.welcomeGuideClose', { visible: true });
    if (!close) break;
    await close.click({ timeout: 3000 }).catch(() => undefined);
    await page.waitForTimeout(300);
  }
  await page.keyboard.press('Escape').catch(() => undefined);
}

/** Opens the post in the editor and reads Rank Math's own score, test results and focus keyword. */
export async function readRankMath(page: Page, website: Website, postId: number, timeoutMs = 60_000): Promise<RankMathReading> {
  await openAdmin(page, website, `post.php?post=${postId}&action=edit`);
  await dismissGuides(page);
  const isBlock = !!(await findFirst(page, 'wp.blockEditor', { timeoutMs: 15_000 }));
  const scoreEl = await findFirst(page, 'rankmath.score', { timeoutMs });
  if (!scoreEl) return { score: null, tests: [], focusKeyword: null, editor: isBlock ? 'block' : 'classic' };

  // Rank Math analyses asynchronously: wait until the number stays the same for 3 s.
  let last: number | null = null;
  let stableSince = Date.now();
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const el = (await findFirst(page, 'rankmath.score')) ?? scoreEl;
    const v = parseScore(await el.textContent().catch(() => null));
    if (v !== last) {
      last = v;
      stableSince = Date.now();
    } else if (v !== null && Date.now() - stableSince > 3000) break;
    await page.waitForTimeout(500);
  }

  // Open the Rank Math panel (block editor) and expand its sections to read the tests.
  if (isBlock) {
    const btn = await findFirst(page, 'rankmath.toolbarButton', { visible: true });
    if (btn) await btn.click({ timeout: 5000 }).catch(() => undefined);
    await page.waitForTimeout(800);
    await page
      .evaluate(() => {
        document.querySelectorAll('.rank-math-sidebar-panel .components-panel__body:not(.is-opened) > h2 button, .rank-math-checklist-wrapper .components-panel__body:not(.is-opened) button').forEach((b) => (b as HTMLButtonElement).click());
      })
      .catch(() => undefined);
    await page.waitForTimeout(600);
  }
  const tests = await page.evaluate(() => {
    const out: { text: string; status: 'ok' | 'fail' | 'warning' }[] = [];
    document.querySelectorAll('.rank-math-checklist li, .rank-math-test, li[class*="test-"]').forEach((li) => {
      const cls = li.className || '';
      const status = /test-fail|is-fail|error/.test(cls) ? 'fail' : /test-warning|warning/.test(cls) ? 'warning' : /test-ok|is-ok|ok/.test(cls) ? 'ok' : null;
      const text = (li.textContent || '').replace(/\s+/g, ' ').trim();
      if (status && text && !out.some((o) => o.text === text)) out.push({ text: text.slice(0, 300), status });
    });
    return out;
  });
  let focusKeyword: string | null = null;
  for (const sel of await selectorsFor('rankmath.focusKeywordTag')) {
    const t = await page.locator(sel).first().textContent({ timeout: 1000 }).catch(() => null);
    if (t && t.trim()) {
      focusKeyword = t.trim();
      break;
    }
  }
  return { score: last, tests, focusKeyword, editor: isBlock ? 'block' : 'classic' };
}

export type FixPlan = { seoTitle: boolean; meta: boolean; slug: boolean; content: boolean; unfixable: string[] };

/** Maps failed Rank Math tests (English and German UI) to the safe fixes the app can apply. */
export function planFixes(tests: RankMathTest[]): FixPlan {
  const plan: FixPlan = { seoTitle: false, meta: false, slug: false, content: false, unfixable: [] };
  for (const t of tests) {
    if (t.status === 'ok') continue;
    const s = t.text.toLowerCase();
    if (/(seo title|seo-titel|titel)/.test(s) && /(focus keyword|fokus-keyword|keyword)/.test(s) && !/(power word|number|sentiment|zahl|emotional)/.test(s)) plan.seoTitle = true;
    else if (/(meta description|meta-beschreibung|metabeschreibung)/.test(s)) plan.meta = true;
    else if (/\burl\b|permalink/.test(s) && /(focus keyword|keyword|short|kurz|long|lang)/.test(s)) plan.slug = true;
    else if (/(introduction|beginning of your content|first 10%|subheading|zwischenüberschrift|keyword density|keyword-dichte|content is \d+ words|inhalt ist|einleitung|anfang)/.test(s)) plan.content = true;
    else plan.unfixable.push(t.text);
  }
  return plan;
}
