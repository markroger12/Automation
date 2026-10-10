/*
 * ChatGPT Worker — background service worker.
 * Talks to the app (POST /api/extension/agent with the connection key), opens/closes ChatGPT tabs in the
 * Automation Chrome, records which tab holds which job, arbitrates the shared conversation-read slot,
 * fetches pictures and shows notifications.
 */
'use strict';

var CODE_VERSION = '1.0.0';
importScripts('lib/shared.js');
var S = self.BASShared;

var CHATGPT_MATCH = 'https://chatgpt.com/*';
var IDLE_CLOSE_MS = 20000;
var STATUS_FAST_MS = 10000;

// Chrome caches background.js and can run old code under a new manifest version: reload once.
(async function versionCheck() {
  var manifestVersion = chrome.runtime.getManifest().version;
  if (manifestVersion === CODE_VERSION) return;
  var g = (await chrome.storage.local.get('reloadedFor')).reloadedFor || {};
  if (g.version === manifestVersion && Date.now() - g.at < 10 * 60000) return;
  await chrome.storage.local.set({ reloadedFor: { version: manifestVersion, at: Date.now() } });
  chrome.runtime.reload();
})();

// ---------- config ----------
async function getConfig() {
  var c = await chrome.storage.local.get(['appUrl', 'key', 'paused', 'windowMode', 'automationChrome']);
  return {
    appUrl: (c.appUrl || '').replace(/\/+$/, ''),
    key: c.key || '',
    paused: !!c.paused,
    windowMode: c.windowMode === 'windows' ? 'windows' : 'tabs',
    automationChrome: !!c.automationChrome,
  };
}

async function agent(action, body) {
  var cfg = await getConfig();
  if (!cfg.appUrl || !cfg.key) return { error: 'not-configured' };
  try {
    var res = await fetch(cfg.appUrl + '/api/extension/agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.key },
      body: JSON.stringify(Object.assign({ action: action, version: CODE_VERSION }, body || {})),
    });
    var data = {};
    try {
      data = await res.json();
    } catch (e) {
      data = {};
    }
    if (!res.ok) {
      data.error = data.error || 'HTTP ' + res.status;
      data.httpStatus = res.status;
    }
    if (action === 'status' || !res.ok) {
      await chrome.storage.local.set({ lastContact: { at: Date.now(), ok: res.ok, status: res.status, error: res.ok ? null : data.error } });
    }
    return data;
  } catch (e) {
    await chrome.storage.local.set({ lastContact: { at: Date.now(), ok: false, status: 0, error: String((e && e.message) || e) } });
    return { error: String((e && e.message) || e), network: true };
  }
}

// ---------- tab registry (serialised, mirrored in chrome.storage.session) ----------
var mem = null;
var chain = Promise.resolve();
function withState(fn) {
  var run = chain.then(async function () {
    if (!mem) mem = (await chrome.storage.session.get('st')).st || { tabs: {} };
    var out = await fn(mem);
    await chrome.storage.session.set({ st: mem });
    return out;
  });
  chain = run.catch(function () {});
  return run;
}
function tabEntry(st, tabId) {
  var k = String(tabId);
  if (!st.tabs[k]) st.tabs[k] = { managed: false, openedAt: Date.now(), idleSince: Date.now(), jobId: null, closing: false, state: null, noPing: 0 };
  return st.tabs[k];
}

// ---------- shared read slot (all tabs, all windows) ----------
var slotChain = Promise.resolve();
function withSlot(fn) {
  var run = slotChain.then(async function () {
    var slot = (await chrome.storage.local.get('readSlot')).readSlot || { nextAt: 0, level: 0 };
    var r = fn(slot, Date.now());
    await chrome.storage.local.set({ readSlot: r.slot });
    return r;
  });
  slotChain = run.catch(function () {});
  return run;
}

