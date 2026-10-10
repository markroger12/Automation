import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import sharp from 'sharp';
import { chromium, type BrowserContext, type Worker } from 'playwright';

export const EXTENSION_DIR = path.resolve(__dirname, '..', '..', 'extension');

/**
 * Branded Chrome ignores --load-extension, so the browser tests use Chromium (Playwright's, CHROME_FOR_TESTS,
 * or EXTENSION_TEST_BROWSER) and fall back to Edge. Returns null when none is available (tests are skipped).
 */
export function findExtensionBrowser(): { executablePath?: string; channel?: string } | null {
  const env = process.env.EXTENSION_TEST_BROWSER;
  if (env && fs.existsSync(env)) return { executablePath: env };
  try {
    const p = chromium.executablePath();
    if (p && fs.existsSync(p)) return { executablePath: p };
  } catch {
    // not installed
  }
  for (const p of ['/opt/pw-browsers/chromium', process.env.CHROME_PATH ?? '']) {
    if (p && fs.existsSync(p) && /chromium/i.test(p)) return { executablePath: p };
  }
  const edge = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/microsoft-edge',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  ].find((p) => fs.existsSync(p));
  if (edge) return { executablePath: edge };
  return null;
}

export async function launchWithExtension(target: { executablePath?: string; channel?: string }): Promise<{ context: BrowserContext; sw: Worker; dir: string }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bas-ext-'));
  const context = await chromium.launchPersistentContext(dir, {
    ...target,
    headless: process.env.HEADED ? false : true,
    args: [`--disable-extensions-except=${EXTENSION_DIR}`, `--load-extension=${EXTENSION_DIR}`, '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
    viewport: { width: 1200, height: 900 },
  });
  let sw = context.serviceWorkers()[0];
  if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 20_000 });
  return { context, sw, dir };
}

/** Tiny HTTP server: the real agent handler plus test pictures. */
export async function startAgentServer(handler: (body: unknown, auth: string | undefined) => Promise<{ status: number; json: unknown }>) {
  const pictures = new Map<string, Buffer>();
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (url.pathname.startsWith('/img/')) {
      let buf = pictures.get(url.pathname);
      if (!buf) {
        buf = await sharp({ create: { width: 1000, height: 800, channels: 3, background: { r: 200, g: 80, b: 40 } } }).png().toBuffer();
        pictures.set(url.pathname, buf);
      }
      res.writeHead(200, { 'Content-Type': 'image/png', 'Access-Control-Allow-Origin': '*' });
      return res.end(buf);
    }
    if (url.pathname === '/automation-chrome') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end('<!doctype html><title>Automation Chrome</title><h1>Automation Chrome</h1>');
    }
    if (url.pathname === '/api/extension/agent' && req.method === 'POST') {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      let body: unknown = {};
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        body = {};
      }
      try {
        const out = await handler(body, req.headers.authorization);
        res.writeHead(out.status, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(out.json));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: String(err) }));
      }
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  return { url: `http://127.0.0.1:${port}`, port, close: () => new Promise<void>((r) => server.close(() => r())) };
}

export function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
