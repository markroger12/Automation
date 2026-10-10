/*
 * Pure helpers shared by the content script and the unit tests (no DOM, no chrome.* APIs).
 * Loaded as a classic content script before content.js; exported for Node through module.exports.
 */
(function (root) {
  'use strict';

  var PLACEHOLDER_RE = /\/c\/local-chatgpt:/i;
  var CONVERSATION_RE = /\/c\/([A-Za-z0-9-]{8,})(?=[/?#]|$)/;

  function normalizeWhitespace(text) {
    return String(text == null ? '' : text)
      .replace(/[​-‍﻿]/g, '')
      .replace(/ /g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** Compares the start and the end of two prompts after normalising whitespace. */
  function promptsMatch(a, b, edge) {
    var x = normalizeWhitespace(a);
    var y = normalizeWhitespace(b);
    if (!x || !y) return false;
    if (x === y) return true;
    var n = edge || 160;
    if (x.length < n * 2 || y.length < n * 2) return false;
    // Lengths must be close: ChatGPT may render a few characters differently, never whole paragraphs.
    if (Math.abs(x.length - y.length) > Math.max(40, y.length * 0.03)) return false;
    return x.slice(0, n) === y.slice(0, n) && x.slice(-n) === y.slice(-n);
  }

  function isPlaceholderUrl(url) {
    return PLACEHOLDER_RE.test(String(url || ''));
  }

  /** The conversation id of a chat URL, or null (new chat, placeholder local-chatgpt:… URLs). */
  function conversationIdFromUrl(url) {
    if (!url || isPlaceholderUrl(url)) return null;
    var path;
    try {
      path = new URL(url, 'https://chatgpt.com').pathname;
    } catch (e) {
      return null;
    }
    var m = CONVERSATION_RE.exec(path);
    return m ? m[1] : null;
  }

  /** A real conversation URL (origin + /c/<id>) or null. Placeholders are never saved. */
  function cleanConversationUrl(url) {
    var id = conversationIdFromUrl(url);
    if (!id) return null;
    try {
      var u = new URL(url, 'https://chatgpt.com');
      return u.origin + u.pathname.replace(/\/+$/, '');
    } catch (e) {
      return null;
    }
  }

  /**
   * Removes ChatGPT citation markers. Entity markers keep the entity name.
   * Private-use markers look like citeturn0search1 and entity["people","Name"].
   */
  function stripCitations(text) {
    var out = String(text == null ? '' : text);
    out = out.replace(/([a-z_]+)([\s\S]*?)/gi, function (_all, kind, payload) {
      if (String(kind).toLowerCase() === 'entity') {
        try {
          var arr = JSON.parse(payload);
          if (Array.isArray(arr)) {
            var strings = arr.filter(function (v) {
              return typeof v === 'string';
            });
            if (strings.length > 1) return strings[1];
            if (strings.length === 1) return strings[0];
          }
        } catch (e) {
          var parts = String(payload).split('');
          return parts[parts.length - 1] || '';
        }
        return '';
      }
      return '';
    });
    out = out.replace(/[-]/g, '');
    out = out.replace(/【[^】]{0,80}】/g, '');
    out = out.replace(/\s*\(\[[^\]]{1,80}\]\(https?:\/\/[^)\s]+\)\)/g, '');
    return out.replace(/[ \t]+([.,;:!?])/g, '$1');
  }

  /** Removes canvas marks  :::writing{…}  …  :::  (keeps the content between them). */
  function stripCanvasMarks(text) {
    return String(text == null ? '' : text)
      .replace(/^[ \t]*:::[a-z_-]*\{[^\n]*\}[ \t]*\r?\n?/gim, '')
      .replace(/^[ \t]*:::[ \t]*\r?\n?/gm, '')
      .replace(/:::writing\{[^}\n]*\}/gi, '');
  }

  function stripCanvasMarksHtml(html) {
    return String(html == null ? '' : html)
      .replace(/<p>\s*:::[a-z_-]*\{[^<]*\}\s*<\/p>/gi, '')
      .replace(/<p>\s*:::\s*<\/p>/gi, '')
      .replace(/:::[a-z_-]*\{[^<}]*\}/gi, '')
      .replace(/(^|>)\s*:::\s*(<|$)/g, '$1$2');
  }

  function cleanAnswerText(text) {
    return stripCanvasMarks(stripCitations(text)).replace(/\n{3,}/g, '\n\n').trim();
  }

  function messageText(message) {
    var content = message && message.content;
    if (!content) return '';
    if (Array.isArray(content.parts)) {
      return content.parts
        .map(function (p) {
          if (typeof p === 'string') return p;
          if (p && typeof p.text === 'string') return p.text;
          return '';
        })
        .filter(Boolean)
        .join('\n');
    }
    if (typeof content.text === 'string') return content.text;
    return '';
  }

  function isHidden(message) {
    var md = (message && message.metadata) || {};
    return !!(md.is_visually_hidden_from_conversation || md.is_user_system_message || md.is_contextual_answers_system_message);
  }

  function isShownUser(m) {
    var type = m.content && m.content.content_type;
    return m.author && m.author.role === 'user' && (type === 'text' || type === 'multimodal_text') && !isHidden(m);
  }

  function isShownAssistant(m) {
    var type = m.content && m.content.content_type;
    var recipient = m.recipient == null ? 'all' : m.recipient;
    return m.author && m.author.role === 'assistant' && recipient === 'all' && (type === 'text' || type === 'multimodal_text') && !isHidden(m);
  }

  /** A tool call or tool result: everything an assistant sends to a tool, and every tool message. */
  function isToolStep(m) {
    if (!m || !m.author) return false;
    if (m.author.role === 'tool') return true;
    if (m.author.role === 'assistant') {
      var recipient = m.recipient == null ? 'all' : m.recipient;
      var type = m.content && m.content.content_type;
      return recipient !== 'all' || (type !== 'text' && type !== 'multimodal_text' && type !== undefined);
    }
    return false;
  }

  /** current_node → parent → … : the message chain shown on the page. */
  function conversationChain(conv) {
    var chain = [];
    if (!conv || !conv.mapping) return chain;
    var id = conv.current_node;
    var guard = 0;
    while (id && conv.mapping[id] && guard++ < 5000) {
      var node = conv.mapping[id];
      if (node.message) chain.unshift(node.message);
      id = node.parent;
    }
    return chain;
  }

  /**
   * Finds our prompt in a /backend-api/conversation/<id> response and the answer to it.
   * The answer is the text after the last tool call (ChatGPT writes a plan before a web search).
   * Finished = last shown answer after our message is finished_successfully, end_turn !== false and nothing
   * after it is still in progress.
   */
  function analyzeConversation(conv, opts) {
    opts = opts || {};
    var chain = conversationChain(conv);
    var result = { promptFound: false, answer: '', finished: false, endTurn: null, status: null, lastRole: null, chars: 0, messages: chain.length, lastUserText: '' };
    if (!chain.length) return result;
    var userIndex = -1;
    for (var i = chain.length - 1; i >= 0; i--) {
      if (isShownUser(chain[i])) {
        if (!result.lastUserText) result.lastUserText = messageText(chain[i]);
        var t = messageText(chain[i]);
        var created = typeof chain[i].create_time === 'number' ? chain[i].create_time * 1000 : 0;
        var byText = opts.prompt ? promptsMatch(t, opts.prompt) : false;
        var byTime = opts.sentAt ? created >= opts.sentAt - 10000 : false;
        if (byText || byTime || (!opts.prompt && !opts.sentAt)) {
          userIndex = i;
          break;
        }
        // Only the newest user message can be ours.
        break;
      }
    }
    if (userIndex < 0) return result;
    result.promptFound = true;
    var after = chain.slice(userIndex + 1);
    var lastTool = -1;
    for (var j = 0; j < after.length; j++) if (isToolStep(after[j])) lastTool = j;
    var finalPart = after.slice(lastTool + 1).filter(isShownAssistant);
    var shown = after.filter(isShownAssistant);
    var last = shown.length ? shown[shown.length - 1] : null;
    var lastMsg = after.length ? after[after.length - 1] : null;
    result.lastRole = lastMsg && lastMsg.author ? lastMsg.author.role : null;
    if (!last) return result;
    result.status = last.status || null;
    result.endTurn = last.end_turn === undefined ? null : last.end_turn;
    var inProgressAfter = false;
    var lastIdx = after.indexOf(last);
    for (var k = 0; k < after.length; k++) {
      if (after[k].status === 'in_progress' && k >= lastIdx) inProgressAfter = true;
    }
    var lastIsFinal = finalPart.length > 0 && finalPart[finalPart.length - 1] === last;
    result.answer = cleanAnswerText(finalPart.map(messageText).join('\n\n'));
    result.chars = result.answer.length;
    result.finished = lastIsFinal && last.status === 'finished_successfully' && last.end_turn !== false && !inProgressAfter && lastTool < after.length - 1;
    return result;
  }

  var SLOT_GAPS = [4000, 30000, 60000, 120000, 240000, 300000];

  /** Shared conversation-read slot. Each 429 raises the level (Retry-After honoured), each success lowers it. */
  function slotAfterResult(slot, status, now, retryAfterSec) {
    var s = { nextAt: (slot && slot.nextAt) || 0, level: (slot && slot.level) || 0 };
    if (status === 429) {
      s.level = Math.min(s.level + 1, SLOT_GAPS.length - 1);
      var wait = Math.max(SLOT_GAPS[s.level], (retryAfterSec || 0) * 1000);
      s.nextAt = Math.max(s.nextAt, now + wait);
    } else if (status >= 200 && status < 300) {
      s.level = Math.max(0, s.level - 1);
    }
    return s;
  }

  function slotTryAcquire(slot, now) {
    var s = { nextAt: (slot && slot.nextAt) || 0, level: (slot && slot.level) || 0 };
    if (now >= s.nextAt) {
      s.nextAt = now + SLOT_GAPS[s.level];
      return { granted: true, waitMs: 0, slot: s };
    }
    return { granted: false, waitMs: s.nextAt - now, slot: s };
  }

  var api = {
    normalizeWhitespace: normalizeWhitespace,
    promptsMatch: promptsMatch,
    isPlaceholderUrl: isPlaceholderUrl,
    conversationIdFromUrl: conversationIdFromUrl,
    cleanConversationUrl: cleanConversationUrl,
    stripCitations: stripCitations,
    stripCanvasMarks: stripCanvasMarks,
    stripCanvasMarksHtml: stripCanvasMarksHtml,
    cleanAnswerText: cleanAnswerText,
    messageText: messageText,
    conversationChain: conversationChain,
    analyzeConversation: analyzeConversation,
    SLOT_GAPS: SLOT_GAPS,
    slotAfterResult: slotAfterResult,
    slotTryAcquire: slotTryAcquire,
  };
  root.BASShared = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
