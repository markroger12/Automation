import crypto from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/server/db';
import { getPromptContent } from '@/server/prompts';
import { writeLog } from '@/server/log';
import { ConversationLostError, TaskCancelledError } from '@/server/errors';
import { parseJson } from '@/lib/json';
import type { Settings } from '@/lib/settings-schema';
import { renderTemplate } from '@/core/template';
import { asLang, languageLine } from '@/core/language';
import { markdownToHtml, normalizeAnswer } from '@/core/markdown';
import { sanitizeArticleHtml } from '@/core/sanitize';
import { askViaExtension } from '../chatgpt/client';
import type { AskOptions, ChatAnswer, PipelineContext, PipelineDefinition, StageLogger, TaskWithRelations } from './types';

const STEP_TEXT: Record<string, string> = {
  claimed: 'ChatGPT tab took the prompt',
  navigating: 'opening the chat',
  'opening-chat': 'opening the chat',
  'waiting-page': 'waiting for ChatGPT to load',
  'waiting-login': 'waiting for a ChatGPT login (see the notification)',
  'waiting-human-check': 'waiting for a human check on ChatGPT',
  'checking-chat': 'checking the chat',
  'recovering-answer': 'recovering the answer already in the chat',
  typing: 'typing the prompt',
  retyping: 'typing the prompt again',
  uploading: 'uploading photos',
  'waiting-send-button': 'waiting to send',
  sent: 'prompt sent',
  'waiting-prompt': 'prompt sent',
  'waiting-answer': 'ChatGPT is writing',
  'waiting-images': 'waiting for the picture',
  'waiting-gallery': 'waiting for the image gallery',
  'saving-gallery': 'saving pictures',
};

export async function loadTask(taskId: string): Promise<TaskWithRelations | null> {
  return prisma.articleTask.findUnique({
    where: { id: taskId },
    include: { website: { include: { categories: { orderBy: { name: 'asc' } } } }, category: true },
  });
}

export type ContextState = {
  forceNewChat: boolean;
  sentThisJob: Set<string>;
};

export function createContext(args: {
  task: TaskWithRelations;
  settings: Settings;
  pipeline: PipelineDefinition;
  mode: 'run' | 'regenerate';
  jobId: string;
  state: ContextState;
}): PipelineContext {
  const { pipeline, settings, mode, jobId, state } = args;
  const ctx: PipelineContext = {
    task: args.task,
    settings,
    mode,
    pipeline,
    jobId,
    language: asLang(args.task.language),
    kind: pipeline.kind,
    stageKey: '',
    attempt: 1,
    log: makeLogger(args.task.id, () => ctx.stageKey),

    async refresh() {
      const t = await loadTask(ctx.task.id);
      if (!t) throw new TaskCancelledError('The article was deleted.');
      ctx.task = t;
      ctx.language = asLang(t.language);
      return t;
    },

    async update(data: Prisma.ArticleTaskUpdateInput) {
      await prisma.articleTask.update({ where: { id: ctx.task.id }, data });
      return ctx.refresh();
    },

    async setMessage(message: string) {
      await prisma.articleTask.update({ where: { id: ctx.task.id }, data: { statusMessage: message.slice(0, 300) } });
    },

    async checkCancelled() {
      const t = await prisma.articleTask.findUnique({ where: { id: ctx.task.id }, select: { cancelRequested: true } });
      if (!t || t.cancelRequested) throw new TaskCancelledError();
    },

    stageRow(key: string) {
      return prisma.articleStage.findUnique({ where: { taskId_key: { taskId: ctx.task.id, key } } });
    },

    async stageOutput(key: string) {
      return (await ctx.stageRow(key))?.output ?? null;
    },

    async stageData<T>(key: string) {
      const row = await ctx.stageRow(key);
      return row?.data ? parseJson<T | null>(row.data, null) : null;
    },

    async saveProgress(data: Record<string, unknown>) {
      const row = await ctx.stageRow(ctx.stageKey);
      const merged = { ...parseJson<Record<string, unknown>>(row?.data, {}), ...data };
      await prisma.articleStage.update({ where: { taskId_key: { taskId: ctx.task.id, key: ctx.stageKey } }, data: { data: JSON.stringify(merged) } });
    },

    async variables(extra: Record<string, unknown> = {}) {
      return pipeline.variables(ctx, extra);
    },

    imagesEnabled() {
      const t = ctx.task;
      if (t.imagesMode === 'on') return true;
      if (t.imagesMode === 'off') return false;
      if (!settings.articleImages) return false;
      const w = t.website;
      if (!w) return false;
      return pipeline.kind === 'celebrity' ? w.celebrityImages : w.tigramImages;
    },

    maxWords() {
      return pipeline.maxWords(settings);
    },

    async askChatGPT(stageKey: string, promptKey: string, extra: Record<string, unknown> = {}, opts: AskOptions = {}) {
      const template = await getPromptContent(pipeline.moduleKey, promptKey);
      const vars = await ctx.variables(extra);
      let prompt = renderTemplate(template, vars);
      // Every text prompt gets the language line (English too: the account may have many German chats).
      if (!opts.images && !opts.gallery && !opts.noLanguageLine) {
        prompt += `\n\n${languageLine(ctx.language, ctx.task.targetCountry || settings.targetCountry)}`;
      }
      return ctx.sendPrompt(stageKey, prompt, { label: opts.label ?? promptKey, ...opts });
    },

    async sendPrompt(stageKey: string, prompt: string, opts: AskOptions = {}) {
      return send(ctx, state, stageKey, prompt, opts);
    },
  };
  return ctx;
}

