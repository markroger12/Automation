/**
 * Flags that keep ChatGPT drawing while the window is behind other windows.
 * The extension is installed once by hand (Load unpacked); recent Chrome ignores --load-extension.
 */
export const AUTOMATION_CHROME_FLAGS = [
  '--disable-features=CalculateNativeWinOcclusion',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
  '--disable-background-timer-throttling',
  '--no-first-run',
  '--no-default-browser-check',
];
