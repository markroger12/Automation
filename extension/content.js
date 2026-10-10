/*
 * ChatGPT Worker — content script on chatgpt.com.
 * Claims prompt jobs through the background, types and sends them, reads the answer and reports back.
 * Two answer readers: the page (old variant with data-message-author-role markers) and the conversation
 * endpoint (current variant without markers), behind one shared rate-limit slot for all tabs.
 */
(function () {
  'use strict';
  if (window.__basContentLoaded) return;
  window.__basContentLoaded = true;

  var SCRIPT_VERSION = '1.0.0';
  var S = globalThis.BASShared;
  var PENDING_KEY = 'bas_pending_job_v1';
  var FEATURES = ['text', 'long-prompt', 'images', 'gallery', 'attachments', 'conversation-read'];
  var PASTE_LIMIT = 8000;
  var PROMPT_APPEAR_MS = 180000;
  var ACTION_ROW_WAIT_MS = 45000;
  var STABLE_PAGE_MS = 2500;
  var PER_TAB_READ_GAP_MS = 5000;
  var LOGIN_WAIT_MS = 10 * 60000;
  var IDLE_STUCK_MS = 30000;
  var GALLERY_WAIT_MS = 90000;

  var SEL = {
    composer: ['#prompt-textarea', 'div.ProseMirror[contenteditable="true"]', 'textarea[name="prompt-textarea"]', 'form [contenteditable="true"]', 'main textarea'],
    send: ['[data-testid="send-button"]', '#composer-submit-button', 'button[aria-label="Send prompt"]', 'button[aria-label*="Send" i]'],
    stop: ['[data-testid="stop-button"]', 'button[aria-label*="Stop streaming" i]', 'button[aria-label*="Stop generating" i]', 'button[aria-label^="Stop" i]'],
    userMarked: '[data-message-author-role="user"]',
    assistantMarked: '[data-message-author-role="assistant"]',
    userShell: ['.user-message-bubble-color', '[data-testid*="user-message" i]', '[class*="user-message" i]'],
    actionRow: ['.turn-action-controls', '[data-testid="copy-turn-action-button"]', '[data-testid="good-response-turn-action-button"]', 'button[aria-label="Copy"]'],
    fileInput: ['input[type="file"][multiple]', 'form input[type="file"]', 'input[type="file"]'],
    challenge: ['#challenge-form', '#cf-challenge-running', 'iframe[src*="challenges.cloudflare.com"]', '#turnstile-wrapper', '.cf-turnstile'],
    loginButton: ['[data-testid="login-button"]', 'a[href*="/auth/login"]'],
    profileButton: ['[data-testid="profile-button"]', '[data-testid="accounts-profile-button"]', 'button[aria-label*="Open profile menu" i]'],
    canvas: '[data-testid*="canvas" i], [class*="canvas" i], [data-writing-block], .writing-block, [id*="canvas" i], [aria-label*="canvas" i], [data-testid*="writing-block" i]',
    marker: ['[data-message-author-role]', '[data-testid^="conversation-turn"]', '[data-message-id]', '.markdown', '.turn-action-controls', '.user-message-bubble-color', '#prompt-textarea', '[data-testid="send-button"]', '[data-testid="stop-button"]', 'article', '[role="dialog"]', '[data-testid="copy-turn-action-button"]'],
  };

  var state = { busy: false, jobId: null, step: 'idle', lastReadInfo: null, slotLevel: 0, throttledMs: 0, dead: false, readCache: null };

  // ---------- small helpers ----------
  function sleep(ms) {
    return new Promise(function (r) {
      setTimeout(r, ms);
    });
  }
  function qs(sel, root) {
    try {
      return (root || document).querySelector(sel);
    } catch (e) {
      return null;
    }
  }
  function qsa(sel, root) {
    try {
      return Array.prototype.slice.call((root || document).querySelectorAll(sel));
    } catch (e) {
      return [];
    }
  }
  function first(list, root) {
    for (var i = 0; i < list.length; i++) {
      var el = qs(list[i], root);
      if (el) return el;
    }
    return null;
  }
  function allOf(list, root) {
    var out = [];
    list.forEach(function (sel) {
      qsa(sel, root).forEach(function (el) {
        if (out.indexOf(el) < 0) out.push(el);
      });
    });
    return out;
  }
  function visible(el) {
    if (!el) return false;
    var r = el.getBoundingClientRect();
    var st = getComputedStyle(el);
    return st.display !== 'none' && st.visibility !== 'hidden' && (r.width > 0 || r.height > 0);
  }
  function after(a, b) {
    // true when b comes after a in document order
    return !!(a && b && a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
  }
  function err(code, message) {
    var e = new Error(message);
    e.code = code;
    return e;
  }

  function send(msg) {
    return new Promise(function (resolve) {
      if (state.dead) return resolve({ error: 'dead' });
      try {
        chrome.runtime.sendMessage(msg, function (resp) {
          if (chrome.runtime.lastError) return resolve({ error: chrome.runtime.lastError.message });
          resolve(resp || {});
        });
      } catch (e) {
        // "Extension context invalidated": the extension was reloaded. This copy of the script is orphaned;
        // the background reloads the tab.
        state.dead = true;
        resolve({ error: String(e && e.message), dead: true });
      }
    });
  }

  // ---------- page inspection ----------
  function isCanvasEl(el) {
    return !!(el && el.closest && el.closest(SEL.canvas));
  }
  function findComposer() {
    for (var i = 0; i < SEL.composer.length; i++) {
      var list = qsa(SEL.composer[i]);
      for (var j = 0; j < list.length; j++) if (!isCanvasEl(list[j]) && visible(list[j])) return list[j];
    }
    return null;
  }
  function stopButton() {
    var b = first(SEL.stop);
    return b && visible(b) ? b : null;
  }
  function sendButton() {
    var list = allOf(SEL.send);
    for (var i = 0; i < list.length; i++) if (visible(list[i]) && !isCanvasEl(list[i])) return list[i];
    return null;
  }
  function markersPresent() {
    return !!qs(SEL.userMarked) || !!qs(SEL.assistantMarked);
  }
  function userNodes() {
    var marked = qsa(SEL.userMarked);
    if (marked.length) return marked;
    return allOf(SEL.userShell).filter(function (el) {
      // keep the outermost match only
      return !el.parentElement || !el.parentElement.closest(SEL.userShell.join(','));
    });
  }
  function lastUserNode() {
    var u = userNodes();
    return u.length ? u[u.length - 1] : null;
  }
  function lastAssistantAfter(node) {
    var list = qsa(SEL.assistantMarked);
    for (var i = list.length - 1; i >= 0; i--) if (!node || after(node, list[i])) return list[i];
    return null;
  }
  function actionRowAfter(node) {
    var rows = allOf(SEL.actionRow);
    for (var i = 0; i < rows.length; i++) if (!node || after(node, rows[i])) return rows[i];
    return null;
  }
  function textOf(el) {
    return el ? (el.innerText || el.textContent || '') : '';
  }
  function isChallenge() {
    if (/just a moment|attention required|verify you are human/i.test(document.title)) return true;
    if (first(SEL.challenge)) return true;
    var body = document.body ? textOf(document.body).slice(0, 2000) : '';
    return /verify you are human|checking if the site connection is secure/i.test(body) && !findComposer();
  }
  var sessionCache = { at: 0, loggedIn: null, token: null };
  async function sessionInfo(force) {
    if (!force && Date.now() - sessionCache.at < 60000 && sessionCache.loggedIn !== null) return sessionCache;
    try {
      var res = await fetch('/api/auth/session', { credentials: 'include' });
      if (res.ok) {
        var j = await res.json();
        sessionCache = { at: Date.now(), loggedIn: !!(j && j.accessToken), token: (j && j.accessToken) || null };
      } else if (res.status === 401 || res.status === 403) {
        sessionCache = { at: Date.now(), loggedIn: false, token: null };
      }
    } catch (e) {
      // network trouble: keep the old value
    }
    return sessionCache;
  }
  function isLoginPage() {
    if (/^auth\.|\.auth\./i.test(location.hostname) || /\/auth\/login|\/log-?in(\/|$)/i.test(location.pathname)) return true;
    if (first(SEL.loginButton) && !first(SEL.profileButton) && sessionCache.loggedIn !== true) return true;
    return sessionCache.loggedIn === false;
  }
  function pageState() {
    if (isChallenge()) return 'challenge';
    if (isLoginPage()) return 'login';
    if (findComposer()) return 'ready';
    return 'loading';
  }
  function usageLimitText() {
    var u = lastUserNode();
    var zones = qsa('[role="alert"], [data-testid*="limit" i], [class*="limit" i]');
    var texts = zones.map(textOf);
    if (u) {
      var tail = '';
      var el = u;
      for (var i = 0; i < 6 && el; i++) {
        el = el.parentElement;
      }
      tail = el ? textOf(el).slice(-1500) : '';
      texts.push(tail);
    }
    for (var k = 0; k < texts.length; k++) {
      if (/you['’]ve (reached|hit) (the|your) [a-z ]*limit|usage cap|limit for gpt|you['’]ve reached our limit/i.test(texts[k])) return texts[k].slice(0, 200);
    }
    return null;
  }
  function currentConversationId() {
    return S.conversationIdFromUrl(location.href);
  }

  function debugSnapshot(step, extra) {
    var snap = {
      step: step,
      v: SCRIPT_VERSION,
      url: location.href.slice(0, 160),
      title: document.title.slice(0, 80),
      generating: !!stopButton(),
      composer: !!findComposer(),
      send: !!sendButton(),
      shape: {
        users: userNodes().length,
        assistants: qsa(SEL.assistantMarked).length,
        markers: markersPresent(),
        actionRows: allOf(SEL.actionRow).length,
        imgs: document.images.length,
        articles: qsa('article').length,
        dialogs: qsa('[role="dialog"]').length,
      },
      markers: SEL.marker.filter(function (s) {
        return !!qs(s);
      }),
      lastRead: state.lastReadInfo,
      slotLevel: state.slotLevel,
      throttledSec: Math.round(state.throttledMs / 1000),
    };
    if (extra) for (var k in extra) snap[k] = extra[k];
    return snap;
  }

  // ---------- pending job (survives reloads) ----------
  function loadPending() {
    try {
      var p = JSON.parse(sessionStorage.getItem(PENDING_KEY) || 'null');
      if (p && p.job && Date.now() - p.startedAt < 40 * 60000) return p;
    } catch (e) {
      /* ignore */
    }
    return null;
  }
  function savePending(p) {
    try {
      sessionStorage.setItem(PENDING_KEY, JSON.stringify(p));
    } catch (e) {
      /* ignore */
    }
  }
  function clearPending() {
    try {
      sessionStorage.removeItem(PENDING_KEY);
    } catch (e) {
      /* ignore */
    }
  }

  // ---------- progress & cancellation ----------
  var lastProgressAt = 0;
  async function progress(pending, step, force, extra) {
    state.step = step;
    if (!force && Date.now() - lastProgressAt < 5000) return true;
    lastProgressAt = Date.now();
    var conv = S.cleanConversationUrl(location.href);
    var resp = await send({ type: 'progress', jobId: pending.job.id, step: step, conversationUrl: conv, debug: debugSnapshot(step, extra) });
    if (resp && resp.continue === false) throw err('CANCELLED', 'The job was cancelled or taken over.');
    return true;
  }

  // ---------- conversation reads (shared slot, per-tab cache) ----------
  async function accessToken() {
    var s = await sessionInfo(false);
    if (!s.token) s = await sessionInfo(true);
    return s.token;
  }
  async function fetchConversation(convId) {
    var token = await accessToken();
    var headers = token ? { Authorization: 'Bearer ' + token } : {};
    var res;
    try {
      res = await fetch('/backend-api/conversation/' + encodeURIComponent(convId), { credentials: 'include', headers: headers });
    } catch (e) {
      return { status: 0 };
    }
    var retryAfter = Number(res.headers.get('retry-after')) || 0;
    var slot = await send({ type: 'readResult', status: res.status, retryAfter: retryAfter });
    if (slot && typeof slot.level === 'number') state.slotLevel = slot.level;
    if (res.status === 401) sessionCache.at = 0;
    if (!res.ok) return { status: res.status, retryAfter: retryAfter };
    try {
      return { status: 200, data: await res.json() };
    } catch (e) {
      return { status: 0 };
    }
  }
  /** At most one read per tab per 5 s; all tabs share one slot. Returns {fresh, waiting, result}. */
  async function readConversation(convId) {
    var c = state.readCache;
    if (c && c.convId === convId && Date.now() - c.at < PER_TAB_READ_GAP_MS) return { fresh: false, waiting: false, result: c.result };
    var slot = await send({ type: 'readSlot' });
    if (slot && typeof slot.level === 'number') state.slotLevel = slot.level;
    if (!slot || !slot.granted) return { fresh: false, waiting: true, waitMs: (slot && slot.waitMs) || 1000, level: (slot && slot.level) || 0, result: c && c.convId === convId ? c.result : null };
    var r = await fetchConversation(convId);
    state.readCache = { convId: convId, at: Date.now(), result: r };
    return { fresh: true, waiting: false, result: r };
  }

  // ---------- waiting for a usable page ----------
  async function waitReady(pending) {
    var started = Date.now();
    var notified = false;
    for (;;) {
      await sessionInfo(false);
      var st = pageState();
      if (st === 'ready') return;
      if (st === 'login' || st === 'challenge') {
        if (!notified) {
          notified = true;
          send({
            type: 'notify',
            title: st === 'login' ? 'ChatGPT needs a login' : 'ChatGPT asks for a human check',
            message: st === 'login' ? 'Log in to ChatGPT in the Automation Chrome. The prompt waits up to 10 minutes.' : 'Complete the check in the Automation Chrome. The prompt waits up to 10 minutes.',
          });
        }
        if (Date.now() - started > LOGIN_WAIT_MS) throw err('LOGIN', st === 'login' ? 'ChatGPT asked for a login and nobody logged in within 10 minutes.' : 'ChatGPT asked for a human check that was not completed within 10 minutes.');
        await progress(pending, st === 'login' ? 'waiting-login' : 'waiting-human-check', false);
        await sleep(3000);
        if (st === 'login') await sessionInfo(true);
        continue;
      }
      if (Date.now() - started > 90000) throw err('ERROR', 'ChatGPT did not finish loading (no message box after 90 s).');
      await progress(pending, 'waiting-page', false);
      await sleep(1000);
    }
  }

  /** The saved chat must really open: messages on the page, or a successful conversation read. */
  async function verifyConversation(pending, convId) {
    var started = Date.now();
    var throttledSince = null;
    for (;;) {
      if (userNodes().length > 0 || qs(SEL.assistantMarked)) return;
      if (/unable to load conversation|conversation not found|couldn['’]t find this conversation/i.test(document.body ? textOf(document.body).slice(0, 3000) : '')) {
        throw err('CONVERSATION_LOST', 'ChatGPT says the saved conversation cannot be loaded.');
      }
      var r = await readConversation(convId);
      if (r.fresh && r.result) {
        if (r.result.status === 200) return;
        if (r.result.status === 404 || r.result.status === 403) throw err('CONVERSATION_LOST', 'The saved conversation does not exist any more (HTTP ' + r.result.status + ').');
      }
      var limited = (r.result && r.result.status === 429) || (r.waiting && r.level > 0);
      if (limited) {
        throttledSince = throttledSince || Date.now();
        if (Date.now() - throttledSince > 150000) throw err('CONVERSATION_LOST', 'The saved chat could not be opened while ChatGPT rate-limits reads (HTTP 429).');
      } else {
        throttledSince = null;
      }
      if (Date.now() - started > 90000 && !limited) throw err('CONVERSATION_LOST', 'The saved chat did not load within 90 seconds.');
      await progress(pending, 'opening-chat', false);
      await sleep(1500);
    }
  }

  // ---------- typing ----------
  function composerText(el) {
    if (!el) return '';
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') return el.value || '';
    return el.innerText || el.textContent || '';
  }
  function setNativeValue(el, value) {
    var proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    var setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
  function clearComposer(el) {
    el.focus();
    if (el.tagName === 'TEXTAREA') return setNativeValue(el, '');
    var sel = window.getSelection();
    var range = document.createRange();
    range.selectNodeContents(el);
    sel.removeAllRanges();
    sel.addRange(range);
    document.execCommand('delete', false);
  }
  function placeCaretAtEnd(el) {
    el.focus();
    if (el.tagName === 'TEXTAREA') return;
    var range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }
  function pasteText(el, text) {
    var dt = new DataTransfer();
    dt.setData('text/plain', text);
    var ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
    el.dispatchEvent(ev);
    return ev.defaultPrevented;
  }
  function insertText(el, text) {
    placeCaretAtEnd(el);
    if (el.tagName === 'TEXTAREA') return setNativeValue(el, (el.value || '') + text);
    document.execCommand('insertText', false, text);
  }
  function pastedTextChips() {
    var form = (findComposer() || document.body).closest('form') || document.body;
    return qsa('*', form).filter(function (el) {
      return el.children.length < 6 && /pasted text(\s*\(\d+\))?(\.txt)?/i.test(el.textContent || '') && (el.textContent || '').length < 80;
    });
  }
  function removePastedChips() {
    var removed = 0;
    pastedTextChips().forEach(function (chip) {
      var box = chip.closest('[class*="attachment" i], [data-testid*="attachment" i], [class*="file" i], li, div') || chip;
      var btn = qs('button[aria-label*="Remove" i], button[aria-label*="Delete" i], button[data-testid*="remove" i]', box);
      if (btn) {
        btn.click();
        removed++;
      }
    });
    return removed;
  }
  function composerHolds(el, prompt) {
    var have = S.normalizeWhitespace(composerText(el));
    var want = S.normalizeWhitespace(prompt);
    if (!have || have.length < want.length * 0.97) return false;
    var n = Math.min(120, Math.floor(want.length / 2));
    return have.slice(0, n) === want.slice(0, n) && have.slice(-n) === want.slice(-n);
  }

  async function typePrompt(pending, prompt) {
    for (var attempt = 1; attempt <= 3; attempt++) {
      var el = findComposer();
      for (var w = 0; !el && w < 20; w++) {
        await sleep(500);
        el = findComposer();
      }
      if (!el) throw err('ERROR', 'The ChatGPT message box was not found.');
      clearComposer(el);
      await sleep(150);
      // Long prompts are typed: pasting them makes ChatGPT turn them into a "Pasted text.txt" attachment.
      if (prompt.length <= PASTE_LIMIT) {
        if (!pasteText(el, prompt) || !S.normalizeWhitespace(composerText(el))) insertText(el, prompt);
      } else {
        insertText(el, prompt);
      }
      await sleep(400);
      if (removePastedChips() > 0) {
        await sleep(300);
        el = findComposer() || el;
        clearComposer(el);
        insertText(el, prompt);
        await sleep(400);
        removePastedChips();
      }
      el = findComposer();
      if (el && composerHolds(el, prompt) && pastedTextChips().length === 0) return el;
      await progress(pending, 'retyping', false, { attempt: attempt, have: S.normalizeWhitespace(composerText(el)).length, want: S.normalizeWhitespace(prompt).length });
      await sleep(700);
    }
    throw err('ERROR', 'The prompt could not be typed completely into the ChatGPT message box (ChatGPT kept re-rendering it).');
  }

  function base64ToFile(a) {
    var bin = atob(a.base64);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new File([bytes], a.name, { type: a.mime || 'image/jpeg' });
  }

  async function attachFiles(pending, attachments) {
    var input = null;
    for (var w = 0; w < 20 && !input; w++) {
      input = first(SEL.fileInput);
      if (!input) await sleep(500);
    }
    if (!input) throw err('ERROR', 'ChatGPT has no file upload field on this page.');
    var dt = new DataTransfer();
    attachments.forEach(function (a) {
      dt.items.add(base64ToFile(a));
    });
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    var form = (findComposer() || document.body).closest('form') || document.body;
    var started = Date.now();
    while (Date.now() - started < 60000) {
      var previews = qsa('img', form).length + qsa('[class*="attachment" i], [data-testid*="attachment" i], [data-testid*="file" i]', form).length;
      if (previews >= attachments.length) break;
      await progress(pending, 'uploading', false);
      await sleep(800);
    }
  }

  function buttonEnabled(b) {
    return !!b && !b.disabled && b.getAttribute('aria-disabled') !== 'true';
  }

  async function clickSend(pending, el, waitMs) {
    var started = Date.now();
    var btn = sendButton();
    while (!buttonEnabled(btn) && Date.now() - started < waitMs) {
      await progress(pending, 'waiting-send-button', false);
      await sleep(500);
      btn = sendButton();
    }
    if (buttonEnabled(btn)) {
      btn.click();
    } else {
      (el || findComposer()).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
    }
  }

  // ---------- reading the answer ----------
  function clickHelpers() {
    var buttons = qsa('button');
    for (var i = 0; i < buttons.length; i++) {
      var t = (buttons[i].textContent || '').trim();
      if (/^continue generating$/i.test(t) && visible(buttons[i])) {
        buttons[i].click();
        return 'continue';
      }
    }
    if (/which response do you prefer/i.test(document.body ? textOf(document.body).slice(-4000) : '')) {
      var opt = buttons.filter(function (b) {
        return /prefer (this )?response|response 1|i prefer this/i.test(b.textContent || '') && visible(b);
      })[0];
      if (opt) {
        opt.click();
        return 'preference';
      }
    }
    return null;
  }

  function pageAnswer(userNode) {
    var a = lastAssistantAfter(userNode);
    if (!a) return null;
    var md = qs('.markdown', a) || a;
    return { node: a, text: S.cleanAnswerText(textOf(md)), html: S.stripCanvasMarksHtml(md.innerHTML || '') };
  }

  /**
   * Waits until the answer to our prompt is complete. `ctx.sentAt` is null when recovering an answer that was
   * already in the chat. Time spent waiting on HTTP 429 does not count toward the limits.
   */
  async function waitForAnswer(pending, ctx) {
    var started = Date.now();
    var timeoutMs = Math.max(60, Math.min(900, pending.job.timeoutSec || 600)) * 1000;
    var promptSeen = !!ctx.recovered;
    var lastPageText = null;
    var lastChangeAt = Date.now();
    var lastReadAnswer = null; // stability across two separate fresh reads (never reset by slot waits)
    state.throttledMs = 0;
    for (;;) {
      var now = Date.now();
      var elapsed = now - started - state.throttledMs;
      if (elapsed > timeoutMs) throw err('ERROR', 'ChatGPT did not finish the answer within ' + Math.round(timeoutMs / 1000) + ' s.');
      if (!promptSeen && elapsed > PROMPT_APPEAR_MS) throw err('ERROR', 'The prompt did not appear in the chat within 180 s.');
      await progress(pending, promptSeen ? 'waiting-answer' : 'waiting-prompt', false);
      var helper = clickHelpers();
      if (helper) await sleep(500);
      var limit = usageLimitText();
      if (limit) throw err('USAGE_LIMIT', 'ChatGPT usage limit: ' + limit);
      if (pageState() === 'login') throw err('LOGIN', 'ChatGPT logged out while answering.');

      var userNode = lastUserNode();
      if (userNode && !promptSeen && S.promptsMatch(textOf(userNode), pending.job.prompt)) promptSeen = true;
      // Long prompts may be shown collapsed: a new user message after sending is ours.
      if (!promptSeen && typeof ctx.usersBefore === 'number' && userNodes().length > ctx.usersBefore) promptSeen = true;

      if (markersPresent()) {
        // Old page variant: read the last assistant node after the last user node.
        var pa = pageAnswer(userNode);
        if (pa && promptSeen) {
          if (pa.text !== lastPageText) {
            lastPageText = pa.text;
            lastChangeAt = Date.now();
          }
          var done = !stopButton() && Date.now() - lastChangeAt >= STABLE_PAGE_MS && !!actionRowAfter(pa.node) && pa.text.length > 0;
          if (done) return { text: pa.text, html: pa.html, via: 'page' };
        }
        await sleep(1000);
        continue;
      }

      // Current variant: read the conversation endpoint once the action row is under the answer (or after 45 s).
      var convId = currentConversationId();
      var rowShown = !!actionRowAfter(userNode) && !stopButton();
      var sinceSend = ctx.sentAt ? Date.now() - ctx.sentAt - state.throttledMs : ACTION_ROW_WAIT_MS;
      if (!convId || (!rowShown && sinceSend < ACTION_ROW_WAIT_MS && !ctx.recovered)) {
        await sleep(1000);
        continue;
      }
      var tickStart = Date.now();
      var r = await readConversation(convId);
      if (r.waiting) {
        if (r.level > 0) state.throttledMs += Math.min(r.waitMs, 3000) + (Date.now() - tickStart);
        await sleep(Math.min(r.waitMs, 3000));
        continue;
      }
      if (!r.fresh) {
        await sleep(1000);
        continue;
      }
      var res = r.result;
      if (res.status === 429) {
        state.throttledMs += Math.max(1000, (res.retryAfter || 1) * 1000) + (Date.now() - tickStart);
        state.lastReadInfo = { http: 429, level: state.slotLevel };
        await sleep(1000);
        continue;
      }
      if (res.status === 404) throw err('CONVERSATION_LOST', 'The conversation disappeared while waiting for the answer (HTTP 404).');
      if (res.status !== 200) {
        state.lastReadInfo = { http: res.status };
        await sleep(2000);
        continue;
      }
      var an = S.analyzeConversation(res.data, { prompt: pending.job.prompt, sentAt: ctx.sentAt });
      state.lastReadInfo = { http: 200, role: an.lastRole, status: an.status, end_turn: an.endTurn, chars: an.chars, found: an.promptFound };
      if (an.promptFound) promptSeen = true;
      if (an.promptFound && an.finished && an.answer) {
        if (an.endTurn === true || lastReadAnswer === an.answer) return { text: an.answer, html: '', via: 'conversation' };
        lastReadAnswer = an.answer;
      } else if (an.promptFound) {
        lastReadAnswer = an.finished ? an.answer : null;
      }
      await sleep(1000);
    }
  }

  // ---------- images ----------
  function imageKey(img) {
    return img.currentSrc || img.src || '';
  }
  function snapshotImages() {
    var set = {};
    Array.prototype.forEach.call(document.images, function (img) {
      set[imageKey(img)] = true;
    });
    return set;
  }
  function blobToBase64(blob) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () {
        resolve(String(r.result).split(',')[1] || '');
      };
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
  }
  async function toJpeg(blob, crop, maxSide) {
    var bmp = await createImageBitmap(blob);
    var w = bmp.width;
    var h = bmp.height;
    var canvas = document.createElement('canvas');
    if (crop) {
      canvas.width = crop.width;
      canvas.height = crop.height;
      var scale = Math.max(crop.width / w, crop.height / h);
      var sw = crop.width / scale;
      var sh = crop.height / scale;
      canvas.getContext('2d').drawImage(bmp, (w - sw) / 2, (h - sh) / 2, sw, sh, 0, 0, crop.width, crop.height);
    } else {
      var f = Math.min(1, (maxSide || 2400) / Math.max(w, h));
      canvas.width = Math.round(w * f);
      canvas.height = Math.round(h * f);
      canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
    }
    var out = await new Promise(function (resolve) {
      canvas.toBlob(resolve, 'image/jpeg', 0.92);
    });
    return { base64: await blobToBase64(out), width: canvas.width, height: canvas.height, mime: 'image/jpeg' };
  }
  /** Bytes of a displayed picture: same-origin/CORS fetch here, otherwise through the background. */
  async function fetchImage(url, crop, maxSide) {
    try {
      if (/^(blob:|data:)/.test(url) || new URL(url, location.href).origin === location.origin) {
        var res = await fetch(url, { credentials: 'include' });
        if (res.ok) return await toJpeg(await res.blob(), crop, maxSide);
      }
    } catch (e) {
      /* fall back to the background */
    }
    var r = await send({ type: 'fetchImage', url: url, crop: crop || null, maxSide: maxSide || 2400 });
    if (r && r.base64) return r;
    return null;
  }

  async function collectGeneratedImages(pending, before, count) {
    var started = Date.now();
    var stableSince = 0;
    var lastCount = 0;
    var userNode = lastUserNode();
    while (Date.now() - started < 300000) {
      await progress(pending, 'waiting-images', false);
      var imgs = Array.prototype.filter.call(document.images, function (img) {
        return !before[imageKey(img)] && img.complete && img.naturalWidth >= 700 && (!userNode || after(userNode, img));
      });
      var unique = [];
      imgs.forEach(function (img) {
        if (unique.every(function (u) {
          return imageKey(u) !== imageKey(img);
        })) unique.push(img);
      });
      if (unique.length !== lastCount) {
        lastCount = unique.length;
        stableSince = Date.now();
      }
      if (unique.length >= count && !stopButton() && Date.now() - stableSince > 3000) {
        var files = [];
        for (var i = 0; i < unique.length && files.length < count; i++) {
          var f = await fetchImage(imageKey(unique[i]), { width: 1920, height: 1080 });
          if (f) files.push(f);
        }
        if (files.length) return files;
      }
      await sleep(1500);
    }
    throw err('ERROR', 'ChatGPT did not show the generated picture within 5 minutes.');
  }

  function fetchableHost(url) {
    try {
      var h = new URL(url, location.href).hostname;
      return h === location.hostname || /(^|\.)images\.openai\.com$|(^|\.)oaiusercontent\.com$|(^|\.)mm\.bing\.net$|^localhost$|^127\.0\.0\.1$|(^|\.)chatgpt\.com$/i.test(h);
    } catch (e) {
      return false;
    }
  }

  function galleryThumbs(userNode) {
    return Array.prototype.filter.call(document.images, function (img) {
      var r = img.getBoundingClientRect();
      var src = imageKey(img);
      return /^https?:|^blob:/.test(src) && (!userNode || after(userNode, img)) && r.width >= 60 && r.height >= 60 && !img.closest('form') && !/avatar|favicon|logo/i.test((img.alt || '') + ' ' + src);
    });
  }

  async function collectGallery(pending) {
    var started = Date.now();
    var userNode = lastUserNode();
    var thumbs = galleryThumbs(userNode);
    while (!thumbs.length && Date.now() - started < GALLERY_WAIT_MS) {
      await progress(pending, 'waiting-gallery', false);
      await sleep(2000);
      thumbs = galleryThumbs(userNode);
    }
    if (!thumbs.length) throw err('ERROR', 'NO_IMAGES: ChatGPT answered the image search without a picture gallery.');
    var seen = {};
    var picked = [];
    function add(img) {
      var src = imageKey(img);
      if (!src || seen[src] || picked.length >= 10) return;
      seen[src] = true;
      picked.push({ url: src, width: img.naturalWidth || 0, height: img.naturalHeight || 0 });
    }
    // Open the gallery like a person and save the large pictures it shows.
    try {
      thumbs[0].click();
      await sleep(1200);
      for (var step = 0; step < 12 && picked.length < 10; step++) {
        var dialog = qs('[role="dialog"]');
        if (!dialog) break;
        var big = qsa('img', dialog).filter(function (i) {
          return i.naturalWidth >= 200;
        });
        big.sort(function (a, b) {
          return b.naturalWidth * b.naturalHeight - a.naturalWidth * a.naturalHeight;
        });
        if (big[0]) add(big[0]);
        var next = qs('button[aria-label*="Next" i], button[data-testid*="next" i]', dialog);
        if (!next || next.disabled) break;
        next.click();
        await sleep(900);
      }
      var close = qs('[role="dialog"] button[aria-label*="Close" i]');
      if (close) close.click();
      else document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    } catch (e) {
      /* the thumbnails are enough */
    }
    thumbs.forEach(add);
    var files = [];
    var links = [];
    for (var i = 0; i < picked.length; i++) {
      var p = picked[i];
      if (fetchableHost(p.url)) {
        var f = await fetchImage(p.url, null, 2400);
        if (f) files.push({ base64: f.base64, width: f.width, height: f.height, mime: f.mime, source: p.url });
        else links.push(p);
      } else {
        links.push(p);
      }
      await progress(pending, 'saving-gallery', false, { saved: files.length, links: links.length });
    }
    return { files: files, links: links };
  }

  // ---------- the job ----------
  function homeUrl(job) {
    try {
      return new URL(job.chatgptUrl || '/', location.origin).origin + '/';
    } catch (e) {
      return location.origin + '/';
    }
  }

  async function runJob(pending) {
    var job = pending.job;
    state.busy = true;
    state.jobId = job.id;
    var wantConv = job.newChat ? null : S.conversationIdFromUrl(job.conversationUrl);
    var navigating = false;
    try {
      // 1. Open the right page.
      if (pending.phase === 'opening') {
        var here = currentConversationId();
        var needsNav = wantConv ? here !== wantConv : !!here || /\/c\//.test(location.pathname);
        if (needsNav) {
          pending.navigations = (pending.navigations || 0) + 1;
          if (pending.navigations > 3) throw err(wantConv ? 'CONVERSATION_LOST' : 'ERROR', 'ChatGPT kept redirecting away from the chat.');
          savePending(pending);
          await progress(pending, 'navigating', true);
          navigating = true;
          location.href = wantConv ? homeUrl(job) + 'c/' + wantConv : homeUrl(job);
          return; // the script restarts on the new page and continues from sessionStorage
        }
        pending.phase = 'ready';
        savePending(pending);
      }

      // 2. Wait for ready (login / human check wait up to 10 minutes).
      await progress(pending, 'waiting-page', true);
      await waitReady(pending);
      if (wantConv) {
        if (currentConversationId() !== wantConv) throw err('CONVERSATION_LOST', 'ChatGPT did not open the saved chat.');
        await verifyConversation(pending, wantConv);
      }

      var answer = null;
      var reused = false;
      var before = snapshotImages();

      // 3. Recover first: our prompt may already be in this chat (retry, restart, reload after sending).
      var checkConv = wantConv || (pending.phase === 'sent' ? currentConversationId() : null);
      if (pending.phase === 'sent' || (job.allowReuse && wantConv)) {
        var lastUser = lastUserNode();
        var match = lastUser && S.promptsMatch(textOf(lastUser), job.prompt);
        if (!match && checkConv) {
          for (var tries = 0; tries < 30 && !match; tries++) {
            var rr = await readConversation(checkConv);
            if (rr.fresh && rr.result && rr.result.status === 200) {
              var a0 = S.analyzeConversation(rr.result.data, { prompt: job.prompt });
              match = a0.promptFound && S.promptsMatch(a0.lastUserText, job.prompt);
              break;
            }
            await progress(pending, 'checking-chat', false);
            await sleep(Math.min((rr && rr.waitMs) || 1500, 3000));
          }
        }
        if (match) {
          await progress(pending, 'recovering-answer', true);
          answer = await waitForAnswer(pending, { sentAt: null, recovered: true });
          reused = true;
        } else if (pending.phase === 'sent') {
          // We sent it but it is not in this chat: send again below.
          pending.phase = 'ready';
        }
      }

      // 4.–6. Type, attach, send, wait.
      if (!answer) {
        await progress(pending, 'typing', true);
        var attachments = job.attachments || [];
        if (attachments.length) await attachFiles(pending, attachments);
        var el = await typePrompt(pending, job.prompt);
        before = snapshotImages();
        var usersBefore = userNodes().length;
        await clickSend(pending, el, attachments.length ? 120000 : 15000);
        pending.phase = 'sent';
        pending.sentAt = Date.now();
        savePending(pending);
        await progress(pending, 'sent', true);
        answer = await waitForAnswer(pending, { sentAt: pending.sentAt, recovered: false, usersBefore: usersBefore });
      }

      var images = [];
      var imageLinks = [];
      if (job.expect === 'images') {
        images = await collectGeneratedImages(pending, reused ? {} : before, job.imageCount || 1);
      } else if (job.expect === 'gallery') {
        var g = await collectGallery(pending);
        images = g.files;
        imageLinks = g.links;
        if (!images.length && !imageLinks.length) throw err('ERROR', 'NO_IMAGES: the gallery had no usable pictures.');
      }

      // 7. Report.
      var result = await send({
        type: 'complete',
        jobId: job.id,
        text: answer.text,
        html: answer.html || '',
        via: answer.via,
        conversationUrl: S.cleanConversationUrl(location.href),
        reusedExisting: reused,
        images: images,
        imageLinks: imageLinks,
        debug: debugSnapshot('complete'),
      });
      if (result && result.error) throw err('ERROR', 'Could not report the answer: ' + result.error);
    } catch (e) {
      var code = e && e.code ? e.code : 'ERROR';
      if (code === 'CANCELLED') {
        var stop = stopButton();
        if (stop) stop.click();
      }
      await send({
        type: 'fail',
        jobId: job.id,
        code: code,
        message: String((e && e.message) || e).slice(0, 1000),
        conversationUrl: S.cleanConversationUrl(location.href),
        debug: debugSnapshot('failed', { error: String((e && e.message) || e).slice(0, 300) }),
      });
    } finally {
      if (!navigating) clearPending();
      state.busy = false;
      state.jobId = null;
      state.step = 'idle';
    }
  }

  // ---------- idle loop ----------
  var notReadySince = null;

  async function idleLoop() {
    for (;;) {
      if (state.dead) return;
      await sleep(state.busy ? 2000 : 2500 + Math.random() * 1000);
      if (state.busy) continue;
      await sessionInfo(false);
      var st = pageState();
      var hello = await send({ type: 'hello', version: SCRIPT_VERSION, state: st, conversationId: currentConversationId() });
      if (hello.dead || state.dead) return;
      if (st !== 'ready') {
        notReadySince = notReadySince || Date.now();
        // A chat page that never finished loading: go back to the start page so the tab can work again.
        if (st === 'loading' && /\/c\//.test(location.pathname) && Date.now() - notReadySince > IDLE_STUCK_MS) {
          notReadySince = null;
          location.href = location.origin + '/';
          return;
        }
        continue;
      }
      notReadySince = null;
      if (!hello.configured || !hello.canClaim) continue;
      var resp = await send({ type: 'claim', conversationId: currentConversationId(), features: FEATURES, version: SCRIPT_VERSION });
      if (!resp || !resp.job) continue;
      var pending = { job: resp.job, phase: 'opening', startedAt: Date.now(), sentAt: null, navigations: 0 };
      savePending(pending);
      await runJob(pending);
    }
  }

  // ---------- messages from the background ----------
  try {
    chrome.runtime.onMessage.addListener(function (msg, _sender, reply) {
      if (msg && msg.type === 'ping') {
        reply({ version: SCRIPT_VERSION, busy: state.busy, jobId: state.jobId, step: state.step, state: pageState(), conversationId: currentConversationId() });
        return false;
      }
      if (msg && msg.type === 'debug') {
        reply(debugSnapshot(state.step));
        return false;
      }
      return false;
    });
  } catch (e) {
    state.dead = true;
  }

  // ---------- start ----------
  (async function start() {
    var pending = loadPending();
    if (pending) {
      if (pending.phase === 'opening') pending.phase = 'ready';
      savePending(pending);
      await sleep(1500);
      await runJob(pending);
    }
    idleLoop();
  })();
})();
