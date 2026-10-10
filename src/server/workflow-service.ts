import type { WorkflowKeyword } from '@prisma/client';
import { prisma } from './db';
import { ApiError } from './api';
import { cancelTask, retryTask } from './tasks';
import { isActiveStatus } from '@/lib/status';
import { writeLog } from './log';
import { kindFromRules, parseKeywordCsv, parseKeywordRows, type Kind, type KeywordRow } from '@/core/keyword-kind';
import { MAX_KEYWORDS_PER_ADD } from '@/lib/workflow-schema';

/** Every website has one workflow; it is created (switched off) the first time it is opened. */
export async function getOrCreateWorkflow(websiteId: string) {
  const website = await prisma.website.findUnique({ where: { id: websiteId } });
  if (!website) throw new ApiError(404, 'Website not found.');
  return prisma.workflow.upsert({ where: { websiteId }, create: { websiteId }, update: {} });
}

function normKeyword(k: string): string {
  return k.toLowerCase().replace(/\s+/g, ' ').trim();
}

export async function addKeywords(websiteId: string, input: { text?: string; csv?: string; kind?: 'CELEBRITY' | 'TIGRAM' }) {
  const wf = await getOrCreateWorkflow(websiteId);
  const rows: KeywordRow[] = [...(input.text ? parseKeywordRows(input.text) : []), ...(input.csv ? parseKeywordCsv(input.csv) : [])];
  if (!rows.length) throw new ApiError(400, 'No keywords found. Put one keyword per line.');
  if (rows.length > MAX_KEYWORDS_PER_ADD) throw new ApiError(400, `Add at most ${MAX_KEYWORDS_PER_ADD} keywords at a time.`);

  const existing = await prisma.workflowKeyword.findMany({ where: { workflowId: wf.id }, select: { keyword: true, position: true } });
  const seen = new Set(existing.map((e) => normKeyword(e.keyword)));
  let position = existing.reduce((m, e) => Math.max(m, e.position), 0);
  const duplicates: string[] = [];
  const data = [];
  for (const row of rows) {
    const key = normKeyword(row.keyword);
    if (seen.has(key)) {
      duplicates.push(row.keyword);
      continue;
    }
    seen.add(key);
    let kind: Kind = 'UNKNOWN';
    let kindSource: string | null = null;
    let kindNote: string | null = null;
    if (input.kind) {
      kind = input.kind;
      kindSource = 'manual';
    } else if (row.kind) {
      kind = row.kind;
      kindSource = 'csv';
    } else {
      const r = kindFromRules(row.keyword);
      if (r.kind !== 'UNKNOWN') {
        kind = r.kind;
        kindSource = 'rules';
        kindNote = 'Decided from the wording';
      }
    }
    data.push({
      workflowId: wf.id,
      keyword: row.keyword.slice(0, 200),
      title: row.title?.slice(0, 300) ?? null,
      secondaryKeywords: JSON.stringify(row.secondaryKeywords.slice(0, 20).map((s) => s.slice(0, 120))),
      kind,
      kindSource,
      kindNote,
      position: ++position,
    });
  }
  if (data.length) await prisma.workflowKeyword.createMany({ data });
  return { added: data.length, duplicates };
}

async function loadKeyword(id: string) {
  const kw = await prisma.workflowKeyword.findUnique({ where: { id }, include: { task: true } });
  if (!kw) throw new ApiError(404, 'Keyword not found.');
  return kw;
}

/** Puts a failed or skipped keyword back in line. A draft that already exists is reused, never written twice. */
async function resetKeyword(kw: WorkflowKeyword & { task: { id: string; status: string; wpPostId: number | null } | null }) {
  const base = { publishAt: null, lastError: null, attempts: 0, indexAttempts: 0, nextIndexAt: null };
  const t = kw.task;
  if (t && (t.status === 'DRAFT_CREATED' || t.status === 'NEEDS_REVIEW')) {
    return prisma.workflowKeyword.update({ where: { id: kw.id }, data: { ...base, state: 'READY' } });
  }
  if (t && (t.status === 'FAILED' || t.status === 'CANCELLED')) {
    await retryTask(t.id);
    return prisma.workflowKeyword.update({ where: { id: kw.id }, data: { ...base, state: 'WRITING', attempts: 1 } });
  }
  if (t) {
    // Still being written (for example after it was skipped mid-way): follow it again.
    return prisma.workflowKeyword.update({ where: { id: kw.id }, data: { ...base, state: 'WRITING', attempts: 1 } });
  }
  return prisma.workflowKeyword.update({ where: { id: kw.id }, data: { ...base, state: 'WAITING' } });
}

