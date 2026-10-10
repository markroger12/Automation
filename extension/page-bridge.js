/*
 * Runs on the app's pages (localhost). On /automation-chrome it tells the background that this Chrome is
 * the Automation Chrome and lets the page show that the extension is installed.
 */
(function () {
  'use strict';
  if (!/\/automation-chrome\/?$/.test(location.pathname)) return;
  try {
    chrome.runtime.sendMessage({ type: 'automation-page', origin: location.origin }, function (resp) {
      if (chrome.runtime.lastError) return;
      document.documentElement.setAttribute('data-bas-extension', (resp && resp.version) || 'unknown');
      document.documentElement.setAttribute('data-bas-configured', resp && resp.configured ? 'yes' : 'no');
      window.dispatchEvent(new CustomEvent('bas-extension', { detail: resp || {} }));
    });
  } catch (e) {
    /* extension reloaded */
  }
})();
