'use strict';

function $(id) {
  return document.getElementById(id);
}

function send(msg) {
  return new Promise(function (resolve) {
    chrome.runtime.sendMessage(msg, function (r) {
      resolve(r || {});
    });
  });
}

function ago(ts) {
  if (!ts) return 'never';
  var s = Math.round((Date.now() - ts) / 1000);
  return s < 60 ? s + ' s ago' : Math.round(s / 60) + ' min ago';
}

async function render() {
  var st = await send({ type: 'getStatus' });
  $('version').textContent = 'v' + (st.version || '?');
  var c = st.config || {};
  if (document.activeElement !== $('appUrl')) $('appUrl').value = c.appUrl || '';
  $('paused').checked = !!c.paused;
  $('windows').checked = c.windowMode === 'windows';
  $('automation').checked = !!c.automationChrome;
  var tabs = st.tabs || {};
  var ids = Object.keys(tabs);
  var busy = ids.filter(function (k) {
    return tabs[k].jobId;
  }).length;
  var lc = st.lastContact;
  var html = '';
  if (!c.appUrl || !c.hasKey) html += '<div class="bad">Not connected: enter the app address and the connection key.</div>';
  else if (lc && lc.ok) html += '<div class="ok">Connected (' + ago(lc.at) + ').</div>';
  else if (lc) html += '<div class="bad">Connection problem: ' + (lc.error || 'HTTP ' + lc.status) + ' (' + ago(lc.at) + ').</div>';
  html += '<div>ChatGPT tabs: ' + ids.length + ' · working: ' + busy + '</div>';
  if (st.readSlot && st.readSlot.level > 0) html += '<div>ChatGPT rate limit level ' + st.readSlot.level + ' — reads are slowed down.</div>';
  if (c.paused) html += '<div>Automatic start is paused.</div>';
  $('status').innerHTML = html;
}

$('save').addEventListener('click', async function () {
  $('save').disabled = true;
  var r = await send({
    type: 'saveConfig',
    appUrl: $('appUrl').value,
    key: $('key').value,
    paused: $('paused').checked,
    windowMode: $('windows').checked ? 'windows' : 'tabs',
    automationChrome: $('automation').checked,
  });
  $('key').value = '';
  $('save').disabled = false;
  await render();
  if (!r.ok) $('status').insertAdjacentHTML('afterbegin', '<div class="bad">' + (r.error || 'Could not connect') + '</div>');
});

$('refresh').addEventListener('click', async function () {
  await send({ type: 'statusNow' });
  render();
});

['paused', 'windows', 'automation'].forEach(function (id) {
  $(id).addEventListener('change', async function () {
    await send({ type: 'saveConfig', paused: $('paused').checked, windowMode: $('windows').checked ? 'windows' : 'tabs', automationChrome: $('automation').checked });
    render();
  });
});

render();
setInterval(render, 3000);
