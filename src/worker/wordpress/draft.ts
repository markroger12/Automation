import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import type { Page } from 'playwright';
import type { Website } from '@prisma/client';
import { prisma } from '@/server/db';
import { DATA_DIR, safeJoin } from '@/server/env';
import { LoginRequiredError } from '@/server/errors';
import { htmlToBlocks, swapImageSources } from '@/core/blocks';
import { topBlocks } from '@/core/html';
import { isInternalLinkBlock } from '@/core/assembly';
import { mediaUrl, type ImagesData } from '@/server/reassemble';
import { wpRest, wpRestOk, WpRestError } from './rest';

export type MediaMap = Record<string, { id: number; url: string }>;
export type EditorKind = 'GUTENBERG' | 'CLASSIC';

type WpPost = { id: number; status: string; link?: string; slug?: string; content?: { raw?: string }; title?: { raw?: string }; featured_media?: number; categories?: number[] };

function rethrowAuth(err: unknown, website: Pick<Website, 'name'>): never {
  if (err instanceof WpRestError && (err.status === 401 || err.code === 'rest_not_logged_in' || err.code === 'rest_cookie_invalid_nonce')) {
    throw new LoginRequiredError('wordpress', `WordPress (${website.name}) rejected the session (${err.code ?? err.status}). Log in again under Websites.`);
  }
  throw err;
}

/** Block editor unless the Classic Editor plugin is active (needs plugin rights; defaults to the block editor). */
export async function detectEditor(page: Page, website: Website): Promise<EditorKind> {
  if (website.editorType !== 'AUTO') return website.editorType;
  const res = await wpRest<{ plugin: string; status: string }[]>(page, website.adminUrl, { path: '/wp/v2/plugins', query: { search: 'classic', _fields: 'plugin,status' } });
  if (res.ok && Array.isArray(res.data) && res.data.some((p) => /classic-editor/.test(p.plugin) && p.status === 'active')) return 'CLASSIC';
  return 'GUTENBERG';
}

