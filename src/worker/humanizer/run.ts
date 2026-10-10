import { blocksToHtml } from '@/core/html';
import { isInternalLinkBlock } from '@/core/assembly';
import { renderTemplate } from '@/core/template';
import type { Lang } from '@/core/language';
import { articleNotes, checkLocks, decodeParagraph, humanizableParagraphs, paragraphsBlock, parseLabeledAnswer, plainOf, problemsBlock, sentenceRhythm, signalDensity, splitIntoParts } from '@/core/humanizer';
import { ConfigError, LoginRequiredError, TaskCancelledError, UsageLimitError } from '@/server/errors';
import { WorkerStoppingError } from '../chatgpt/client';

export type ParagraphReport = { n: number; status: 'rewritten' | 'kept'; reason?: string; warnings?: string[]; before: string; after: string; problems: string[] };
export type HumanizeReport = {
  paragraphs: ParagraphReport[];
  rewritten: number;
  kept: number;
  densityBefore: number;
  densityAfter: number;
  rhythmBefore: number;
  rhythmAfter: number;
  parts: number;
  failedParts: number;
  notes: string[];
};

export type HumanizeOptions = {
  html: string;
  keyword: string;
  language: Lang;
  promptTemplate: string;
  mode: 'every' | 'flagged';
  linkText?: string;
  send: (prompt: string, partIndex: number, partCount: number) => Promise<string>;
  /** Accepted rewrites per part saved earlier (resume after a crash) */
  resume?: Record<string, Record<string, string>>;
  onPart?: (partIndex: number, accepted: Record<string, string>) => Promise<void>;
  log: (level: 'info' | 'warn', message: string, data?: unknown) => Promise<void>;
};

const STOP = (e: unknown) => e instanceof LoginRequiredError || e instanceof TaskCancelledError || e instanceof UsageLimitError || e instanceof ConfigError || e instanceof WorkerStoppingError;

/** Rewrites the paragraphs part by part; a rewrite that breaks a fact lock keeps the original paragraph. */
export async function humanizeHtml(opts: HumanizeOptions): Promise<{ html: string; report: HumanizeReport }> {
  const { blocks, paragraphs } = humanizableParagraphs(opts.html, opts.language, (b) => isInternalLinkBlock(b, opts.linkText));
  const texts = paragraphs.map((p) => plainOf(p.encoded.text));
  const notes = articleNotes(texts, opts.language);
  const targets = opts.mode === 'flagged' ? paragraphs.filter((p) => p.analysis.problems.length) : paragraphs;
  const parts = splitIntoParts(targets);
  const accepted = new Map<number, string>();
  const reports = new Map<number, ParagraphReport>();
  let failedParts = 0;

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    const saved = opts.resume?.[String(i)];
    let answers: Map<number, string> | null = null;
    if (saved) {
      answers = new Map(Object.entries(saved).map(([k, v]) => [Number(k), v]));
    } else {
      const prompt = renderTemplate(opts.promptTemplate, { keyword: opts.keyword, problems: problemsBlock(part, notes), paragraphs: paragraphsBlock(part) });
      try {
        answers = parseLabeledAnswer(await opts.send(prompt, i, parts.length));
      } catch (err) {
        if (STOP(err)) throw err;
        failedParts++;
        await opts.log('warn', `Humanizer part ${i + 1}/${parts.length} failed; its paragraphs stay as they were: ${err instanceof Error ? err.message : err}`);
        for (const p of part) reports.set(p.n, { n: p.n, status: 'kept', reason: 'part failed', before: plainOf(p.encoded.text), after: plainOf(p.encoded.text), problems: p.analysis.problems });
        continue;
      }
    }
    const ok: Record<string, string> = {};
    for (const p of part) {
      const rewritten = answers.get(p.n);
      const before = plainOf(p.encoded.text);
      if (!rewritten) {
        reports.set(p.n, { n: p.n, status: 'kept', reason: 'missing in the answer', before, after: before, problems: p.analysis.problems });
        continue;
      }
      const lock = checkLocks(p.encoded.text, rewritten, opts.keyword, opts.language);
      if (!lock.ok) {
        reports.set(p.n, { n: p.n, status: 'kept', reason: lock.reason, warnings: lock.warnings, before, after: plainOf(rewritten), problems: p.analysis.problems });
        continue;
      }
      accepted.set(p.n, rewritten);
      ok[String(p.n)] = rewritten;
      reports.set(p.n, { n: p.n, status: 'rewritten', warnings: lock.warnings.length ? lock.warnings : undefined, before, after: plainOf(rewritten), problems: p.analysis.problems });
    }
    if (!saved && opts.onPart) await opts.onPart(i, ok);
  }

  const out = blocks.map((b) => ({ ...b }));
  for (const p of paragraphs) {
    const r = accepted.get(p.n);
    if (r) out[p.blockIndex] = { ...out[p.blockIndex]!, html: decodeParagraph(r, p.encoded.links) };
  }
  const afterTexts = paragraphs.map((p) => plainOf(accepted.get(p.n) ?? p.encoded.text));
  const all = paragraphs.map((p) => reports.get(p.n) ?? { n: p.n, status: 'kept' as const, reason: opts.mode === 'flagged' ? 'nothing to fix' : undefined, before: plainOf(p.encoded.text), after: plainOf(p.encoded.text), problems: p.analysis.problems });
  return {
    html: blocksToHtml(out),
    report: {
      paragraphs: all,
      rewritten: all.filter((r) => r.status === 'rewritten').length,
      kept: all.filter((r) => r.status === 'kept').length,
      densityBefore: signalDensity(texts, opts.language),
      densityAfter: signalDensity(afterTexts, opts.language),
      rhythmBefore: sentenceRhythm(texts).cv,
      rhythmAfter: sentenceRhythm(afterTexts).cv,
      parts: parts.length,
      failedParts,
      notes,
    },
  };
}
