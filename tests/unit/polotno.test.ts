import { describe, expect, it } from 'vitest';
import { importPolotno } from '@/core/polotno';
import { designSchema } from '@/lib/design-schema';

describe('Polotno import', () => {
  it('scales another page shape onto 1920×1080, centred, and converts elements', () => {
    const json = {
      width: 1080,
      height: 1080,
      pages: [
        {
          background: '#ffeedd',
          children: [
            { type: 'image', x: 0, y: 0, width: 540, height: 1080, src: 'https://x/y.jpg' },
            { type: 'image', x: 540, y: 0, width: 540, height: 1080, src: 'https://x/z.jpg', rotation: 5 },
            { type: 'figure', subType: 'circle', x: 440, y: 440, width: 200, height: 200, fill: '#ffffff', shadowEnabled: true, shadowBlur: 10, shadowColor: '#000000', shadowOpacity: 0.5 },
            { type: 'text', x: 100, y: 900, width: 880, height: 100, text: 'Hello', fontSize: 60, fontFamily: 'Roboto', fontWeight: 'bold', fill: '#111111', align: 'center' },
            { type: 'svg', x: 0, y: 0, width: 10, height: 10, src: 'http://evil/x.svg' },
            { type: 'group', children: [{ type: 'figure', subType: 'rect', x: 10, y: 10, width: 20, height: 20, fill: '#000' }] },
          ],
        },
        { children: [] },
      ],
    };
    const d = importPolotno(json, 0);
    const pics = d.layers.filter((l) => l.type === 'picture');
    expect(pics.map((p) => (p as { slot: number }).slot)).toEqual([1, 2]);
    // 1080×1080 → scale 1 (1080/1080), centred horizontally: offset (1920-1080)/2 = 420
    expect(pics[0]).toMatchObject({ x: 420, y: 0, w: 540, h: 1080 });
    expect(d.layers.find((l) => l.type === 'box' && l.shape === 'circle')).toMatchObject({ shadow: { blur: 10, color: 'rgba(0,0,0,0.5)' } });
    expect(d.layers.find((l) => l.type === 'text')).toMatchObject({ text: 'Hello', fontWeight: 700, align: 'center' });
    expect(d.layers.some((l) => l.type === 'image')).toBe(false); // http source refused
    expect(d.layers.filter((l) => l.type === 'box')).toHaveLength(2); // group child kept
    expect(d.background).toBe('#ffeedd');
    expect(designSchema.safeParse(d).success).toBe(true);
    expect(importPolotno(json, 1).layers).toHaveLength(0);
  });

  it('server schema refuses non-https picture sources', () => {
    const bad = { version: 1, width: 1920, height: 1080, background: '#fff', layers: [{ id: 'a', type: 'image', src: 'http://x/y.png', x: 0, y: 0, w: 10, h: 10 }] };
    expect(designSchema.safeParse(bad).success).toBe(false);
    const evil = { ...bad, layers: [{ id: 'a', type: 'text', text: 'x', fontSize: 10, fontFamily: 'Arial;}</style><script>', fontWeight: 400, color: '#000', align: 'left', x: 0, y: 0, w: 10, h: 10 }] };
    expect(designSchema.safeParse(evil).success).toBe(false);
  });
});