const decode = (s: string) => s.replace(/&amp;/g, '&').replace(/&#039;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();

/** Exactly one category: the task's category, else the website default, created when allowed. */
export async function resolveCategory(
  page: Page,
  website: Website,
  wanted: { categoryId: string | null; categoryName: string | null },
  createMissing: boolean,
): Promise<{ wpId: number; name: string } | null> {
  const local = wanted.categoryId ? await prisma.category.findUnique({ where: { id: wanted.categoryId } }) : website.defaultCategoryId ? await prisma.category.findUnique({ where: { id: website.defaultCategoryId } }) : null;
  const name = local?.name ?? wanted.categoryName;
  if (local?.wpId) return { wpId: local.wpId, name: local.name };
  if (!name) return null;
  const found = await wpRestOk<{ id: number; name: string }[]>(page, website.adminUrl, { path: '/wp/v2/categories', query: { search: name, per_page: 50, _fields: 'id,name' } });
  const match = found.find((c) => decode(c.name).toLowerCase() === name.toLowerCase());
  if (match) {
    if (local) await prisma.category.update({ where: { id: local.id }, data: { wpId: match.id } });
    return { wpId: match.id, name };
  }
  if (!createMissing) return null;
  const created = await wpRestOk<{ id: number; name: string }>(page, website.adminUrl, { method: 'POST', path: '/wp/v2/categories', body: { name } });
  await prisma.category.upsert({
    where: { websiteId_name: { websiteId: website.id, name } },
    create: { websiteId: website.id, name, wpId: created.id },
    update: { wpId: created.id },
  });
  return { wpId: created.id, name };
}

export async function resolveTags(page: Page, adminUrl: string, tags: string[]): Promise<number[]> {
  const ids: number[] = [];
  for (const tag of tags.slice(0, 15)) {
    const found = await wpRestOk<{ id: number; name: string }[]>(page, adminUrl, { path: '/wp/v2/tags', query: { search: tag, per_page: 20, _fields: 'id,name' } });
    const match = found.find((t) => decode(t.name).toLowerCase() === tag.toLowerCase());
    if (match) ids.push(match.id);
    else {
      const res = await wpRest<{ id?: number; code?: string; data?: { term_id?: number } }>(page, adminUrl, { method: 'POST', path: '/wp/v2/tags', body: { name: tag } });
      if (res.ok && res.data?.id) ids.push(res.data.id);
      else if (res.data?.code === 'term_exists' && res.data.data?.term_id) ids.push(res.data.data.term_id);
    }
  }
  return [...new Set(ids)];
}

/**
 * Uploads one image to the media library with its alt text. WebP first; if WordPress refuses WebP the image is
 * converted to JPEG (buffers only — paths keep files locked on Windows) and uploaded again.
 */
export async function uploadImage(page: Page, adminUrl: string, relPath: string, alt: string, postId: number): Promise<{ id: number; url: string }> {
  const abs = safeJoin(DATA_DIR, relPath);
  if (!abs) throw new Error(`Bad image path ${relPath}`);
  const buf = await fs.readFile(abs);
  const ext = path.extname(abs).toLowerCase();
  const mime = ext === '.webp' ? 'image/webp' : ext === '.png' ? 'image/png' : 'image/jpeg';
  const base = path.basename(abs, ext);
  let res = await wpRest<{ id: number; source_url: string; code?: string; message?: string }>(page, adminUrl, { method: 'POST', path: '/wp/v2/media', upload: { base64: buf.toString('base64'), filename: `${base}${ext}`, mime } });
  if (!res.ok && mime === 'image/webp') {
    const jpg = await sharp(buf).jpeg({ quality: 90, mozjpeg: true }).toBuffer();
    res = await wpRest(page, adminUrl, { method: 'POST', path: '/wp/v2/media', upload: { base64: jpg.toString('base64'), filename: `${base}.jpg`, mime: 'image/jpeg' } });
  }
  if (!res.ok || !res.data?.id) throw new WpRestError(res.status, `Image upload failed (${res.status}): ${res.data?.message ?? res.text.slice(0, 160)}`, res.data?.code);
  await wpRest(page, adminUrl, { method: 'POST', path: `/wp/v2/media/${res.data.id}`, body: { alt_text: alt.slice(0, 250), post: postId } });
  return { id: res.data.id, url: res.data.source_url };
}

/** Rank Math fields through its own REST route (the one its editor sidebar uses). */
export async function setRankMathMeta(page: Page, adminUrl: string, postId: number, meta: Record<string, string | number>): Promise<boolean> {
  const res = await wpRest<unknown>(page, adminUrl, { method: 'POST', path: '/rankmath/v1/updateMeta', body: { objectType: 'post', objectID: postId, meta } });
  return res.ok;
}

/** The post content from the assembled article: uploaded image URLs, block markup for the block editor. */
export function renderPostContent(contentHtml: string, images: ImagesData | null, media: MediaMap, editor: EditorKind): string {
  const map: Record<string, { id: number; url: string }> = {};
  for (const img of [...(images?.featured ? [{ path: images.featured.path }] : []), ...(images?.body ?? [])]) {
    const hit = media[img.path];
    if (hit) map[mediaUrl(img.path)] = hit;
  }
  const html = swapImageSources(contentHtml, map);
  return editor === 'GUTENBERG' ? htmlToBlocks(html) : html;
}

/** Replaces (or adds) only the internal-link line of a raw post content; everything else stays as edited in WordPress. */
export function replaceInternalLinkLine(raw: string, newLineHtml: string, linkText: string): string {
  const hasBlocks = /<!--\s*wp:/.test(raw);
  const blockRe = /<!--\s*wp:paragraph\s*-->\s*<p>\s*<strong>[^<]*<a\s[^>]*>[^<]*<\/a>\s*<\/strong>\s*<\/p>\s*<!--\s*\/wp:paragraph\s*-->\s*$/i;
  const plainRe = /<p>\s*<strong>[^<]*<a\s[^>]*>[^<]*<\/a>\s*<\/strong>\s*<\/p>\s*$/i;
  const replacement = hasBlocks ? `<!-- wp:paragraph -->\n${newLineHtml}\n<!-- /wp:paragraph -->` : newLineHtml;
  const trimmed = raw.trimEnd();
  const re = hasBlocks ? blockRe : plainRe;
  const m = re.exec(trimmed);
  if (m) {
    const blocks = topBlocks(m[0].replace(/<!--[^>]*-->/g, ''));
    if (blocks.length === 1 && isInternalLinkBlock(blocks[0]!, linkText)) return trimmed.slice(0, m.index) + replacement;
  }
  return `${trimmed}\n\n${replacement}`;
}

export type DraftInput = {
  website: Website;
  taskId: string;
  postId: number | null;
  title: string;
  contentHtml: string;
  slug: string | null;
  categoryId: string | null;
  categoryName: string | null;
  tags: string[];
  images: ImagesData | null;
  media: MediaMap;
  seo: { seoTitle: string | null; metaDescription: string | null; focusKeyword: string };
  createMissingCategory: boolean;
  internalLinkHtml: string | null;
  internalLinkText: string;
  onPostCreated: (postId: number, editUrl: string) => Promise<void>;
  onMediaUploaded: (media: MediaMap) => Promise<void>;
  log: (level: 'info' | 'warn', message: string) => Promise<void>;
};

export type DraftResult = { postId: number; editUrl: string; postUrl: string | null; editor: EditorKind; category: string | null; liveUpdate: boolean; rankMathMeta: boolean; reviewReasons: string[]; media: MediaMap };

export function editUrlFor(website: Pick<Website, 'adminUrl'>, postId: number): string {
  return `${website.adminUrl.replace(/\/+$/, '')}/post.php?post=${postId}&action=edit`;
}

/** Creates or updates the WordPress draft through REST from inside the logged-in admin page. */
export async function saveDraft(page: Page, input: DraftInput, editor: EditorKind): Promise<DraftResult> {
  const { website } = input;
  const reasons: string[] = [];
  try {
    let postId = input.postId;
    let existing: WpPost | null = null;
    if (postId) {
      const res = await wpRest<WpPost>(page, website.adminUrl, { path: `/wp/v2/posts/${postId}`, query: { context: 'edit' } });
      if (res.ok && res.data && res.data.status !== 'trash') existing = res.data;
      else {
        await input.log('warn', `Post ${postId} is gone from WordPress (${res.status}); a new draft is created.`);
        postId = null;
      }
    }

    // Already scheduled or live: never touch status, date or hand edits — only refresh the internal link line.
    if (existing && ['publish', 'future', 'private', 'pending'].includes(existing.status)) {
      let updated = false;
      if (input.internalLinkHtml) {
        const raw = existing.content?.raw ?? '';
        const next = replaceInternalLinkLine(raw, input.internalLinkHtml, input.internalLinkText);
        if (next !== raw) {
          await wpRestOk(page, website.adminUrl, { method: 'POST', path: `/wp/v2/posts/${existing.id}`, body: { content: next } });
          updated = true;
        }
      }
      await input.log('info', `Post ${existing.id} is already ${existing.status}: ${updated ? 'only its internal link was updated' : 'nothing was changed'} (edits made in WordPress stay).`);
      return { postId: existing.id, editUrl: editUrlFor(website, existing.id), postUrl: existing.link ?? null, editor, category: null, liveUpdate: true, rankMathMeta: false, reviewReasons: [], media: input.media };
    }

    if (!postId) {
      const created = await wpRestOk<WpPost>(page, website.adminUrl, { method: 'POST', path: '/wp/v2/posts', body: { title: input.title, status: 'draft', content: '' } });
      postId = created.id;
      // Saved right away: retries and "Send to WordPress" reopen this post instead of creating a duplicate.
      await input.onPostCreated(postId, editUrlFor(website, postId));
      await input.log('info', `Draft ${postId} created.`);
    }

    const category = await resolveCategory(page, website, { categoryId: input.categoryId, categoryName: input.categoryName }, input.createMissingCategory);
    if (!category) reasons.push(input.categoryName ? `Category "${input.categoryName}" does not exist in WordPress (turn on "Create a missing category" or sync categories).` : 'No category chosen: WordPress used its default category.');
    const tagIds = await resolveTags(page, website.adminUrl, input.tags);

    const media: MediaMap = { ...input.media };
    const wanted = [...(input.images?.featured ? [{ path: input.images.featured.path, alt: input.images.featured.alt }] : []), ...(input.images?.body ?? [])];
    for (const img of wanted) {
      if (media[img.path]) continue;
      media[img.path] = await uploadImage(page, website.adminUrl, img.path, img.alt, postId);
      await input.onMediaUploaded(media);
    }
    const featured = input.images?.featured ? media[input.images.featured.path] : undefined;

    const content = renderPostContent(input.contentHtml, input.images, media, editor);
    const body: Record<string, unknown> = { title: input.title, content, status: 'draft', tags: tagIds };
    if (input.slug) body.slug = input.slug;
    if (category) body.categories = [category.wpId];
    if (featured) body.featured_media = featured.id;
    const saved = await wpRestOk<WpPost>(page, website.adminUrl, { method: 'POST', path: `/wp/v2/posts/${postId}`, body });
    // Confirmed from the REST response (German admin pages keep the Save button active after saving).
    if (saved.id !== postId || saved.status !== 'draft') throw new Error(`WordPress did not confirm the draft (status ${saved.status}).`);
    if (category && saved.categories && (saved.categories.length !== 1 || saved.categories[0] !== category.wpId)) {
      await wpRestOk(page, website.adminUrl, { method: 'POST', path: `/wp/v2/posts/${postId}`, body: { categories: [category.wpId], status: 'draft' } });
    }

    const meta: Record<string, string> = { rank_math_focus_keyword: input.seo.focusKeyword };
    if (input.seo.seoTitle) meta.rank_math_title = input.seo.seoTitle;
    if (input.seo.metaDescription) meta.rank_math_description = input.seo.metaDescription;
    const rankMathMeta = await setRankMathMeta(page, website.adminUrl, postId, meta);
    if (!rankMathMeta) reasons.push('Rank Math fields could not be set (is Rank Math installed and active?).');

    return { postId, editUrl: editUrlFor(website, postId), postUrl: saved.link ?? null, editor, category: category?.name ?? null, liveUpdate: false, rankMathMeta, reviewReasons: reasons, media };
  } catch (err) {
    rethrowAuth(err, website);
  }
}

