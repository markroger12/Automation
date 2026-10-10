'use client';

import { useEffect, useState } from 'react';

export function ExtensionDetector() {
  const [state, setState] = useState<{ version: string | null; configured: boolean | null }>({ version: null, configured: null });

  useEffect(() => {
    const read = () => {
      const v = document.documentElement.getAttribute('data-bas-extension');
      const c = document.documentElement.getAttribute('data-bas-configured');
      if (v) setState({ version: v, configured: c === 'yes' });
    };
    read();
    window.addEventListener('bas-extension', read);
    const t = setInterval(read, 1000);
    return () => {
      window.removeEventListener('bas-extension', read);
      clearInterval(t);
    };
  }, []);

  if (!state.version) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
        The ChatGPT Worker extension is not detected in this browser. If this is the Automation Chrome, install it with step 1.
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
      ChatGPT Worker v{state.version} is installed and knows this is the Automation Chrome.{' '}
      {state.configured ? 'It is connected to the app.' : 'Paste the connection key into its popup (step 2).'}
    </div>
  );
}
