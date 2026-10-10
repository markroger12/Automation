/**
 * Optional end-to-end test against a disposable WordPress. Runs only when WP_E2E_ADMIN_URL is set, e.g.
 *   WP_E2E_ADMIN_URL=https://test.example.com/wp-admin WP_E2E_PROFILE_DIR=data/profiles/test-site npm test -- tests/e2e
 * The profile folder must already be logged in (Websites → Login). The test creates a draft and trashes it.
 */
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const adminUrl = process.env.WP_E2E_ADMIN_URL;

describe.skipIf(!adminUrl)('real WordPress (WP_E2E_ADMIN_URL)', () => {
  it('creates a draft through REST in the logged-in admin page and trashes it', async () => {
    const { launchPersistent } = await import('@/worker/browser/launch');
    const { installPublishGuard, openAdmin } = await import('@/worker/wordpress/session');
    const { wpRestOk } = await import('@/worker/wordpress/rest');
    const dir = path.resolve(process.env.WP_E2E_PROFILE_DIR ?? 'data/profiles/e2e');
    const context = await launchPersistent(dir, 'headless');
    try {
      await installPublishGuard(context);
      const page = await context.newPage();
      const website = { adminUrl: adminUrl!, name: 'E2E' };
      await openAdmin(page, website);
      const post = await wpRestOk<{ id: number; status: string }>(page, adminUrl!, { method: 'POST', path: '/wp/v2/posts', body: { title: 'Blog Automation Studio E2E', status: 'draft', content: '<!-- wp:paragraph --><p>E2E</p><!-- /wp:paragraph -->' } });
      expect(post.status).toBe('draft');
      await expect(wpRestOk(page, adminUrl!, { method: 'POST', path: `/wp/v2/posts/${post.id}`, body: { status: 'publish' } })).rejects.toThrow(/publish guard/);
      await wpRestOk(page, adminUrl!, { method: 'DELETE', path: `/wp/v2/posts/${post.id}` });
    } finally {
      await context.close();
    }
  }, 180_000);
});
