import http from 'node:http';

/**
 * A small fake WordPress: cookie login, admin pages with wpApiSettings, the REST routes the worker uses,
 * Rank Math's updateMeta route and an editor page whose Rank Math score depends on the SEO fields.
 */
type Post = { id: number; title: string; content: string; status: string; slug: string; categories: number[]; tags: number[]; featured_media: number; date: string; date_gmt: string; link: string };

export class FakeWordPress {
  server!: http.Server;
  url = '';
  nonce = 'testnonce1234';
  cookie = 'wordpress_logged_in_test';
  posts = new Map<number, Post>();
  media = new Map<number, { id: number; mime: string; filename: string; alt: string; size: number }>();
  categories: { id: number; name: string; slug: string; parent: number }[] = [
    { id: 1, name: 'Uncategorized', slug: 'uncategorized', parent: 0 },
    { id: 5, name: 'Celebrities', slug: 'celebrities', parent: 0 },
    { id: 6, name: 'Tech &amp; Apps', slug: 'tech-apps', parent: 0 },
  ];
  tags: { id: number; name: string }[] = [{ id: 30, name: 'Sydney Sweeney' }];
  meta = new Map<number, Record<string, unknown>>();
  webpAllowed = true;
  timezone = 'Europe/Berlin';
  requests: { method: string; path: string; body: string }[] = [];
  private nextId = 100;

  async start(): Promise<string> {
    this.server = http.createServer((req, res) => void this.handle(req, res));
    await new Promise<void>((r) => this.server.listen(0, '127.0.0.1', r));
    this.url = `http://127.0.0.1:${(this.server.address() as { port: number }).port}`;
    return this.url;
  }

  close() {
    return new Promise<void>((r) => this.server.close(() => r()));
  }

  private loggedIn(req: http.IncomingMessage) {
    return (req.headers.cookie ?? '').includes(`${this.cookie}=1`);
  }

  private send(res: http.ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
    res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
    res.end(JSON.stringify(body));
  }

  private adminPage(inner: string, extraHead = '') {
    return `<!doctype html><html class="kodee-wrapper"><head><title>Dashboard</title>${extraHead}<script>window.wpApiSettings={root:${JSON.stringify(this.url + '/wp-json/')},nonce:${JSON.stringify(this.nonce)}};</script></head><body class="wp-admin kodee-active"><div id="wpadminbar">Admin</div><div class="kodee-chat-bubble" style="position:fixed;inset:0">Kodee</div>${inner}</body></html>`;
  }

  rankMath(postId: number) {
    const p = this.posts.get(postId)!;
    const m = this.meta.get(postId) ?? {};
    const kw = String(m.rank_math_focus_keyword ?? '').toLowerCase();
    const title = String(m.rank_math_title ?? p.title).toLowerCase();
    const desc = String(m.rank_math_description ?? '').toLowerCase();
    const text = p.content.replace(/<[^>]+>/g, ' ').toLowerCase();
    const tests = [
      { text: 'Focus Keyword not found in your SEO title.', ok: !!kw && title.includes(kw) },
      { text: 'Use the Focus Keyword near the beginning of SEO title.', ok: !!kw && title.startsWith(kw) },
      { text: 'Focus Keyword not found in your SEO Meta Description.', ok: !!kw && desc.includes(kw) },
      { text: 'Focus Keyword not found in the URL.', ok: !!kw && p.slug.includes(kw.replace(/\s+/g, '-')) },
      { text: 'Focus Keyword appears in the first 10% of the content.', ok: !!kw && text.slice(0, Math.max(200, text.length / 10)).includes(kw) },
      { text: 'Add an image with your Focus Keyword as alt text.', ok: [...this.media.values()].some((x) => x.alt.toLowerCase().includes(kw)) },
    ];
    const score = Math.max(0, 100 - tests.filter((t) => !t.ok).length * 12);
    return { score, tests, kw };
  }

