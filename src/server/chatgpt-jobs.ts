/** Shared shapes of ChatGPT prompt jobs (queue "chatgpt"), used by the worker and the agent API. */

export type ChatAttachment = { name: string; mime: string; path: string };

export type ChatJobData = {
  prompt: string;
  /** Open this chat; null = start a new chat */
  conversationUrl: string | null;
  newChat: boolean;
  /** When the chat's last user message already is this prompt, recover its answer instead of sending again */
  allowReuse: boolean;
  fresh?: boolean;
  expect: 'text' | 'images' | 'gallery';
  imageCount?: number;
  attachments?: ChatAttachment[];
  timeoutSec: number;
  label: string;
  stageKey?: string;
  requiredFeatures?: string[];
  abandoned?: number;
};

export type ChatImageFile = { path: string; width: number; height: number; source?: string };
export type ChatImageLink = { url: string; width: number; height: number };

export type ChatJobResult = {
  text: string;
  html: string;
  via?: string;
  conversationUrl: string | null;
  reusedExisting: boolean;
  imageFiles: ChatImageFile[];
  imageLinks: ChatImageLink[];
};

export type ChatFailCode = 'LOGIN' | 'CONVERSATION_LOST' | 'USAGE_LIMIT' | 'CANCELLED' | 'ERROR';
export type ChatJobFailure = { code: ChatFailCode; message: string; debug?: unknown; conversationUrl?: string | null };

const PLACEHOLDER = /\/c\/local-chatgpt:/i;
const CONV = /\/c\/([A-Za-z0-9-]{8,})(?=[/?#]|$)/;

/** A real conversation URL, or null. `/c/local-chatgpt:<uuid>` is a chat ChatGPT has not created yet. */
export function cleanConversationUrl(url: string | null | undefined): string | null {
  if (!url || PLACEHOLDER.test(url)) return null;
  try {
    const u = new URL(url);
    const m = CONV.exec(u.pathname);
    if (!m) return null;
    return `${u.origin}${u.pathname.replace(/\/+$/, '')}`;
  } catch {
    return null;
  }
}

export function conversationIdOf(url: string | null | undefined): string | null {
  const clean = cleanConversationUrl(url);
  if (!clean) return null;
  return CONV.exec(new URL(clean).pathname)?.[1] ?? null;
}
