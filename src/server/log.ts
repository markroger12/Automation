import type { LogCategory, LogLevel } from '@prisma/client';
import { prisma } from './db';
import { redact, redactString } from '@/lib/redact';
import { clipJson } from '@/lib/json';

export type LogInput = {
  taskId?: string | null;
  level?: LogLevel;
  category?: LogCategory;
  stage?: string | null;
  message: string;
  data?: unknown;
  screenshotPath?: string | null;
};

const LEVEL_COLOR: Record<LogLevel, string> = { DEBUG: '\x1b[90m', INFO: '\x1b[36m', WARN: '\x1b[33m', ERROR: '\x1b[31m' };

/** Writes a log row (credential-like fields redacted) and echoes it to the console. Never throws. */
export async function writeLog(input: LogInput): Promise<void> {
  const level = input.level ?? 'INFO';
  const category = input.category ?? 'SYSTEM';
  const message = redactString(input.message).slice(0, 20_000);
  const data = input.data === undefined ? null : clipJson(redact(input.data), 60_000);
  if (process.env.LOG_SILENT !== '1') {
    const prefix = `${LEVEL_COLOR[level]}[${level}]\x1b[0m ${category}${input.stage ? `/${input.stage}` : ''}`;
    const task = input.taskId ? ` (${input.taskId.slice(-6)})` : '';
    console.log(`${prefix}${task} ${message.length > 400 ? message.slice(0, 400) + '…' : message}`);
  }
  try {
    await prisma.log.create({
      data: {
        taskId: input.taskId ?? null,
        level,
        category,
        stage: input.stage ?? null,
        message,
        data,
        screenshotPath: input.screenshotPath ?? null,
      },
    });
  } catch (err) {
    // A deleted task (foreign key) or a locked database must not break the caller.
    if (input.taskId) {
      try {
        await prisma.log.create({
          data: { level, category, stage: input.stage ?? null, message: `[task ${input.taskId}] ${message}`, data },
        });
      } catch {
        console.error('Could not write log', err);
      }
    }
  }
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

/** A logger bound to one task and category. */
export function taskLogger(taskId: string | null, category: LogCategory = 'SYSTEM', stage?: string) {
  const base = { taskId, category, stage };
  return {
    debug: (message: string, data?: unknown) => writeLog({ ...base, level: 'DEBUG', message, data }),
    info: (message: string, data?: unknown) => writeLog({ ...base, level: 'INFO', message, data }),
    warn: (message: string, data?: unknown) => writeLog({ ...base, level: 'WARN', message, data }),
    error: (message: string, data?: unknown) => writeLog({ ...base, level: 'ERROR', message, data }),
  };
}
