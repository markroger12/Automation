import { chromium, type BrowserContext, type LaunchOptions } from 'playwright';
import { findChromeExecutable } from '@/server/chrome-path';
import { OVERLAY_CSS } from '../selectors';

export type LaunchMode = 'headless' | 'background' | 'visible';

/** Playwright target: BROWSER_CHANNEL=chrome|msedge|chromium (chromium may use CHROME_PATH). */
export function browserTarget(): Pick<LaunchOptions, 'channel' | 'executablePath'> {
  const channel = (process.env.BROWSER_CHANNEL || 'chrome').trim().toLowerCase();
  if (channel === 'chromium') {
    const exe = process.env.CHROME_PATH?.trim() || undefined;
    return exe ? { executablePath: exe } : {};
  }
  if (channel === 'chrome' && process.env.CHROME_PATH?.trim()) return { executablePath: findChromeExecutable() ?? undefined };
  return { channel };
}

export function launchArgs(mode: LaunchMode): string[] {
  // QUIC caused intermittent hangs on Hostinger.
  const args = ['--disable-quic', '--no-first-run', '--no-default-browser-check', '--disable-features=Translate'];
  if (mode === 'background') args.push('--window-position=-32000,-32000', '--window-size=1400,950');
  if (mode === 'visible') args.push('--window-size=1300,900');
  return args;
}

/** Opens a persistent Chrome profile folder (cookies stay between runs; the app never types passwords). */
export async function launchPersistent(userDataDir: string, mode: LaunchMode): Promise<BrowserContext> {
  const context = await chromium.launchPersistentContext(userDataDir, {
    ...browserTarget(),
    headless: mode === 'headless',
    args: launchArgs(mode),
    viewport: mode === 'visible' ? null : { width: 1400, height: 950 },
    ignoreDefaultArgs: ['--enable-automation'],
    acceptDownloads: false,
  });
  await installOverlayHider(context);
  return context;
}

/** A throwaway headless browser for rendering (image templates, face detection). */
export async function launchHeadless(): Promise<import('playwright').Browser> {
  return chromium.launch({ ...browserTarget(), headless: true, args: ['--disable-quic', '--disable-gpu', '--font-render-hinting=none'] });
}

async function installOverlayHider(context: BrowserContext): Promise<void> {
  await context.addInitScript((css: string) => {
    const add = () => {
      if (document.getElementById('__bas_overlay_hider')) return;
      const style = document.createElement('style');
      style.id = '__bas_overlay_hider';
      style.textContent = css;
      (document.head || document.documentElement).appendChild(style);
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', add, { once: true });
    else add();
  }, OVERLAY_CSS);
}
