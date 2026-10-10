/* Minimal typing for code that runs inside the extension's service worker (sw.evaluate). */
declare const chrome: {
  storage: { local: { get(keys?: string | string[]): Promise<Record<string, unknown>>; set(items: Record<string, unknown>): Promise<void> } };
  [key: string]: unknown;
};
