import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import type { BrowserContext, Route } from 'playwright';

/**
 * A fake chatgpt.com served through Playwright routing. The Node side holds the conversations (the page
 * renders them and the extension reads them through /backend-api/conversation/<id>, like the real site).
 */

export type FakeMode = 'markers' | 'no-markers' | 'shell-page';

export type FakeOptions = {
  mode: FakeMode;
  loggedOut?: boolean;
  answerMs?: number;
  /** First N conversation reads answer 429 */
  rateLimitFirst?: number;
  /** All conversation reads answer 429 until this time */
  rateLimitUntil?: number;
  /** Assistant writes a plan, calls a tool, then answers */
  preamble?: boolean;
  /** Answer wrapped in :::writing{…} canvas marks */
  canvas?: boolean;
  /** Final message without end_turn: needs two equal reads */
  noEndTurn?: boolean;
  /** Generated picture (1024×1024) after the answer */
  image?: boolean;
  /** Image-search gallery */
  gallery?: { fetchable: string[]; publisher: string[] };
  /** Answer text override */
  answer?: (prompt: string) => string;
};

type Msg = {
  id: string;
  parent: string | null;
  role: 'user' | 'assistant' | 'tool' | 'system';
  text: string;
  status: 'in_progress' | 'finished_successfully';
  end_turn?: boolean | null;
  recipient: string;
  content_type: string;
  create_time: number;
  images?: string[];
  gallery?: boolean;
  attachments?: string[];
};

type Conv = { id: string; messages: Msg[]; generating: boolean };

const FIXTURE = path.join(__dirname, '..', 'fixtures', 'fake-chatgpt.html');

export function defaultAnswer(prompt: string): string {
  const head = prompt.replace(/\s+/g, ' ').trim().slice(0, 60);
  return `Answer to: ${head}\n\n## Early Life\n\nShe grew up in **Spokane** and studied acting.\n\n## Career\n\nHer career started in 2009 with small roles.`;
}

export class FakeChatGPT {
  opts: FakeOptions = { mode: 'markers' };
  conversations = new Map<string, Conv>();
  convReads = 0;
  conv429 = 0;
  received: { prompt: string; attachments: string[]; pastedChips: number }[] = [];
  private timers: NodeJS.Timeout[] = [];
  private imageCache = new Map<string, Buffer>();

  setMode(opts: FakeOptions) {
    this.opts = { answerMs: 2500, ...opts };
    this.convReads = 0;
    this.conv429 = 0;
  }

  reset() {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
    this.conversations.clear();
    this.received = [];
  }

  /** Creates a finished conversation (for recovery tests). */
  seedConversation(prompt: string, answer: string): string {
    const id = crypto.randomUUID();
    const now = Date.now() / 1000 - 600;
    const u: Msg = { id: crypto.randomUUID(), parent: null, role: 'user', text: prompt, status: 'finished_successfully', recipient: 'all', content_type: 'text', create_time: now };
    const a: Msg = { id: crypto.randomUUID(), parent: u.id, role: 'assistant', text: answer, status: 'finished_successfully', end_turn: true, recipient: 'all', content_type: 'text', create_time: now + 5 };
    this.conversations.set(id, { id, messages: [u, a], generating: false });
    return id;
  }

  private async png(name: string, w: number, h: number): Promise<Buffer> {
    const key = `${name}-${w}x${h}`;
    const hit = this.imageCache.get(key);
    if (hit) return hit;
    const hue = [...name].reduce((s, c) => s + c.charCodeAt(0), 0) % 255;
    const buf = await sharp({ create: { width: w, height: h, channels: 3, background: { r: hue, g: 120, b: 255 - hue } } }).png().toBuffer();
    this.imageCache.set(key, buf);
    return buf;
  }

  private startAnswer(conv: Conv, user: Msg) {
    const o = this.opts;
    const full = (o.answer ?? defaultAnswer)(user.text);
    const base = Date.now() / 1000;
    let parent = user.id;
    const add = (m: Omit<Msg, 'id' | 'parent' | 'create_time'>) => {
      const msg: Msg = { ...m, id: crypto.randomUUID(), parent, create_time: base + conv.messages.length * 0.01 };
      conv.messages.push(msg);
      parent = msg.id;
      return msg;
    };
    conv.generating = true;
    if (o.preamble) {
      add({ role: 'assistant', text: "I'm verifying Sydney Sweeney's identity before writing.", status: 'finished_successfully', end_turn: false, recipient: 'all', content_type: 'text' });
      add({ role: 'assistant', text: '{"search_query":[{"q":"Sydney Sweeney"}]}', status: 'finished_successfully', end_turn: false, recipient: 'web.run', content_type: 'code' });
      add({ role: 'tool', text: 'search results', status: 'finished_successfully', recipient: 'all', content_type: 'text' });
    }
    const finalText = o.canvas ? `:::writing{id="51231" variant="standard"}\n${full}\n:::` : full;
    const answer = add({ role: 'assistant', text: '', status: 'in_progress', end_turn: null, recipient: 'all', content_type: 'text' });
    const steps = 5;
    const ms = o.answerMs ?? 2500;
    for (let i = 1; i <= steps; i++) {
      this.timers.push(
        setTimeout(() => {
          answer.text = finalText.slice(0, Math.ceil((finalText.length * i) / steps));
          if (i === steps) {
            answer.status = 'finished_successfully';
            answer.end_turn = o.noEndTurn ? undefined : true;
            if (o.image) answer.images = ['/fake/img/generated-1.png'];
            if (o.gallery) {
              answer.images = [...o.gallery.fetchable, ...o.gallery.publisher];
              answer.gallery = true;
            }
            conv.generating = false;
          }
        }, (ms * i) / steps),
      );
    }
  }

