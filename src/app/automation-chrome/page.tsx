import path from 'node:path';
import { ExtensionDetector } from './extension-detector';
import { AUTOMATION_CHROME_FLAGS } from '@/worker/automation-chrome-flags';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Automation Chrome — Blog Automation Studio' };

/** Public setup page. The extension recognises the Automation Chrome when it sees this page. */
export default function AutomationChromePage() {
  const extensionDir = path.resolve(process.cwd(), 'extension');
  const profileDir = path.resolve(process.cwd(), 'data', 'chatgpt-chrome');
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <div className="mb-6 flex items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icon.svg" alt="" className="h-9 w-9" />
        <div>
          <h1 className="text-xl font-semibold">Automation Chrome</h1>
          <p className="text-sm text-gray-500">The separate Chrome in which the ChatGPT Worker extension writes your articles on chatgpt.com.</p>
        </div>
      </div>

      <ExtensionDetector />

      <ol className="mt-6 space-y-5 text-sm text-gray-800">
        <li className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <div className="font-semibold">1. Install the extension (once)</div>
          <p className="mt-1 text-gray-600">
            In this window open <code className="rounded bg-gray-100 px-1">chrome://extensions</code>, switch on <b>Developer mode</b> (top right), press <b>Load unpacked</b> and choose this folder:
          </p>
          <pre className="mt-2 overflow-x-auto rounded bg-gray-900 p-2 text-xs text-gray-100">{extensionDir}</pre>
          <p className="mt-2 text-xs text-gray-500">Recent Chrome ignores the --load-extension flag, so this step is done by hand. It stays installed in this Chrome.</p>
        </li>
        <li className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <div className="font-semibold">2. Connect it to the app</div>
          <p className="mt-1 text-gray-600">
            In the dashboard open <b>Settings → Create connection key</b>. Click the extension icon (puzzle piece → pin “ChatGPT Worker”), paste the key and the app address, then press <b>Save and connect</b>.
          </p>
        </li>
        <li className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <div className="font-semibold">3. Log in to ChatGPT</div>
          <p className="mt-1 text-gray-600">
            Open <a className="text-brand-600 underline" href="https://chatgpt.com/" target="_blank" rel="noreferrer">chatgpt.com</a> in this window and log in with your subscription. When ChatGPT later asks for a login or a human check, a desktop notification appears; the prompt waits up to 10 minutes for you.
          </p>
        </li>
        <li className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <div className="font-semibold">4. Leave it running</div>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-gray-600">
            <li>The extension opens as many ChatGPT tabs as your Task Concurrency (2–3 works best) and closes idle ones.</li>
            <li>Keep this window open behind your other windows. Never minimize it and keep the PC unlocked.</li>
            <li>The worker starts this Chrome by itself whenever prompts are waiting. Use “Pause automatic start” in the extension popup to stop that.</li>
          </ul>
        </li>
      </ol>

      <details className="mt-6 text-sm text-gray-600">
        <summary className="cursor-pointer font-medium text-gray-800">How the worker starts this Chrome</summary>
        <pre className="mt-2 overflow-x-auto rounded bg-gray-100 p-2 text-xs">
          {`chrome.exe --user-data-dir="${profileDir}" ${AUTOMATION_CHROME_FLAGS.join(' ')}`}
        </pre>
        <p className="mt-2">These flags keep ChatGPT drawing while the window is behind other windows. No automation flags are used: Cloudflare blocks automated browsers on chatgpt.com.</p>
      </details>
    </div>
  );
}