  private editorPage(postId: number) {
    const { score, tests, kw } = this.rankMath(postId);
    const items = tests.map((t) => `<li class="${t.ok ? 'test-ok' : 'test-fail'}">${t.text}</li>`).join('');
    return this.adminPage(
      `<div class="editor-editor-interface"><div class="edit-post-welcome-guide components-modal__frame"><button aria-label="Close" onclick="this.parentNode.remove()">x</button></div>
       <div class="interface-pinned-items"><button class="rank-math-toolbar-score" onclick="document.querySelector('.rank-math-sidebar-panel').style.display='block'"><span class="score-text">0 / 100</span></button></div>
       <div class="rank-math-sidebar-panel" style="display:none"><div class="rank-math-focus-keyword"><span class="tagify__tag">${kw} ${score}</span></div><ul class="rank-math-checklist">${items}</ul></div></div>
       <script>setTimeout(function(){document.querySelector('.score-text').textContent='${score} / 100';},700);</script>`,
    );
  }

  private async body(req: http.IncomingMessage): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    return Buffer.concat(chunks);
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse) {
    const url = new URL(req.url ?? '/', this.url);
    const p = url.pathname;
    const raw = await this.body(req);
    this.requests.push({ method: req.method ?? 'GET', path: p + url.search, body: raw.toString('utf8').slice(0, 2000) });

    if (p === '/wp-login.php') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end('<html><body class="login"><form id="loginform" name="loginform"><input id="user_login" name="log"></form></body></html>');
    }
    if (p === '/feed/') {
      const items = [...this.posts.values()].filter((x) => x.status === 'publish').sort((a, b) => b.date_gmt.localeCompare(a.date_gmt));
      res.writeHead(200, { 'Content-Type': 'application/rss+xml' });
      return res.end(`<?xml version="1.0"?><rss version="2.0"><channel><title>Fake</title>${items.map((i) => `<item><title>${i.title}</title><link>${i.link}</link><pubDate>${new Date(i.date_gmt + 'Z').toUTCString()}</pubDate></item>`).join('')}</channel></rss>`);
    }
    if (p.startsWith('/wp-admin')) {
      if (!this.loggedIn(req)) {
        res.writeHead(302, { Location: `/wp-login.php?redirect_to=${encodeURIComponent(p)}` });
        return res.end();
      }
      if (p === '/wp-admin/admin-ajax.php' && url.searchParams.get('action') === 'rest-nonce') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        return res.end(this.nonce);
      }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      if (p === '/wp-admin/post.php' && url.searchParams.get('post')) return res.end(this.editorPage(Number(url.searchParams.get('post'))));
      if (p === '/wp-admin/options-general.php') return res.end(this.adminPage(`<select id="timezone_string"><option value="${this.timezone}" selected>${this.timezone}</option></select>`));
      return res.end(this.adminPage('<div id="wpbody">Admin page</div>'));
    }
    const route = p.startsWith('/wp-json') ? p.slice('/wp-json'.length) : url.searchParams.get('rest_route');
    if (route) return this.rest(req, res, route, url, raw);
    res.writeHead(404);
    res.end();
  }

  private rest(req: http.IncomingMessage, res: http.ServerResponse, route: string, url: URL, raw: Buffer) {
    if (!this.loggedIn(req)) return this.send(res, 401, { code: 'rest_not_logged_in', message: 'You are not currently logged in.' });
    if (req.headers['x-wp-nonce'] !== this.nonce) return this.send(res, 403, { code: 'rest_cookie_invalid_nonce', message: 'Cookie check failed' });
    const method = req.method ?? 'GET';
    const json = () => (raw.length && /json/.test(req.headers['content-type'] ?? '') ? (JSON.parse(raw.toString('utf8')) as Record<string, unknown>) : {});
    let m: RegExpExecArray | null;

    if (route === '/wp/v2/users/me') return this.send(res, 200, { id: 1, name: 'Admin', capabilities: { edit_posts: true } });
    if (route === '/wp/v2/settings') return this.send(res, 200, { timezone: this.timezone });
    if (route === '/wp/v2/plugins') return this.send(res, 200, []);
    if (route === '/wp/v2/categories') {
      if (method === 'POST') {
        const c = { id: this.nextId++, name: String(json().name), slug: String(json().name).toLowerCase(), parent: 0 };
        this.categories.push(c);
        return this.send(res, 201, c);
      }
      const search = (url.searchParams.get('search') ?? '').toLowerCase();
      const list = this.categories.filter((c) => !search || c.name.toLowerCase().replace('&amp;', '&').includes(search));
      return this.send(res, 200, list, { 'X-WP-Total': String(list.length), 'X-WP-TotalPages': '1' });
    }
    if (route === '/wp/v2/tags') {
      if (method === 'POST') {
        const name = String(json().name);
        const existing = this.tags.find((t) => t.name.toLowerCase() === name.toLowerCase());
        if (existing) return this.send(res, 400, { code: 'term_exists', data: { term_id: existing.id } });
        const t = { id: this.nextId++, name };
        this.tags.push(t);
        return this.send(res, 201, t);
      }
      const search = (url.searchParams.get('search') ?? '').toLowerCase();
      return this.send(res, 200, this.tags.filter((t) => t.name.toLowerCase().includes(search)));
    }
    if (route === '/wp/v2/posts' && method === 'POST') {
      const b = json();
      const id = this.nextId++;
      const post: Post = { id, title: String(b.title ?? ''), content: String(b.content ?? ''), status: String(b.status ?? 'draft'), slug: '', categories: [1], tags: [], featured_media: 0, date: '', date_gmt: '', link: `${this.url}/?p=${id}` };
      this.posts.set(id, post);
      return this.send(res, 201, this.out(post));
    }
    if ((m = /^\/wp\/v2\/posts\/(\d+)$/.exec(route))) {
      const post = this.posts.get(Number(m[1]));
      if (!post) return this.send(res, 404, { code: 'rest_post_invalid_id' });
      if (method === 'POST' || method === 'PUT') {
        const b = json();
        if (b.title !== undefined) post.title = String(b.title);
        if (b.content !== undefined) post.content = String(b.content);
        if (b.slug !== undefined) post.slug = String(b.slug);
        if (Array.isArray(b.categories)) post.categories = b.categories as number[];
        if (Array.isArray(b.tags)) post.tags = b.tags as number[];
        if (b.featured_media !== undefined) post.featured_media = Number(b.featured_media);
        if (b.status !== undefined) post.status = String(b.status);
        if (b.date !== undefined) post.date = String(b.date);
        if (b.date_gmt !== undefined) post.date_gmt = String(b.date_gmt);
        if (post.status === 'publish' || post.status === 'future') {
          post.slug ||= post.title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
          post.link = `${this.url}/${post.slug}/`;
          if (!post.date_gmt) post.date_gmt = new Date().toISOString().slice(0, 19);
        }
      }
      return this.send(res, 200, this.out(post));
    }
    if (route === '/wp/v2/media' && method === 'POST') {
      const type = String(req.headers['content-type'] ?? '');
      if (type === 'image/webp' && !this.webpAllowed) return this.send(res, 500, { code: 'rest_upload_sideload_error', message: 'Sorry, you are not allowed to upload this file type.' });
      const filename = /filename="([^"]+)"/.exec(String(req.headers['content-disposition'] ?? ''))?.[1] ?? 'file';
      const id = this.nextId++;
      this.media.set(id, { id, mime: type, filename, alt: '', size: raw.length });
      return this.send(res, 201, { id, source_url: `${this.url}/wp-content/uploads/${filename}`, mime_type: type });
    }
    if ((m = /^\/wp\/v2\/media\/(\d+)$/.exec(route))) {
      const item = this.media.get(Number(m[1]));
      if (!item) return this.send(res, 404, {});
      const b = json();
      if (b.alt_text !== undefined) item.alt = String(b.alt_text);
      return this.send(res, 200, { id: item.id, alt_text: item.alt });
    }
    if (route === '/rankmath/v1/updateMeta' && method === 'POST') {
      const b = json() as { objectID: number; meta: Record<string, unknown> };
      this.meta.set(Number(b.objectID), { ...(this.meta.get(Number(b.objectID)) ?? {}), ...b.meta });
      return this.send(res, 200, { slug: true, schemas: [] });
    }
    return this.send(res, 404, { code: 'rest_no_route', message: `No route ${route}` });
  }

  private out(p: Post) {
    return { id: p.id, status: p.status, slug: p.slug, link: p.link, title: { raw: p.title }, content: { raw: p.content }, categories: p.categories, tags: p.tags, featured_media: p.featured_media, date: p.date, date_gmt: p.date_gmt };
  }
}