  private mapping(conv: Conv) {
    const mapping: Record<string, unknown> = {};
    const root = 'client-created-root';
    mapping[root] = { id: root, message: null, parent: null, children: [] };
    for (const m of conv.messages) {
      mapping[m.id] = {
        id: m.id,
        parent: m.parent ?? root,
        children: [],
        message: {
          id: m.id,
          author: { role: m.role },
          create_time: m.create_time,
          content: { content_type: m.content_type, parts: [m.text] },
          status: m.status,
          end_turn: m.end_turn,
          recipient: m.recipient,
          metadata: {},
        },
      };
    }
    return { conversation_id: conv.id, current_node: conv.messages[conv.messages.length - 1]?.id ?? root, mapping };
  }

  async install(context: BrowserContext) {
    const html = fs.readFileSync(FIXTURE, 'utf8');
    await context.route('https://chatgpt.com/**', (route) => this.handle(route, html));
    await context.route('https://publisher.example/**', async (route) => {
      route.fulfill({ status: 200, contentType: 'image/png', body: await this.png(route.request().url(), 900, 1200) });
    });
  }

  private json(route: Route, status: number, body: unknown, headers: Record<string, string> = {}) {
    return route.fulfill({ status, contentType: 'application/json', headers, body: JSON.stringify(body) });
  }

  private async handle(route: Route, html: string) {
    const req = route.request();
    const url = new URL(req.url());
    const p = url.pathname;
    const o = this.opts;

    if (p === '/api/auth/session') return this.json(route, 200, o.loggedOut ? {} : { accessToken: 'fake-token', user: { id: 'u1' } });

    if (p === '/backend-api/f/conversation' && req.method() === 'POST') {
      const body = JSON.parse(req.postData() || '{}') as { conversationId: string | null; prompt: string; attachments: string[]; pastedChips: number };
      this.received.push({ prompt: body.prompt, attachments: body.attachments ?? [], pastedChips: body.pastedChips ?? 0 });
      let conv = body.conversationId ? this.conversations.get(body.conversationId) : undefined;
      if (!conv) {
        conv = { id: crypto.randomUUID(), messages: [], generating: false };
        this.conversations.set(conv.id, conv);
      }
      const last = conv.messages[conv.messages.length - 1];
      const user: Msg = { id: crypto.randomUUID(), parent: last?.id ?? null, role: 'user', text: body.prompt, status: 'finished_successfully', recipient: 'all', content_type: 'text', create_time: Date.now() / 1000, attachments: body.attachments };
      conv.messages.push(user);
      this.startAnswer(conv, user);
      return this.json(route, 200, { conversationId: conv.id });
    }

    const stateMatch = /^\/backend-api\/fake\/state\/([\w-]+)$/.exec(p);
    if (stateMatch) {
      const conv = this.conversations.get(stateMatch[1]!);
      if (!conv) return this.json(route, 404, { detail: 'not found' });
      const shown = conv.messages.filter((m) => m.role === 'user' || (m.role === 'assistant' && m.recipient === 'all'));
      const lastAssistant = [...shown].reverse().find((m) => m.role === 'assistant');
      return this.json(route, 200, {
        generating: conv.generating,
        messages: shown.map((m) => ({ role: m.role, text: m.text, status: m.status, images: m.images, gallery: m.gallery, last: m === lastAssistant })),
      });
    }

    const stopMatch = /^\/backend-api\/fake\/stop\/([\w-]+)$/.exec(p);
    if (stopMatch) return this.json(route, 200, { ok: true });

    const convMatch = /^\/backend-api\/conversation\/([\w-]+)$/.exec(p);
    if (convMatch) {
      this.convReads++;
      if (!/Bearer fake-token/.test(req.headers()['authorization'] ?? '')) return this.json(route, 401, { detail: 'unauthorized' });
      if ((o.rateLimitFirst && this.convReads <= o.rateLimitFirst) || (o.rateLimitUntil && Date.now() < o.rateLimitUntil)) {
        this.conv429++;
        return this.json(route, 429, { detail: 'Too many requests' }, { 'Retry-After': '1' });
      }
      const conv = this.conversations.get(convMatch[1]!);
      if (!conv) return this.json(route, 404, { detail: 'Conversation not found' });
      return this.json(route, 200, this.mapping(conv));
    }

    if (p.startsWith('/fake/img/')) {
      return route.fulfill({ status: 200, contentType: 'image/png', body: await this.png(p, 1024, 1024) });
    }

    if (req.resourceType() === 'document' || p === '/' || p.startsWith('/c/')) {
      const config = { mode: o.mode, loggedOut: !!o.loggedOut };
      const page = html.replace('<script>', `<script>window.__FAKE=${JSON.stringify(config)};</script><script>`);
      return route.fulfill({ status: 200, contentType: 'text/html', body: page });
    }
    return route.fulfill({ status: 404, body: 'not found' });
  }
}
