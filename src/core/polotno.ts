import { CANVAS_H, CANVAS_W, type Design, type Layer } from './image-design';

/** Polotno (Canva-like editor) JSON → our design. Only data: and https: sources are kept. */
type PolotnoElement = {
  id?: string;
  type: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  rotation?: number;
  opacity?: number;
  visible?: boolean;
  src?: string;
  text?: string;
  fontSize?: number;
  fontFamily?: string;
  fontWeight?: string | number;
  fontStyle?: string;
  fill?: string;
  align?: string;
  lineHeight?: number | string;
  letterSpacing?: number;
  textTransform?: string;
  subType?: string;
  stroke?: string;
  strokeWidth?: number;
  cornerRadius?: number;
  shadowEnabled?: boolean;
  shadowBlur?: number;
  shadowOffsetX?: number;
  shadowOffsetY?: number;
  shadowColor?: string;
  shadowOpacity?: number;
  children?: PolotnoElement[];
  name?: string;
};

type PolotnoPage = { id?: string; background?: string; width?: number | 'auto'; height?: number | 'auto'; children?: PolotnoElement[] };
export type PolotnoJson = { width?: number; height?: number; pages?: PolotnoPage[] };

export function isSafeSource(src: string | undefined): src is string {
  return !!src && (/^data:image\/(png|jpe?g|webp|gif|svg\+xml);base64,/i.test(src) || /^https:\/\//i.test(src));
}

function rgba(color: string | undefined, opacity = 1): string {
  if (!color) return `rgba(0,0,0,${opacity})`;
  if (opacity >= 1) return color;
  const m = /^#([0-9a-f]{6})$/i.exec(color);
  if (m) {
    const n = parseInt(m[1]!, 16);
    return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${opacity})`;
  }
  return color;
}

export function polotnoPageCount(json: PolotnoJson): number {
  return json.pages?.length ?? 0;
}

/** Converts one Polotno page; a page of another shape is scaled onto 1920×1080 and centred. */
export function importPolotno(json: PolotnoJson, pageIndex = 0): Design {
  const page = json.pages?.[pageIndex];
  if (!page) throw new Error('This Polotno file has no page with that number.');
  const pw = typeof page.width === 'number' ? page.width : (json.width ?? CANVAS_W);
  const ph = typeof page.height === 'number' ? page.height : (json.height ?? CANVAS_H);
  const s = Math.min(CANVAS_W / pw, CANVAS_H / ph);
  const ox = (CANVAS_W - pw * s) / 2;
  const oy = (CANVAS_H - ph * s) / 2;
  let slot = 0;
  const layers: Layer[] = [];
  let n = 0;

  const add = (el: PolotnoElement, dx = 0, dy = 0) => {
    if (el.visible === false) return;
    if (el.type === 'group') {
      for (const c of el.children ?? []) add(c, dx, dy);
      return;
    }
    const base = {
      id: `pl${++n}`,
      x: Math.round(ox + ((el.x ?? 0) + dx) * s),
      y: Math.round(oy + ((el.y ?? 0) + dy) * s),
      w: Math.max(1, Math.round((el.width ?? 100) * s)),
      h: Math.max(1, Math.round((el.height ?? 100) * s)),
      rotation: el.rotation ? Math.round(el.rotation * 10) / 10 : undefined,
      opacity: el.opacity !== undefined && el.opacity < 1 ? el.opacity : undefined,
      name: el.name,
      shadow: el.shadowEnabled ? { x: Math.round((el.shadowOffsetX ?? 0) * s), y: Math.round((el.shadowOffsetY ?? 0) * s), blur: Math.round((el.shadowBlur ?? 0) * s), color: rgba(el.shadowColor ?? '#000000', el.shadowOpacity ?? 1) } : undefined,
    };
    switch (el.type) {
      case 'image':
        layers.push({ ...base, type: 'picture', slot: ++slot, radius: el.cornerRadius ? Math.round(el.cornerRadius * s) : undefined });
        return;
      case 'svg':
        if (isSafeSource(el.src)) layers.push({ ...base, type: 'image', src: el.src, fit: 'contain' });
        return;
      case 'text':
        layers.push({
          ...base,
          type: 'text',
          text: el.text ?? '',
          fontSize: Math.max(6, Math.round((el.fontSize ?? 30) * s)),
          fontFamily: el.fontFamily ?? 'Arial',
          fontWeight: Number(el.fontWeight === 'bold' ? 700 : el.fontWeight === 'normal' ? 400 : (el.fontWeight ?? 400)) || 400,
          italic: el.fontStyle === 'italic',
          color: el.fill ?? '#000000',
          align: el.align === 'center' || el.align === 'right' ? el.align : 'left',
          lineHeight: typeof el.lineHeight === 'number' ? el.lineHeight : 1.2,
          letterSpacing: el.letterSpacing ? Math.round(el.letterSpacing * (el.fontSize ?? 30) * s * 10) / 10 : undefined,
          uppercase: el.textTransform === 'uppercase',
        });
        return;
      case 'figure': {
        const circle = el.subType === 'circle' || el.subType === 'ellipse';
        layers.push({
          ...base,
          type: 'box',
          shape: circle ? 'circle' : 'rect',
          fill: el.fill ?? '#000000',
          stroke: el.stroke,
          strokeWidth: el.strokeWidth ? Math.round(el.strokeWidth * s) : undefined,
          radius: el.cornerRadius ? Math.round(el.cornerRadius * s) : undefined,
        });
        return;
      }
      case 'line':
        layers.push({ ...base, type: 'box', shape: 'rect', fill: el.stroke ?? el.fill ?? '#000000', h: Math.max(1, Math.round((el.height ?? el.strokeWidth ?? 2) * s)) });
        return;
      default:
        return;
    }
  };
  for (const el of page.children ?? []) add(el);
  const bg = page.background && /^(#|rgb|hsl)/.test(page.background) ? page.background : '#ffffff';
  if (page.background && isSafeSource(page.background)) layers.unshift({ id: 'bg', type: 'image', src: page.background, x: 0, y: 0, w: CANVAS_W, h: CANVAS_H, fit: 'cover' });
  return { version: 1, width: CANVAS_W, height: CANVAS_H, background: bg, layers };
}