export async function patchKeyword(id: string, input: { kind?: 'CELEBRITY' | 'TIGRAM'; state?: 'WAITING' | 'SKIPPED'; title?: string | null; move?: 'up' | 'down' | 'top' }) {
  let kw = await loadKeyword(id);
  const startedStates = ['WRITING', 'READY', 'SCHEDULED', 'PUBLISHED', 'INDEXED', 'DONE'];

  if (input.kind && input.kind !== kw.kind) {
    if (kw.task) throw new ApiError(409, 'This keyword already has an article; its writer cannot change.');
    await prisma.workflowKeyword.update({ where: { id }, data: { kind: input.kind, kindSource: 'manual', kindNote: 'Chosen by hand' } });
  }
  if (input.title !== undefined && input.title !== kw.title) {
    if (kw.task) throw new ApiError(409, 'This keyword already has an article; edit the title on the article page.');
    await prisma.workflowKeyword.update({ where: { id }, data: { title: input.title || null } });
  }
  if (input.state === 'SKIPPED' && kw.state !== 'SKIPPED') {
    if (['SCHEDULED', 'PUBLISHED', 'INDEXED', 'DONE'].includes(kw.state)) {
      throw new ApiError(409, 'This article is already scheduled or published in WordPress. Change it there.');
    }
    // An article still being written is cancelled so it does not use ChatGPT for nothing.
    if (kw.task && kw.state === 'WRITING' && isActiveStatus(kw.task.status)) await cancelTask(kw.task.id);
    await prisma.workflowKeyword.update({ where: { id }, data: { state: 'SKIPPED', publishAt: null } });
    await writeLog({ taskId: kw.taskId, category: 'QUEUE', stage: 'WORKFLOW', message: `Workflow: "${kw.keyword}" was skipped by hand.` });
  }
  if (input.state === 'WAITING') {
    if (kw.state !== 'FAILED' && kw.state !== 'SKIPPED') throw new ApiError(409, 'Only a failed or skipped keyword can be put back in line.');
    kw = await loadKeyword(id);
    await resetKeyword(kw);
  }
  if (input.move) {
    if (startedStates.includes(kw.state)) throw new ApiError(409, 'Only keywords that are not written yet can be moved.');
    const list = await prisma.workflowKeyword.findMany({ where: { workflowId: kw.workflowId }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }], select: { id: true } });
    const ids = list.map((k) => k.id);
    const i = ids.indexOf(id);
    ids.splice(i, 1);
    const to = input.move === 'top' ? 0 : input.move === 'up' ? Math.max(0, i - 1) : Math.min(ids.length, i + 1);
    ids.splice(to, 0, id);
    await prisma.$transaction(ids.map((kid, n) => prisma.workflowKeyword.update({ where: { id: kid }, data: { position: n + 1 } })));
    // Slots follow the order: waiting keywords get new slots on the next tick.
    await prisma.workflowKeyword.updateMany({ where: { workflowId: kw.workflowId, state: 'WAITING' }, data: { publishAt: null } });
  }
  return prisma.workflowKeyword.findUnique({ where: { id } });
}

export async function deleteKeyword(id: string) {
  const kw = await loadKeyword(id);
  if (kw.state === 'WRITING') throw new ApiError(409, 'This article is being written. Skip it first, or cancel the article.');
  if (kw.state === 'SCHEDULED') throw new ApiError(409, 'This article is scheduled in WordPress. Change it there first.');
  await prisma.workflowKeyword.delete({ where: { id } });
}