function makeLogger(taskId: string, stage: () => string): StageLogger {
  const at = (level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR') => (message: string, data?: unknown) =>
    writeLog({ taskId, level, category: 'SYSTEM', stage: stage() || null, message, data });
  return { debug: at('DEBUG'), info: at('INFO'), warn: at('WARN'), error: at('ERROR') };
}

function promptHash(stageKey: string, prompt: string): string {
  return crypto.createHash('sha1').update(`${stageKey}\n${prompt}`).digest('hex');
}

async function send(ctx: PipelineContext, state: ContextState, stageKey: string, prompt: string, opts: AskOptions, lostOnce = false): Promise<ChatAnswer> {
  await ctx.checkCancelled();
  const savedChat = ctx.task.chatgptConversationUrl;
  const newChat = !!opts.newChat || state.forceNewChat || !savedChat;
  let finalPrompt = prompt;
  if (newChat && (state.forceNewChat || lostOnce) && ctx.pipeline.contextPrimer) {
    const primer = await ctx.pipeline.contextPrimer(ctx, stageKey);
    if (primer) finalPrompt = `${primer}\n\n---\n\n${prompt}`;
  }
  const hash = promptHash(stageKey, finalPrompt);
  const allowReuse = !opts.fresh && (ctx.mode === 'run' || ctx.attempt > 1 || state.sentThisJob.has(hash));
  state.sentThisJob.add(hash);

  await writeLog({
    taskId: ctx.task.id,
    category: 'CHATGPT',
    stage: stageKey,
    message: `Prompt "${opts.label ?? stageKey}" → ${newChat ? 'new chat' : 'article chat'} (${finalPrompt.length} chars${allowReuse ? ', may recover an earlier answer' : ''}${opts.attachments?.length ? `, ${opts.attachments.length} photo(s)` : ''})`,
    data: { prompt: finalPrompt.slice(0, 6000), conversationUrl: newChat ? null : savedChat },
  });

  let res;
  try {
    res = await askViaExtension({
      taskId: ctx.task.id,
      stageKey,
      label: `${ctx.task.keyword} · ${opts.label ?? stageKey}`,
      prompt: finalPrompt,
      conversationUrl: newChat ? null : savedChat,
      newChat,
      allowReuse,
      fresh: opts.fresh,
      expect: opts.images ? 'images' : opts.gallery ? 'gallery' : 'text',
      imageCount: opts.imageCount,
      attachments: opts.attachments,
      onProgress: async (step) => {
        const text = STEP_TEXT[step];
        if (text) await ctx.setMessage(`${opts.label ?? stageKey}: ${text}`);
      },
    });
  } catch (err) {
    if (err instanceof ConversationLostError && !newChat && !lostOnce) {
      await writeLog({
        taskId: ctx.task.id,
        level: 'WARN',
        category: 'CHATGPT',
        stage: stageKey,
        message: `The saved ChatGPT chat cannot be opened (${err.message}). Continuing in a new chat with a summary of the earlier stages.`,
        data: (err as { debug?: unknown }).debug,
      });
      state.forceNewChat = true;
      return send(ctx, state, stageKey, prompt, opts, true);
    }
    throw err;
  }

  if (res.conversationUrl && (newChat || res.conversationUrl !== savedChat)) {
    await prisma.articleTask.update({ where: { id: ctx.task.id }, data: { chatgptConversationUrl: res.conversationUrl } });
    ctx.task.chatgptConversationUrl = res.conversationUrl;
    state.forceNewChat = false;
  }

  const markdown = normalizeAnswer({ text: res.text, html: res.html });
  const html = sanitizeArticleHtml(markdownToHtml(markdown));
  await prisma.chatGPTResponse.create({
    data: {
      taskId: ctx.task.id,
      stageKey,
      attempt: ctx.attempt,
      prompt: finalPrompt,
      responseText: markdown,
      responseHtml: res.html || null,
      conversationUrl: res.conversationUrl,
      reusedExisting: res.reusedExisting,
      durationMs: res.durationMs,
    },
  });
  await writeLog({
    taskId: ctx.task.id,
    category: 'CHATGPT',
    stage: stageKey,
    message: `Answer for "${opts.label ?? stageKey}": ${markdown.length} chars in ${Math.round(res.durationMs / 1000)} s${res.reusedExisting ? ' (recovered from the chat, not sent again)' : ''}${res.imageFiles.length ? `, ${res.imageFiles.length} picture(s)` : ''}${res.imageLinks.length ? `, ${res.imageLinks.length} link(s)` : ''}`,
    data: { answer: markdown.slice(0, 6000), conversationUrl: res.conversationUrl },
  });
  return {
    prompt: finalPrompt,
    markdown,
    html,
    conversationUrl: res.conversationUrl,
    reusedExisting: res.reusedExisting,
    imageFiles: res.imageFiles,
    imageLinks: res.imageLinks,
    durationMs: res.durationMs,
  };
}
