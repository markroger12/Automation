/**
 * npm run setup — safe to re-run.
 * 1. creates .env with a random SESSION_SECRET  2. creates data/  3. runs migrations
 * 4. seeds settings and prompts  5. checks Chrome is installed
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const envFile = path.join(root, '.env');
const exampleFile = path.join(root, '.env.example');

function step(msg: string) {
  console.log(`\x1b[36m›\x1b[0m ${msg}`);
}

function ensureEnv() {
  let text = fs.existsSync(envFile) ? fs.readFileSync(envFile, 'utf8') : fs.existsSync(exampleFile) ? fs.readFileSync(exampleFile, 'utf8') : '';
  const created = !fs.existsSync(envFile);
  const has = (k: string) => new RegExp(`^${k}=`, 'm').test(text);
  const value = (k: string) => new RegExp(`^${k}="?([^"\\n]*)"?`, 'm').exec(text)?.[1] ?? '';
  if (!has('DATABASE_URL')) text += `\nDATABASE_URL="file:../data/app.db"\n`;
  const secret = crypto.randomBytes(48).toString('base64url');
  if (!has('SESSION_SECRET')) text += `\nSESSION_SECRET="${secret}"\n`;
  else if (value('SESSION_SECRET').length < 16) text = text.replace(/^SESSION_SECRET=.*$/m, `SESSION_SECRET="${secret}"`);
  if (!has('BROWSER_CHANNEL')) text += `BROWSER_CHANNEL="chrome"\n`;
  if (!has('APP_URL')) text += `APP_URL="http://localhost:3000"\n`;
  fs.writeFileSync(envFile, text.replace(/\n{3,}/g, '\n\n'));
  step(created ? 'Created .env with a random SESSION_SECRET' : '.env is ready');
}

function ensureDirs() {
  for (const d of ['data', 'data/profiles', 'data/screenshots', 'data/media', 'data/logos', 'data/tools', 'data/cache', 'data/chatgpt-chrome']) {
    fs.mkdirSync(path.join(root, d), { recursive: true });
  }
  step('data/ folders are ready (keep data/ private: it holds your browser logins)');
}

function prisma(args: string[]) {
  const cli = require.resolve('prisma/build/index.js');
  const res = spawnSync(process.execPath, [cli, ...args], { stdio: 'inherit', cwd: root, env: process.env });
  if (res.status !== 0) throw new Error(`prisma ${args.join(' ')} failed`);
}

async function main() {
  ensureEnv();
  ensureDirs();
  const { loadEnv } = await import('../src/server/env');
  loadEnv();

  if (!fs.existsSync(path.join(root, 'node_modules', '.prisma', 'client', 'index.js'))) {
    step('Generating the database client');
    prisma(['generate']);
  }
  step('Running database migrations');
  prisma(['migrate', 'deploy']);

  const { seedSettings } = await import('../src/server/settings');
  const { seedPrompts } = await import('../src/server/prompts');
  const { prisma: db } = await import('../src/server/db');
  const s = await seedSettings();
  const p = await seedPrompts();
  step(`Settings: ${s} new default(s). Prompts: ${p.created} created, ${p.updated} updated, ${p.kept} kept as you edited them.`);
  const users = await db.user.count();
  await db.$disconnect();

  const { findChromeExecutable } = await import('../src/server/chrome-path');
  const chrome = findChromeExecutable();
  if (chrome) step(`Google Chrome found: ${chrome}`);
  else console.warn('\x1b[33m!\x1b[0m Google Chrome was not found. Install it from https://www.google.com/chrome/ (or set CHROME_PATH in .env).');

  console.log('\n\x1b[32mSetup complete.\x1b[0m Start the app with: npm run dev:all');
  if (users === 0) console.log('Then open http://localhost:3000 and create the admin account.');
}

main().catch((err) => {
  console.error('\x1b[31mSetup failed:\x1b[0m', err instanceof Error ? err.message : err);
  process.exit(1);
});
