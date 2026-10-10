import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

/** Creates a fresh migrated SQLite database and points DATABASE_URL at it (call before importing server code). */
export function setupTestDb(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bas-test-'));
  const file = path.join(dir, 'test.db').replace(/\\/g, '/');
  const url = `file:${file}`;
  process.env.DATABASE_URL = url;
  process.env.LOG_SILENT = '1';
  if (!process.env.SESSION_SECRET) process.env.SESSION_SECRET = 'test-secret-test-secret-test-secret';
  const cli = require.resolve('prisma/build/index.js');
  execFileSync(process.execPath, [cli, 'migrate', 'deploy'], { env: { ...process.env, DATABASE_URL: url }, stdio: 'ignore' });
  return file;
}
