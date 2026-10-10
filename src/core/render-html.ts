import type { Design, Layer, PictureLayer } from './image-design';

export type FaceBox = { x: number; y: number; w: number; h: number; score?: number };
export type PictureInput = { src: string; width: number; height: number; faces?: FaceBox[] } | null;

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Cover-fit with face focus: the picture fills the slot; when faces are known, their centre lands at 40% of the
 * slot height (and the horizontal centre of the faces in the middle), clamped so no empty space shows.
 */
export function coverPlacement(slotW: number, slotH: number, imgW: number, imgH: number, faces?: FaceBox[]) {
  const scale = Math.max(slotW / imgW, slotH / imgH);
  const sw = imgW * scale;
  const sh = imgH * scale;
  let left = (slotW - sw) / 2;
  let top = (slotH - sh) / 2;
  if (faces && faces.length) {
    const x1 = Math.min(...faces.map((f) => f.x));
    const y1 = Math.min(...faces.map((f) => f.y));
    const x2 = Math.max(...faces.map((f) => f.x + f.w));
    const y2 = Math.max(...faces.map((f) => f.y + f.h));
    const cx = ((x1 + x2) / 2) * scale;
    const cy = ((y1 + y2) / 2) * scale;
    left = slotW / 2 - cx;
    top = slotH * 0.4 - cy;
  }
  left = Math.min(0, Math.max(slotW - sw, left));
  top = Math.min(0, Math.max(slotH - sh, top));
  return { width: Math.round(sw), height: Math.round(sh), left: Math.round(left), top: Math.round(top), scale };
}

function common(l: Layer): string {
  const parts = [`position:absolute`, `left:${l.x}px`, `top:${l.y}px`, `width:${l.w}px`, `height:${l.h}px`];
  if (l.rotation) parts.push(`transform:rotate(${l.rotation}deg)`, 'transform-origin:center center');
  if (l.opacity !== undefined && l.opacity < 1) parts.push(`opacity:${l.opacity}`);
  if (l.shadow) parts.push(`box-shadow:${l.shadow.x}px ${l.shadow.y}px ${l.shadow.blur}px ${l.shadow.color}`);
  return parts.join(';');
}

function fill(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k: string) => vars[k] ?? '');
}

/** Builds a self-contained HTML page for one design; pictures and logo are data: URLs. */
export function buildDesignHtml(design: Design, input: { pictures: PictureInput[]; logo: string | null; vars?: Record<string, string>; fonts?: string[] }): string {
  const vars = input.vars ?? {};
  const layers = design.layers
    .map((l) => {
      switch (l.type) {
        case 'picture': {
          const pic = input.pictures[(l as PictureLayer).slot - 1];
          const radius = l.radius ? `border-radius:${l.radius}px;` : '';
          const border = l.borderWidth ? `border:${l.borderWidth}px solid ${l.borderColor ?? '#fff'};box-sizing:border-box;` : '';
          if (!pic) return `<div style="${common(l)};${radius}${border}background:#d1d5db"></div>`;
          const p = coverPlacement(l.w, l.h, pic.width, pic.height, pic.faces);
          return `<div style="${common(l)};overflow:hidden;${radius}${border}"><img src="${pic.src}" style="position:absolute;left:${p.left}px;top:${p.top}px;width:${p.width}px;height:${p.height}px;max-width:none"></div>`;
        }
        case 'logo': {
          if (!input.logo) return '';
          const pad = l.plate ? (l.padding ?? 16) : 0;
          const plate = l.plate ? `background:${l.plateColor ?? '#fff'};border-radius:${l.plateRadius ?? 12}px;` : '';
          return `<div style="${common(l)};${plate}box-sizing:border-box;padding:${pad}px;display:flex;align-items:center;justify-content:center"><img src="${input.logo}" style="max-width:100%;max-height:100%;object-fit:contain"></div>`;
        }
        case 'box': {
          const radius = l.shape === 'circle' ? 'border-radius:50%;' : l.radius ? `border-radius:${l.radius}px;` : '';
          const stroke = l.strokeWidth ? `border:${l.strokeWidth}px solid ${l.stroke ?? '#000'};box-sizing:border-box;` : '';
          return `<div style="${common(l)};background:${l.fill};${radius}${stroke}"></div>`;
        }
        case 'text': {
          const text = esc(fill(l.text, vars)).replace(/\n/g, '<br>');
          const style = [
            `font-family:${l.fontFamily}`,
            `font-size:${l.fontSize}px`,
            `font-weight:${l.fontWeight}`,
            `color:${l.color}`,
            `text-align:${l.align}`,
            `line-height:${l.lineHeight ?? 1.2}`,
            l.italic ? 'font-style:italic' : '',
            l.uppercase ? 'text-transform:uppercase' : '',
            l.letterSpacing ? `letter-spacing:${l.letterSpacing}px` : '',
            l.background ? `background:${l.background}` : '',
            'overflow:hidden',
            'word-wrap:break-word',
          ]
            .filter(Boolean)
            .join(';');
          return `<div style="${common(l)};${style}">${text}</div>`;
        }
        case 'image': {
          if (!/^(data:image\/|https:\/\/)/.test(l.src)) return '';
          const radius = l.radius ? `border-radius:${l.radius}px;` : '';
          return `<div style="${common(l)};overflow:hidden;${radius}"><img src="${esc(l.src)}" style="width:100%;height:100%;object-fit:${l.fit ?? 'cover'}"></div>`;
        }
        default:
          return '';
      }
    })
    .join('\n');
  const fontLinks = (input.fonts ?? []).map((f) => `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=${encodeURIComponent(f)}:wght@400;600;700;800&display=block">`).join('');
  return `<!doctype html><html><head><meta charset="utf-8">${fontLinks}<style>html,body{margin:0;padding:0;}body{width:${design.width}px;height:${design.height}px;overflow:hidden;position:relative;background:${design.background};font-family:Arial,Helvetica,sans-serif}</style></head><body>${layers}</body></html>`;
}

/** Google font families used by text layers (system fonts are skipped). */
export function designFonts(design: Design): string[] {
  const system = /^(arial|helvetica|verdana|georgia|times|courier|tahoma|segoe|system-ui|sans-serif|serif|monospace|impact)/i;
  const out = new Set<string>();
  for (const l of design.layers) {
    if (l.type !== 'text') continue;
    const first = l.fontFamily.split(',')[0]!.replace(/["']/g, '').trim();
    if (first && !system.test(first)) out.add(first);
  }
  return [...out].slice(0, 4);
}