// ---------- pictures ----------
function bytesToBase64(buf) {
  var bytes = new Uint8Array(buf);
  var s = '';
  for (var i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
async function fetchImageAsJpeg(url, crop, maxSide) {
  var res = await fetch(url, { credentials: 'include' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  var blob = await res.blob();
  var bmp = await createImageBitmap(blob);
  var w = bmp.width;
  var h = bmp.height;
  var canvas;
  if (crop) {
    canvas = new OffscreenCanvas(crop.width, crop.height);
    var scale = Math.max(crop.width / w, crop.height / h);
    var sw = crop.width / scale;
    var sh = crop.height / scale;
    canvas.getContext('2d').drawImage(bmp, (w - sw) / 2, (h - sh) / 2, sw, sh, 0, 0, crop.width, crop.height);
  } else {
    var f = Math.min(1, (maxSide || 2400) / Math.max(w, h));
    canvas = new OffscreenCanvas(Math.round(w * f), Math.round(h * f));
    canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
  }
  var out = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.92 });
  return { base64: bytesToBase64(await out.arrayBuffer()), width: canvas.width, height: canvas.height, mime: 'image/jpeg' };
}

// ---------- notifications ----------
var lastNotified = {};
function notify(title, message) {
  if (Date.now() - (lastNotified[title] || 0) < 10 * 60000) return;
  lastNotified[title] = Date.now();
  try {
    chrome.notifications.create('bas-' + Date.now(), { type: 'basic', iconUrl: 'icons/icon128.png', title: title, message: message, priority: 2 });
  } catch (e) {
    /* notifications unavailable */
  }
}

// ---------- tabs ----------
async function openChatTab(cfg) {
  var url = 'https://chatgpt.com/';
  var tab;
  if (cfg.windowMode === 'windows') {
    var win = await chrome.windows.create({ url: url, focused: false, width: 1150, height: 900, state: 'normal' });
    tab = win.tabs && win.tabs[0];
  } else {
    var wins = await chrome.windows.getAll({ windowTypes: ['normal'] });
    if (!wins.length) {
      var w2 = await chrome.windows.create({ url: url, focused: false, state: 'normal' });
      tab = w2.tabs && w2.tabs[0];
    } else {
      tab = await chrome.tabs.create({ url: url, active: false, windowId: wins[wins.length - 1].id });
    }
  }
  if (tab) {
    await withState(function (st) {
      var e = tabEntry(st, tab.id);
      e.managed = true;
      e.openedAt = Date.now();
      e.idleSince = Date.now();
    });
  }
}

function pingTab(tabId) {
  return new Promise(function (resolve) {
    var done = false;
    var t = setTimeout(function () {
      if (!done) {
        done = true;
        resolve(null);
      }
    }, 3000);
    try {
      chrome.tabs.sendMessage(tabId, { type: 'ping' }, function (resp) {
        if (done) return;
        done = true;
        clearTimeout(t);
        if (chrome.runtime.lastError) return resolve(null);
        resolve(resp || null);
      });
    } catch (e) {
      clearTimeout(t);
      resolve(null);
    }
  });
}

async function closeTab(tabId) {
  // Marked as closing first: a claim that is in flight for this tab is released when it returns.
  await withState(function (st) {
    tabEntry(st, tabId).closing = true;
  });
  try {
    await chrome.tabs.remove(tabId);
  } catch (e) {
    /* already gone */
  }
}

var tickRunning = false;
var fastTimer = null;
async function statusTick() {
  if (tickRunning) return;
  tickRunning = true;
  try {
    var cfg = await getConfig();
    var chatTabs = await chrome.tabs.query({ url: CHATGPT_MATCH });
    var ready = 0;
    var loginNeeded = false;
    var reloads = [];
    var pings = {};
    for (var i = 0; i < chatTabs.length; i++) {
      var tab = chatTabs[i];
      if (tab.status !== 'complete' || tab.discarded) continue;
      var resp = await pingTab(tab.id);
      pings[tab.id] = resp;
      if (resp && resp.state === 'ready') ready++;
      if (resp && (resp.state === 'login' || resp.state === 'challenge')) loginNeeded = true;
    }
    await withState(function (st) {
      var alive = {};
      chatTabs.forEach(function (tab) {
        alive[tab.id] = true;
        var e = tabEntry(st, tab.id);
        if (tab.status !== 'complete') return;
        var resp = pings[tab.id];
        // A tab whose script is missing, orphaned (extension reloaded) or from another version is dead.
        if (!resp) e.noPing = (e.noPing || 0) + 1;
        else e.noPing = 0;
        if ((resp && resp.version !== CODE_VERSION) || e.noPing >= 2) {
          e.noPing = 0;
          reloads.push(tab.id);
        }
        if (resp) e.state = resp.state;
      });
      Object.keys(st.tabs).forEach(function (k) {
        if (!alive[k]) delete st.tabs[k];
      });
    });
    for (var r = 0; r < reloads.length; r++) {
      try {
        await chrome.tabs.reload(reloads[r]);
      } catch (e) {
        /* gone */
      }
    }
    if (loginNeeded) notify('ChatGPT needs your attention', 'Log in or complete the check in the Automation Chrome so the queued prompts can run.');

    var status = await agent('status', {
      tabs: chatTabs.length,
      readyTabs: ready,
      loginNeeded: loginNeeded,
      paused: cfg.paused,
      automationChrome: cfg.automationChrome,
      windowMode: cfg.windowMode,
      userAgent: navigator.userAgent,
    });
    if (status.error) return;
    var waiting = status.waiting || 0;
    var active = status.active || 0;
    var concurrency = Math.max(1, Math.min(5, status.concurrency || 1));

    if (cfg.automationChrome && !cfg.paused) {
      var want = Math.min(concurrency, waiting + active);
      var missing = waiting > 0 ? want - chatTabs.length : 0;
      for (var n = 0; n < missing; n++) await openChatTab(cfg);
    }

    // Close managed tabs that have been idle for 20 s and are not needed for waiting prompts.
    var toClose = await withState(function (st) {
      var holding = 0;
      var freeUnmanaged = 0;
      var freeRecent = 0;
      var idleLong = [];
      Object.keys(st.tabs).forEach(function (k) {
        var e = st.tabs[k];
        if (e.closing) return;
        if (e.jobId) holding++;
        else if (!e.managed) freeUnmanaged++;
        else if (e.idleSince && Date.now() - e.idleSince >= IDLE_CLOSE_MS) idleLong.push(Number(k));
        else freeRecent++;
      });
      var needIdle = Math.max(0, Math.min(concurrency - holding, waiting));
      var keep = Math.max(0, needIdle - freeUnmanaged - freeRecent);
      return idleLong.slice(keep);
    });
    for (var c = 0; c < toClose.length; c++) await closeTab(toClose[c]);

    if (fastTimer) clearTimeout(fastTimer);
    if (waiting > 0 || active > 0 || toClose.length) fastTimer = setTimeout(statusTick, STATUS_FAST_MS);
  } finally {
    tickRunning = false;
  }
}

// ---------- messages ----------
async function handle(msg, sender) {
  var tabId = sender && sender.tab ? sender.tab.id : null;
  var cfg;
  switch (msg && msg.type) {
    case 'hello': {
      cfg = await getConfig();
      var entry = await withState(function (st) {
        var e = tabEntry(st, tabId);
        e.state = msg.state;
        e.version = msg.version;
        return Object.assign({}, e);
      });
      if (msg.version !== CODE_VERSION) {
        chrome.tabs.reload(tabId).catch(function () {});
        return { configured: false, canClaim: false };
      }
      var configured = !!(cfg.appUrl && cfg.key);
      return { configured: configured, canClaim: configured && !entry.closing && (entry.managed || cfg.automationChrome), codeVersion: CODE_VERSION };
    }
    case 'claim': {
      var e0 = await withState(function (st) {
        return Object.assign({}, tabEntry(st, tabId));
      });
      if (e0.closing) return { job: null };
      if (e0.jobId) {
        // The page lost its job (reload without state): hand it back so it can be recovered.
        await agent('release', { jobId: e0.jobId, tabId: tabId, reason: 'tab claimed again' });
        await withState(function (st) {
          tabEntry(st, tabId).jobId = null;
        });
      }
      var resp = await agent('claim', { tabId: tabId, features: msg.features || [], conversationId: msg.conversationId || null, scriptVersion: msg.version });
      if (!resp || !resp.job) return { job: null, error: resp && resp.error };
      // The idle-closer may have marked or removed this tab while the claim was in flight.
      var exists = await chrome.tabs.get(tabId).then(
        function () {
          return true;
        },
        function () {
          return false;
        },
      );
      var stillOk = await withState(function (st) {
        var e = tabEntry(st, tabId);
        if (!exists || e.closing) return false;
        e.jobId = resp.job.id;
        e.idleSince = null;
        return true;
      });
      if (!stillOk) {
        await agent('release', { jobId: resp.job.id, tabId: tabId, reason: 'tab closing' });
        return { job: null };
      }
      return { job: resp.job };
    }
    case 'progress': {
      var p = await agent('progress', { jobId: msg.jobId, tabId: tabId, step: msg.step, debug: msg.debug, conversationUrl: msg.conversationUrl || null });
      if (p.error && !p.httpStatus) return { continue: true }; // app unreachable for a moment: keep going
      return { continue: p.continue !== false };
    }
    case 'complete':
    case 'fail': {
      var body = Object.assign({}, msg, { tabId: tabId });
      delete body.type;
      var r = await agent(msg.type, body);
      await withState(function (st) {
        var e = tabEntry(st, tabId);
        if (e.jobId === msg.jobId) e.jobId = null;
        e.idleSince = Date.now();
      });
      setTimeout(statusTick, IDLE_CLOSE_MS + 1000);
      setTimeout(statusTick, 1500);
      return r.error && r.httpStatus !== 409 ? { error: r.error } : { ok: true };
    }
    case 'readSlot': {
      var a = await withSlot(function (slot, now) {
        return S.slotTryAcquire(slot, now);
      });
      return { granted: a.granted, waitMs: a.waitMs, level: a.slot.level };
    }
    case 'readResult': {
      var b = await withSlot(function (slot, now) {
        return { slot: S.slotAfterResult(slot, msg.status, now, msg.retryAfter) };
      });
      return { level: b.slot.level };
    }
    case 'fetchImage': {
      try {
        return await fetchImageAsJpeg(msg.url, msg.crop, msg.maxSide);
      } catch (e) {
        return { error: String((e && e.message) || e) };
      }
    }
    case 'notify':
      notify(msg.title || 'ChatGPT Worker', msg.message || '');
      return { ok: true };
    case 'automation-page': {
      // The extension sees the app's /automation-chrome page: this Chrome is the Automation Chrome.
      var c = await getConfig();
      var update = { automationChrome: true };
      if (!c.appUrl && msg.origin) update.appUrl = msg.origin;
      await chrome.storage.local.set(update);
      statusTick();
      return { ok: true, version: CODE_VERSION, configured: !!(c.key && (c.appUrl || msg.origin)) };
    }
    // popup
    case 'getStatus': {
      cfg = await getConfig();
      var st2 = await withState(function (st) {
        return st;
      });
      var local = await chrome.storage.local.get(['lastContact', 'readSlot']);
      return { version: CODE_VERSION, config: { appUrl: cfg.appUrl, hasKey: !!cfg.key, paused: cfg.paused, windowMode: cfg.windowMode, automationChrome: cfg.automationChrome }, tabs: st2.tabs, lastContact: local.lastContact || null, readSlot: local.readSlot || null };
    }
    case 'saveConfig': {
      var upd = {};
      if (typeof msg.appUrl === 'string') upd.appUrl = msg.appUrl.trim().replace(/\/+$/, '');
      if (typeof msg.key === 'string' && msg.key.trim()) upd.key = msg.key.trim();
      if (typeof msg.paused === 'boolean') upd.paused = msg.paused;
      if (msg.windowMode === 'tabs' || msg.windowMode === 'windows') upd.windowMode = msg.windowMode;
      if (typeof msg.automationChrome === 'boolean') upd.automationChrome = msg.automationChrome;
      await chrome.storage.local.set(upd);
      var test = await agent('status', { tabs: 0, readyTabs: 0, paused: !!upd.paused });
      statusTick();
      return { ok: !test.error, error: test.error || null };
    }
    case 'statusNow':
      await statusTick();
      return { ok: true };
    default:
      return { error: 'unknown message' };
  }
}

chrome.runtime.onMessage.addListener(function (msg, sender, reply) {
  handle(msg, sender).then(reply, function (e) {
    reply({ error: String((e && e.message) || e) });
  });
  return true;
});

// Closing a tab fails its job ("window was closed") so the stage retries.
chrome.tabs.onRemoved.addListener(function (tabId) {
  withState(function (st) {
    var e = st.tabs[String(tabId)];
    var jobId = e && e.jobId;
    delete st.tabs[String(tabId)];
    return jobId;
  }).then(function (jobId) {
    if (jobId) agent('fail', { jobId: jobId, tabId: tabId, code: 'ERROR', message: 'The ChatGPT window was closed.' });
  });
});

chrome.alarms.onAlarm.addListener(function (a) {
  if (a.name === 'status') statusTick();
});

function boot() {
  chrome.alarms.create('status', { periodInMinutes: 0.5 });
  statusTick();
}
chrome.runtime.onInstalled.addListener(boot);
chrome.runtime.onStartup.addListener(boot);
boot();

// For tests and debugging from the service worker console.
self.BAS = { statusTick: statusTick, getConfig: getConfig, agent: agent, CODE_VERSION: CODE_VERSION, withState: withState };
