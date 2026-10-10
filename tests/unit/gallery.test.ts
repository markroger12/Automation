import { describe, expect, it } from 'vitest';
import { altText, assignPictures, dedupePictures, markSoft, orderAfterCheck, orderPictures, parsePhotoCheck, type GalleryPicture } from '@/core/gallery';
import { coverPlacement } from '@/core/render-html';

const pic = (id: string, over: Partial<GalleryPicture> = {}): GalleryPicture => ({
  id,
  path: `media/${id}.jpg`,
  width: 1000,
  height: 800,
  sha256: id,
  dhash: '0000000000000000',
  sharpness: 100,
  faces: null,
  faceFp: null,
  ...over,
});

describe('gallery', () => {
  it('drops exact, near and cropped copies, keeping the larger picture', () => {
    const pics = [
      pic('a', { dhash: 'ffff000000000000' }),
      pic('b', { sha256: 'a', width: 500, height: 400, dhash: 'ffff000000000000' }),
      pic('c', { dhash: 'ffff00000000000f' }),
      pic('d', { dhash: '00000000ffffffff', faces: [{ x: 1, y: 1, w: 50, h: 50 }], faceFp: 'abcdef0123456789', width: 2000, height: 1500 }),
      pic('e', { dhash: 'f0f0f0f0f0f0f0f0', faces: [{ x: 1, y: 1, w: 40, h: 40 }], faceFp: 'abcdef0123456788' }),
      pic('f', { dhash: '0f0f0f0f0f0f0f0f' }),
    ];
    dedupePictures(pics);
    expect(pics.filter((p) => !p.dropped).map((p) => p.id).sort()).toEqual(['a', 'd', 'f']);
    expect(pics.find((p) => p.id === 'b')!.dropped).toMatch(/exact copy/);
    expect(pics.find((p) => p.id === 'c')!.dropped).toMatch(/near copy/);
    expect(pics.find((p) => p.id === 'e')!.dropped).toMatch(/cropped copy/);
  });

  it('orders faces first by face height, then no faces, soft pictures last', () => {
    const pics = [pic('noface', { sharpness: 120 }), pic('small', { faces: [{ x: 0, y: 0, w: 50, h: 60 }], sharpness: 110 }), pic('big', { faces: [{ x: 0, y: 0, w: 200, h: 240 }], sharpness: 100 }), pic('soft', { faces: [{ x: 0, y: 0, w: 300, h: 300 }], sharpness: 10 })];
    markSoft(pics);
    expect(orderPictures(pics).map((p) => p.id)).toEqual(['big', 'small', 'noface', 'soft']);
  });

  it('parses the photo check and orders clean, watermarked, collages', () => {
    const v = parsePhotoCheck('1: watermark=no | collage=no | alt=smiling at a premiere in a black dress\n2: watermark=yes | collage=no | alt=x\n**3:** watermark=no | collage=yes | alt=y\n9: watermark=no | collage=no | alt=z', 3);
    expect(v.size).toBe(3);
    expect(v.get(1)).toEqual({ watermark: false, collage: false, alt: 'smiling at a premiere in a black dress' });
    const pics = [pic('c', { collage: true }), pic('w', { watermark: true }), pic('ok')];
    expect(orderAfterCheck(pics).map((p) => p.id)).toEqual(['ok', 'w', 'c']);
  });

  it('uses each picture once and never a collage for body images', () => {
    const ordered = [pic('1'), pic('2'), pic('3', { collage: true }), pic('4')];
    const a = assignPictures(ordered, 2);
    expect(a.featured.map((p) => p.id)).toEqual(['1', '2']);
    expect(a.body.map((p) => p.id)).toEqual(['4']);
    expect(a.leftOut).toBe(1);
  });

  it('builds alt texts of at most 125 characters', () => {
    expect(altText('Sydney Sweeney', 'at the Met Gala.')).toBe('Sydney Sweeney – at the Met Gala');
    expect(altText('Sydney Sweeney', 'word '.repeat(40)).length).toBeLessThanOrEqual(125);
  });

  it('centres faces at 40% height when cropping', () => {
    // 1000×2000 portrait into a 1920×1080 slot: scale 1.92, face centre at y=300 → 576 px scaled
    const p = coverPlacement(1920, 1080, 1000, 2000, [{ x: 400, y: 250, w: 200, h: 100 }]);
    expect(p.width).toBe(1920);
    expect(p.top).toBe(Math.round(1080 * 0.4 - 300 * 1.92));
    const centred = coverPlacement(1920, 1080, 1000, 2000);
    expect(centred.top).toBe(Math.round((1080 - 3840) / 2));
  });
});
