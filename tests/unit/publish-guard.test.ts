import { describe, expect, it } from 'vitest';
import { checkPublishRequest } from '@/core/publish-guard';

const site = 'https://example.com';

describe('publish guard', () => {
  it('allows saving drafts through REST', () => {
    expect(checkPublishRequest({ method: 'POST', url: `${site}/wp-json/wp/v2/posts`, body: JSON.stringify({ title: 'x', status: 'draft' }) }).block).toBe(false);
    expect(checkPublishRequest({ method: 'POST', url: `${site}/wp-json/wp/v2/posts/12`, body: JSON.stringify({ content: 'x' }) }).block).toBe(false);
  });

  it.each(['publish', 'future', 'private', 'pending'])('blocks REST status %s', (status) => {
    const d = checkPublishRequest({ method: 'POST', url: `${site}/wp-json/wp/v2/posts/12?_locale=user`, body: JSON.stringify({ status }) });
    expect(d.block).toBe(true);
  });

  it('blocks rest_route style URLs and method overrides', () => {
    expect(checkPublishRequest({ method: 'POST', url: `${site}/?rest_route=/wp/v2/posts/5`, body: '{"status":"publish"}' }).block).toBe(true);
    expect(
      checkPublishRequest({ method: 'POST', url: `${site}/wp-json/wp/v2/posts/5`, body: '{"status":"future"}', headers: { 'x-http-method-override': 'PUT' } }).block,
    ).toBe(true);
  });

  it('blocks custom post types but not media or terms', () => {
    expect(checkPublishRequest({ method: 'POST', url: `${site}/wp-json/wp/v2/pages/3`, body: '{"status":"publish"}' }).block).toBe(true);
    expect(checkPublishRequest({ method: 'POST', url: `${site}/wp-json/wp/v2/media/3`, body: '{"status":"publish","alt_text":"a"}' }).block).toBe(false);
    expect(checkPublishRequest({ method: 'POST', url: `${site}/wp-json/wp/v2/categories`, body: '{"name":"News"}' }).block).toBe(false);
  });

  it('blocks publish inside batch requests', () => {
    const body = JSON.stringify({ requests: [{ method: 'POST', path: '/wp/v2/posts/9', body: { status: 'publish' } }] });
    expect(checkPublishRequest({ method: 'POST', url: `${site}/wp-json/batch/v1`, body }).block).toBe(true);
  });

  it('blocks classic editor publish and quick edit', () => {
    expect(checkPublishRequest({ method: 'POST', url: `${site}/wp-admin/post.php`, body: 'action=editpost&post_ID=4&publish=Publish' }).block).toBe(true);
    expect(checkPublishRequest({ method: 'POST', url: `${site}/wp-admin/post.php`, body: 'action=editpost&post_ID=4&save=Save+Draft&post_status=draft&hidden_post_status=publish' }).block).toBe(false);
    expect(checkPublishRequest({ method: 'POST', url: `${site}/wp-admin/admin-ajax.php`, body: 'action=inline-save&post_ID=4&_status=publish' }).block).toBe(true);
    expect(checkPublishRequest({ method: 'POST', url: `${site}/wp-admin/post.php`, body: 'action=editpost&visibility=private' }).block).toBe(true);
  });

  it('blocks XML-RPC and ignores GET requests', () => {
    expect(checkPublishRequest({ method: 'POST', url: `${site}/xmlrpc.php`, body: '<methodCall/>' }).block).toBe(true);
    expect(checkPublishRequest({ method: 'GET', url: `${site}/wp-json/wp/v2/posts?status=publish` }).block).toBe(false);
  });

  it('lets the scheduler set status future only when allowed', () => {
    const req = { method: 'POST', url: `${site}/wp-json/wp/v2/posts/7`, body: '{"status":"future","date":"2026-10-10T09:00:00"}' };
    expect(checkPublishRequest(req).block).toBe(true);
    expect(checkPublishRequest(req, { allowedStatuses: ['future'] }).block).toBe(false);
    expect(checkPublishRequest({ ...req, body: '{"status":"publish"}' }, { allowedStatuses: ['future'] }).block).toBe(true);
  });

  it('allows Rank Math meta updates', () => {
    expect(checkPublishRequest({ method: 'POST', url: `${site}/wp-json/rankmath/v1/updateMeta`, body: '{"objectID":5,"meta":{"rank_math_title":"x"}}' }).block).toBe(false);
  });
});
