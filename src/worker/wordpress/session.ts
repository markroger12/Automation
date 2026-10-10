import type { BrowserContext, Page } from 'playwright';
import type { Website } from '@prisma/client';
import { prisma } from '@/server/db';
import { LoginRequiredError } from '@/server/errors';
import { writeLog } from '@/server/log';
import { checkPublishRequest } from '@/core/publish-guard';
import { findFirst } from '../selectors';
import { captureScreenshot } from '../screenshots';
import { currentSettings } from '../runtime';
import { wpRest, wpRestOk, siteBaseFromAdmin } from './rest';

const guarded = new WeakSet<BrowserContext>();
const allowByContext = new WeakMap<BrowserContext, string[]>();

/**
 * Network-level publish guard: aborts every editor request that would publish, schedule, make private or
 * submit for review. Installed on every WordPress browser context.
 */
export async function installPublishGuard(context: BrowserContext, taskId?: string | null): Promise<void> {
  if (guarded.has(context)) return;
  guarded.add(context);
  await context.route(
    (url) => /\/wp-json\/|rest_route=|\/wp-admin\/|\/xmlrpc\.php/i.test(url.toString()),
    async (route) => {
      const req = route.request();
      if (req.method() === 'GET' || req.method() === 'HEAD' || req.method() === 'OPTIONS') return route.fallback();
      const decision = checkPublishRequest(
        { method: req.method(), url: req.url(), body: req.postData(), headers: req.headers() },
        { allowedStatuses: allowByContext.get(context) ?? [] },
      );
      if (decision.block) {
        await writeLog({ level: 'WARN', category: 'WORDPRESS', taskId, message: `Publish guard blocked a request: ${decision.reason}`, data: { url: req.url() } });
        return route.abort('blockedbyclient');
      }
      return route.fallback();
    },
  );
}

/** Only the Workflow scheduler calls this, for a website whose owner allowed it to publish by itself. */
export function allowStatusesFor(context: BrowserContext, statuses: string[]): void {
  allowByContext.set(context, statuses);
}

/**
 * Navigation that tolerates hosts that never finish loading every asset: commit, then wait at most 30 s for
 * DOMContentLoaded and carry on with a warning.
 */
export async function open(page: Page, url: string, taskId?: string | null): Promise<void> {
  const settings = await currentSettings();
  await page.goto(url, { waitUntil: 'commit', timeout: settings.browserTimeoutSec * 1000 });
  try {
    await page.waitForLoadState('domcontentloaded', { timeout: 30_000 });
  } catch {
    await writeLog({ level: 'WARN', category: 'BROWSER', taskId, message: `${new URL(url).host} did not finish loading within 30 s; continuing.` });
  }
}

export async function isLoginPage(page: Page): Promise<boolean> {
  if (/wp-login\.php/i.test(page.url())) return true;
  return !!(await findFirst(page, 'wp.loginForm'));
}

/** Opens wp-admin and makes sure the profile is logged in. Throws LoginRequiredError otherwise. */
export async function openAdmin(page: Page, website: Pick<Website, 'adminUrl' | 'name'>, path = '', taskId?: string | null): Promise<void> {
  const base = website.adminUrl.replace(/\/+$/, '');
  await open(page, path ? `${base}/${path.replace(/^\/+/, '')}` : `${base}/`, taskId);
  if (await isLoginPage(page)) {
    const shot = await captureScreenshot(page, 'wordpress-login-required', taskId);
    throw new LoginRequiredError('wordpress', `WordPress (${website.name}) asks for a login. Open Websites → Login, log in and close the window.`, shot);
  }
  const admin = await findFirst(page, 'wp.adminBar', { timeoutMs: 15_000 });
  if (!admin) {
    const shot = await captureScreenshot(page, 'wordpress-error', taskId);
    throw new Error(`The WordPress admin of ${website.name} did not load (no admin bar). Screenshot: ${shot ?? 'off'}`);
  }
}

export type SessionCheck = { ok: boolean; detail: string; userName?: string; screenshot?: string | null };

