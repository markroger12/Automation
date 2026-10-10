import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ext = path.resolve(__dirname, '..', '..', 'extension');

function constant(file: string, name: string): string | null {
  const m = new RegExp(`var ${name} = '([^']+)'`).exec(fs.readFileSync(path.join(ext, file), 'utf8'));
  return m ? m[1]! : null;
}

describe('extension versions', () => {
  // A tab whose ping version differs is treated as dead and reloaded: unequal constants reload tabs every minute.
  it('manifest version, CODE_VERSION and SCRIPT_VERSION are equal', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(ext, 'manifest.json'), 'utf8')) as { version: string };
    expect(constant('background.js', 'CODE_VERSION')).toBe(manifest.version);
    expect(constant('content.js', 'SCRIPT_VERSION')).toBe(manifest.version);
  });

  it('does not ask for broad host permissions', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(ext, 'manifest.json'), 'utf8')) as { host_permissions: string[]; permissions: string[] };
    expect(manifest.host_permissions).not.toContain('https://*/*');
    expect(manifest.host_permissions).not.toContain('<all_urls>');
    expect(manifest.permissions.sort()).toEqual(['alarms', 'notifications', 'storage', 'tabs']);
  });
});
