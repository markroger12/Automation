import { spawn } from 'node:child_process';
import path from 'node:path';
import { prisma } from '@/server/db';
import { CHATGPT_CHROME_DIR, appUrl, ensureDir } from '@/server/env';
import { findChromeExecutable } from '@/server/chrome-path';
import { writeLog } from '@/server/log';
import { EXTENSION_STATUS_ID, EXTENSION_ONLINE_MS } from '@/server/status';
import { parseJson } from '@/lib/json';
import { listProcesses, stopProcess } from './process-list';
import { currentSettings, sleep } from './runtime';
import { ConfigError } from '@/server/errors';

/**
 * Flags that keep ChatGPT drawing while the window is behind other windows.
 * The extension is installed once by hand (Load unpacked); recent Chrome ignores --load-extension.
 */
export const AUTOMATION_CHROME_FLAGS = [
  '--disable-features=CalculateNativeWinOcclusion',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
  '--disable-background-timer-throttling',
  '--no-first-run',
  '--no-default-browser-check',
];

function normalise(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

/** Main Chrome processes started with our --user-data-dir (renderers carry --type=…). */
export async function findAutomationChromeProcesses(): Promise<number[]> {
  const dir = normalise(path.resolve(CHATGPT_CHROME_DIR));
  const procs = await listProcesses(process.platform === 'win32' ? 'chrome.exe' : 'chrom');
  return procs
    .filter((p) => {
      const cmd = p.commandLine.replace(/\\/g, '/').toLowerCase();
      return cmd.includes(dir) && !/--type=/.test(cmd);
    })
    .map((p) => p.pid);
}

export async function extensionOnline(): Promise<{ online: boolean; version: string | null }> {
  const row = await prisma.workerStatus.findUnique({ where: { id: EXTENSION_STATUS_ID } });
  const info = parseJson<{ version?: string }>(row?.info, {});
  return { online: !!row && Date.now() - row.lastSeenAt.getTime() < EXTENSION_ONLINE_MS, version: info.version ?? null };
}

/** Starts the Automation Chrome (or, in "profile" mode, the usual Chrome) on the setup page. */
export async function openAutomationChrome(opts: { force?: boolean } = {}): Promise<{ started: boolean; message: string }> {
  const settings = await currentSettings();
  const chrome = findChromeExecutable();
  if (!chrome) throw new ConfigError('Google Chrome was not found. Install it or set CHROME_PATH in .env.');
  const startUrl = `${appUrl()}/automation-chrome`;
  let args: string[];
  if (settings.chatgptChromeMode === 'separate') {
    const running = await findAutomationChromeProcesses();
    if (running.length > 0 && !opts.force) return { started: false, message: 'The Automation Chrome is already running.' };
    ensureDir(CHATGPT_CHROME_DIR);
    args = [`--user-data-dir=${path.resolve(CHATGPT_CHROME_DIR)}`, ...AUTOMATION_CHROME_FLAGS, startUrl];
  } else {
    args = [startUrl];
  }
  const child = spawn(chrome, args, { detached: true, stdio: 'ignore', windowsHide: false });
  child.on('error', (err) => void writeLog({ level: 'ERROR', category: 'BROWSER', message: `Could not start Chrome: ${err.message}` }));
  child.unref();
  await writeLog({ category: 'BROWSER', message: `Opened the Automation Chrome (${settings.chatgptChromeMode} mode).` });
  return { started: true, message: 'Chrome started.' };
}

/**
 * Restart = close the main chrome process politely (no /F), start it again, then wait until the extension
 * reports in. Refused while a ChatGPT prompt is running: a restart fails it and reloads every tab.
 */
export async function restartAutomationChrome(): Promise<{ message: string }> {
  const active = await prisma.queueJob.count({ where: { queue: 'chatgpt', status: 'ACTIVE' } });
  if (active > 0) throw new Error(`${active} ChatGPT prompt(s) are running. Restart when they are finished.`);
  const before = await extensionOnline();
  const pids = await findAutomationChromeProcesses();
  for (const pid of pids) await stopProcess(pid);
  for (let i = 0; i < 20 && (await findAutomationChromeProcesses()).length > 0; i++) await sleep(500);
  await openAutomationChrome({ force: true });
  const startedAt = Date.now();
  while (Date.now() - startedAt < 90_000) {
    await sleep(3000);
    const row = await prisma.workerStatus.findUnique({ where: { id: EXTENSION_STATUS_ID } });
    if (row && row.lastSeenAt.getTime() > startedAt) {
      const v = parseJson<{ version?: string }>(row.info, {}).version ?? '?';
      await writeLog({ category: 'BROWSER', message: `Automation Chrome restarted; extension v${v} reported in (was v${before.version ?? '?'}).` });
      return { message: `Restarted. Extension v${v} is online.` };
    }
  }
  return { message: 'Chrome was restarted, but the extension has not reported in yet. Check the Automation Chrome window.' };
}