export async function checkSession(page: Page, website: Pick<Website, 'adminUrl' | 'name'>): Promise<SessionCheck> {
  try {
    await openAdmin(page, website);
    const me = await wpRest<{ name?: string; capabilities?: Record<string, boolean> }>(page, website.adminUrl, { path: '/wp/v2/users/me', query: { context: 'edit' } });
    if (!me.ok) return { ok: true, detail: `Logged in (REST user check returned ${me.status}).` };
    const caps = me.data?.capabilities ?? {};
    const canEdit = caps.edit_posts !== false;
    return { ok: true, detail: `Logged in as ${me.data?.name ?? 'unknown'}${canEdit ? '' : ' (cannot edit posts!)'}.`, userName: me.data?.name };
  } catch (err) {
    if (err instanceof LoginRequiredError) return { ok: false, detail: err.message, screenshot: err.screenshotPath };
    return { ok: false, detail: err instanceof Error ? err.message : String(err), screenshot: await captureScreenshot(page, 'wordpress-error') };
  }
}

type WpCategory = { id: number; name: string; slug: string; parent: number };

/** Reads every category from WordPress and mirrors it into the Category table. */
export async function syncCategories(page: Page, website: Website): Promise<{ count: number; added: number; removed: number }> {
  const all: WpCategory[] = [];
  for (let p = 1; p <= 20; p++) {
    const res = await wpRest<WpCategory[]>(page, website.adminUrl, { path: '/wp/v2/categories', query: { per_page: 100, page: p, _fields: 'id,name,slug,parent', context: 'edit' } });
    if (!res.ok) {
      if (p > 1 && res.status === 400) break;
      throw new Error(`Could not read categories (${res.status}).`);
    }
    all.push(...(res.data ?? []));
    if (!res.totalPages || p >= res.totalPages) break;
  }
  const decode = (s: string) => s.replace(/&amp;/g, '&').replace(/&#039;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  const existing = await prisma.category.findMany({ where: { websiteId: website.id } });
  let added = 0;
  const seen = new Set<string>();
  for (const c of all) {
    const name = decode(c.name).trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const match = existing.find((e) => e.wpId === c.id) ?? existing.find((e) => e.name === name);
    if (match) {
      await prisma.category.update({ where: { id: match.id }, data: { name, wpId: c.id, slug: c.slug, parentWpId: c.parent || null } });
    } else {
      await prisma.category.create({ data: { websiteId: website.id, name, wpId: c.id, slug: c.slug, parentWpId: c.parent || null } });
      added++;
    }
  }
  // Remove categories that no longer exist in WordPress (task rows keep their categoryName snapshot).
  const stale = existing.filter((e) => e.wpId !== null && !all.some((c) => c.id === e.wpId) && !seen.has(e.name));
  if (stale.length) await prisma.category.deleteMany({ where: { id: { in: stale.map((s) => s.id) } } });
  return { count: seen.size, added, removed: stale.length };
}

/** Reads the site's time zone (Settings → General) the first time; used to convert Pakistan time. */
export async function detectTimezone(page: Page, website: Website): Promise<string | null> {
  const res = await wpRest<{ timezone?: string }>(page, website.adminUrl, { path: '/wp/v2/settings', query: { _fields: 'timezone' } });
  let tz = res.ok ? res.data?.timezone || null : null;
  if (!tz) {
    await openAdmin(page, website, 'options-general.php');
    tz = await page.evaluate(() => {
      const sel = document.querySelector('#timezone_string') as HTMLSelectElement | null;
      const v = sel?.value ?? '';
      return v || null;
    });
  }
  if (tz) await prisma.website.update({ where: { id: website.id }, data: { siteTimezone: tz } });
  return tz;
}

export async function siteHomeUrl(website: Pick<Website, 'url' | 'adminUrl'>): Promise<string> {
  return (website.url || siteBaseFromAdmin(website.adminUrl)).replace(/\/+$/, '');
}

export { wpRestOk };
