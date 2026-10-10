import type { Page, Locator } from 'playwright';
import { parseSelectorOverrides } from '@/lib/settings-schema';
import { currentSettings } from './runtime';

/**
 * Every selector the worker relies on, with several fallbacks per element.
 * User overrides (Settings → Advanced, JSON) are tried first.
 */
export const SELECTORS: Record<string, string[]> = {
  'wp.loginForm': ['#loginform', 'form[name="loginform"]', '#user_login', 'input[name="log"]'],
  'wp.adminBar': ['#wpadminbar', 'body.wp-admin #adminmenu', '#adminmenumain'],
  'wp.blockEditor': ['.editor-editor-interface', '.edit-post-layout', '.block-editor', '.block-editor-writing-flow'],
  'wp.classicEditor': ['#post-body #postdivrich', 'textarea#content.wp-editor-area', '#titlediv #title'],
  'wp.saveDraft': ['button.editor-post-save-draft', '.editor-post-save-draft', 'button:has-text("Save draft")', 'button:has-text("Entwurf speichern")', '#save-post'],
  'wp.welcomeGuideClose': ['.edit-post-welcome-guide button[aria-label="Close"]', '.components-modal__frame button[aria-label="Close"]', '.components-guide button[aria-label="Close"]'],
  'rankmath.score': [
    '.rank-math-toolbar-score .score-text',
    '.rank-math-toolbar-score',
    '.rank-math-score .score-text',
    '#rank-math-metabox .rank-math-seo-score .score-text',
    '.rank-math-seo-score .score-text',
    '[class*="rank-math"] .score-text',
  ],
  'rankmath.toolbarButton': ['.rank-math-toolbar-score', 'button[aria-label="Rank Math"]', '.interface-pinned-items button[aria-label*="Rank Math"]'],
  'rankmath.failedTests': ['.rank-math-checklist li.test-fail', '.rank-math-checklist .test-fail', '#rank-math-metabox .test-fail', '.rank-math-test.test-fail'],
  'rankmath.focusKeywordTag': ['.rank-math-focus-keyword .tagify__tag', '.rank-math-focus-keyword tag', '#rank-math-metabox .tagify__tag'],
  'gsc.inspectInput': ['input[aria-label*="Inspect any URL"]', 'input[placeholder*="Inspect any URL"]', 'input[type="text"][aria-label*="URL"]'],
  'gsc.requestIndexing': [
    'span:has-text("Request indexing")',
    'div[role="button"]:has-text("Request indexing")',
    'button:has-text("Request indexing")',
    'span:has-text("Indexierung beantragen")',
  ],
  'gsc.requestedDialog': ['text=Indexing requested', 'text=URL was added to a priority crawl queue', 'text=Indexierung beantragt'],
  'gsc.quotaExceeded': ['text=Quota exceeded', 'text=Kontingent überschritten'],
  'gsc.signIn': ['text=Sign in', 'input[type="email"]'],
};

/** CSS that hides Hostinger's "Kodee" assistant overlay. <html> and <body> carry kodee classes and must stay visible. */
export const OVERLAY_CSS = `
:not(html):not(body)[class*="kodee" i],
:not(html):not(body)[id*="kodee" i],
:not(html):not(body)[data-testid*="kodee" i] { display: none !important; visibility: hidden !important; pointer-events: none !important; }
`;

export async function selectorsFor(key: string): Promise<string[]> {
  const overrides = parseSelectorOverrides((await currentSettings()).selectorOverrides);
  return [...(overrides[key] ?? []), ...(SELECTORS[key] ?? [])];
}

/** First matching locator (attached) among the fallbacks, or null. */
export async function findFirst(page: Page, key: string, opts: { timeoutMs?: number; visible?: boolean } = {}): Promise<Locator | null> {
  const list = await selectorsFor(key);
  const deadline = Date.now() + (opts.timeoutMs ?? 0);
  do {
    for (const sel of list) {
      try {
        const loc = page.locator(sel).first();
        if ((await loc.count()) > 0 && (!opts.visible || (await loc.isVisible()))) return loc;
      } catch {
        // invalid selector override: skip it
      }
    }
    if (Date.now() >= deadline) break;
    await page.waitForTimeout(400);
  } while (Date.now() < deadline);
  return null;
}
