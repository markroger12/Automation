import { describe, expect, it } from 'vitest';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const S = require('../../extension/lib/shared.js') as {
  promptsMatch(a: string, b: string): boolean;
  conversationIdFromUrl(u: string): string | null;
  cleanConversationUrl(u: string): string | null;
  stripCitations(t: string): string;
  stripCanvasMarks(t: string): string;
  stripCanvasMarksHtml(t: string): string;
  analyzeConversation(conv: unknown, opts: { prompt?: string; sentAt?: number }): { promptFound: boolean; answer: string; finished: boolean; endTurn: boolean | null };
  slotAfterResult(slot: { nextAt: number; level: number }, status: number, now: number, retryAfter?: number): { nextAt: number; level: number };
  slotTryAcquire(slot: { nextAt: number; level: number }, now: number): { granted: boolean; waitMs: number; slot: { nextAt: number; level: number } };
  SLOT_GAPS: number[];
};

function conv(messages: { role: string; text: string; status?: string; end_turn?: boolean; recipient?: string; type?: string; t?: number }[]) {
  const mapping: Record<string, unknown> = { root: { id: 'root', parent: null, message: null } };
  let parent = 'root';
  messages.forEach((m, i) => {
    const id = `m${i}`;
    mapping[id] = {
      id,
      parent,
      message: { author: { role: m.role }, content: { content_type: m.type ?? 'text', parts: [m.text] }, status: m.status ?? 'finished_successfully', end_turn: m.end_turn, recipient: m.recipient ?? 'all', create_time: m.t ?? 1000 + i },
    };
    parent = id;
  });
  return { current_node: parent, mapping };
}

describe('extension shared helpers', () => {
  it('matches prompts by start and end after normalising whitespace', () => {
    const p = 'Write an article. '.repeat(60);
    expect(S.promptsMatch(p, p.replace(/ /g, '\n'))).toBe(true);
    expect(S.promptsMatch(p, p + ' extra words that change the end')).toBe(false);
    expect(S.promptsMatch('short prompt', 'short   prompt')).toBe(true);
    expect(S.promptsMatch('short prompt', 'other prompt')).toBe(false);
  });

  it('never treats local-chatgpt placeholders as conversations', () => {
    expect(S.conversationIdFromUrl('https://chatgpt.com/c/local-chatgpt:1234-5678')).toBeNull();
    expect(S.cleanConversationUrl('https://chatgpt.com/c/local-chatgpt:1234-5678')).toBeNull();
    expect(S.cleanConversationUrl('https://chatgpt.com/c/6703a1b2-1111-2222-3333-444455556666?model=x')).toBe('https://chatgpt.com/c/6703a1b2-1111-2222-3333-444455556666');
    expect(S.conversationIdFromUrl('https://chatgpt.com/g/g-abc/c/6703a1b2-1111-2222-3333-444455556666')).toBe('6703a1b2-1111-2222-3333-444455556666');
    expect(S.conversationIdFromUrl('https://chatgpt.com/')).toBeNull();
  });

  it('strips citation markers but keeps entity names', () => {
    const t = 'Sydney Sweeneyciteturn0search1 starred in entity["tv_show","Euphoria",0].【4†source】';
    expect(S.stripCitations(t)).toBe('Sydney Sweeney starred in Euphoria.');
  });

  it('strips canvas marks from text and HTML', () => {
    expect(S.stripCanvasMarks(':::writing{id="1" variant="standard"}\n## Title\n\nText\n:::')).toBe('## Title\n\nText\n');
    expect(S.stripCanvasMarksHtml('<p>:::writing{id="1"}</p><h2>A</h2><p>:::</p>')).toBe('<h2>A</h2>');
  });

  it('takes the answer after the last tool call (no plan text)', () => {
    const c = conv([
      { role: 'user', text: 'Research Sydney Sweeney' },
      { role: 'assistant', text: "I'm verifying Sydney Sweeney's identity.", end_turn: false },
      { role: 'assistant', text: '{"q":"x"}', recipient: 'web.run', type: 'code' },
      { role: 'tool', text: 'results' },
      { role: 'assistant', text: 'Final research.', end_turn: true },
    ]);
    const a = S.analyzeConversation(c, { prompt: 'Research Sydney Sweeney' });
    expect(a).toMatchObject({ promptFound: true, answer: 'Final research.', finished: true, endTurn: true });
  });

  it('is not finished while a tool call or a message is in progress', () => {
    const c = conv([
      { role: 'user', text: 'Q' },
      { role: 'assistant', text: 'Plan', end_turn: false },
      { role: 'assistant', text: '{}', recipient: 'web.run', type: 'code', status: 'in_progress' },
    ]);
    expect(S.analyzeConversation(c, { prompt: 'Q' }).finished).toBe(false);
    const d = conv([{ role: 'user', text: 'Q' }, { role: 'assistant', text: 'Half', status: 'in_progress' }]);
    expect(S.analyzeConversation(d, { prompt: 'Q' }).finished).toBe(false);
    const e = conv([{ role: 'user', text: 'Q' }, { role: 'assistant', text: 'Done', end_turn: false }]);
    expect(S.analyzeConversation(e, { prompt: 'Q' }).finished).toBe(false);
  });

  it('recognises our prompt by text or by send time', () => {
    const c = conv([{ role: 'user', text: 'Rendered differently', t: 5000 }, { role: 'assistant', text: 'A', end_turn: true }]);
    expect(S.analyzeConversation(c, { prompt: 'My prompt', sentAt: 5000 * 1000 + 3000 }).promptFound).toBe(true);
    expect(S.analyzeConversation(c, { prompt: 'My prompt', sentAt: 5000 * 1000 + 60_000 }).promptFound).toBe(false);
  });

  it('raises the shared slot level on 429 (honouring Retry-After) and lowers it on success', () => {
    let slot = { nextAt: 0, level: 0 };
    slot = S.slotAfterResult(slot, 429, 1000, 0);
    expect(slot).toEqual({ level: 1, nextAt: 1000 + 30_000 });
    slot = S.slotAfterResult(slot, 429, 2000, 600);
    expect(slot.level).toBe(2);
    expect(slot.nextAt).toBe(2000 + 600_000);
    slot = S.slotAfterResult(slot, 200, 3000);
    expect(slot.level).toBe(1);
    const busy = S.slotTryAcquire({ nextAt: 10_000, level: 1 }, 4000);
    expect(busy.granted).toBe(false);
    expect(busy.waitMs).toBe(6000);
    const free = S.slotTryAcquire({ nextAt: 0, level: 0 }, 4000);
    expect(free.granted).toBe(true);
    expect(free.slot.nextAt).toBe(8000);
    for (let i = 0; i < 10; i++) slot = S.slotAfterResult(slot, 429, 0);
    expect(slot.level).toBe(S.SLOT_GAPS.length - 1);
  });
});
