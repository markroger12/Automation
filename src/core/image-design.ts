/** Image template designs (1920×1080). Shared by the renderer, the template editor and the Polotno import. */

export const CANVAS_W = 1920;
export const CANVAS_H = 1080;

export type Shadow = { x: number; y: number; blur: number; color: string };
type Base = { id: string; x: number; y: number; w: number; h: number; rotation?: number; opacity?: number; shadow?: Shadow | null; name?: string };

/** A place for a source picture; `slot` says which picture (1 = first) goes there. */
export type PictureLayer = Base & { type: 'picture'; slot: number; radius?: number; borderWidth?: number; borderColor?: string };
export type LogoLayer = Base & { type: 'logo'; plate: boolean; plateColor?: string; plateRadius?: number; padding?: number };
export type BoxLayer = Base & { type: 'box'; shape: 'rect' | 'circle'; fill: string; stroke?: string; strokeWidth?: number; radius?: number };
export type TextLayer = Base & {
  type: 'text';
  text: string;
  fontSize: number;
  fontFamily: string;
  fontWeight: number;
  color: string;
  align: 'left' | 'center' | 'right';
  lineHeight?: number;
  italic?: boolean;
  uppercase?: boolean;
  letterSpacing?: number;
  background?: string;
};
/** A fixed picture that is part of the design (data: or https: source). */
export type FixedImageLayer = Base & { type: 'image'; src: string; fit?: 'cover' | 'contain'; radius?: number };
export type Layer = PictureLayer | LogoLayer | BoxLayer | TextLayer | FixedImageLayer;

export type Design = { version: 1; width: number; height: number; background: string; layers: Layer[] };
export type TemplateSet = { featured?: Design | null; body?: Design | null };

export type LogoPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'bottom-center';
export type FeaturedStyle = 'split' | 'single';

let idCounter = 0;
export function newId(prefix = 'l'): string {
  idCounter++;
  return `${prefix}${Date.now().toString(36)}${idCounter.toString(36)}`;
}

export function pictureSlots(design: Design): number {
  const slots = new Set(design.layers.filter((l): l is PictureLayer => l.type === 'picture').map((l) => l.slot));
  return slots.size;
}

function logoBox(position: LogoPosition, w: number, h: number, margin = 40) {
  switch (position) {
    case 'top-left':
      return { x: margin, y: margin };
    case 'top-right':
      return { x: CANVAS_W - margin - w, y: margin };
    case 'bottom-left':
      return { x: margin, y: CANVAS_H - margin - h };
    case 'bottom-center':
      return { x: Math.round((CANVAS_W - w) / 2), y: CANVAS_H - margin - h };
    default:
      return { x: CANVAS_W - margin - w, y: CANVAS_H - margin - h };
  }
}

/** Automatic designs used when the website has no custom template. */
export function autoFeaturedDesign(style: FeaturedStyle, accent: string, logoPosition: LogoPosition): Design {
  if (style === 'split') {
    const line = 8;
    const half = (CANVAS_W - line) / 2;
    const logo = 230;
    return {
      version: 1,
      width: CANVAS_W,
      height: CANVAS_H,
      background: '#ffffff',
      layers: [
        { id: 'p1', type: 'picture', slot: 1, x: 0, y: 0, w: half, h: CANVAS_H },
        { id: 'p2', type: 'picture', slot: 2, x: half + line, y: 0, w: half, h: CANVAS_H },
        { id: 'line', type: 'box', shape: 'rect', fill: accent, x: half, y: 0, w: line, h: CANVAS_H },
        { id: 'logo', type: 'logo', plate: true, plateColor: '#ffffff', plateRadius: logo / 2, padding: 34, x: (CANVAS_W - logo) / 2, y: (CANVAS_H - logo) / 2, w: logo, h: logo, shadow: { x: 0, y: 6, blur: 24, color: 'rgba(0,0,0,0.35)' } },
      ],
    };
  }
  const w = 320;
  const h = 130;
  const pos = logoBox(logoPosition, w, h);
  return {
    version: 1,
    width: CANVAS_W,
    height: CANVAS_H,
    background: '#ffffff',
    layers: [
      { id: 'p1', type: 'picture', slot: 1, x: 0, y: 0, w: CANVAS_W, h: CANVAS_H },
      { id: 'bar', type: 'box', shape: 'rect', fill: accent, x: 0, y: CANVAS_H - 10, w: CANVAS_W, h: 10 },
      { id: 'logo', type: 'logo', plate: true, plateColor: '#ffffff', plateRadius: 18, padding: 18, ...pos, w, h, shadow: { x: 0, y: 4, blur: 16, color: 'rgba(0,0,0,0.25)' } },
    ],
  };
}

export function autoBodyDesign(logoPosition: LogoPosition): Design {
  const w = 240;
  const h = 100;
  const pos = logoBox(logoPosition, w, h, 32);
  return {
    version: 1,
    width: CANVAS_W,
    height: CANVAS_H,
    background: '#ffffff',
    layers: [
      { id: 'p1', type: 'picture', slot: 1, x: 0, y: 0, w: CANVAS_W, h: CANVAS_H },
      { id: 'logo', type: 'logo', plate: true, plateColor: '#ffffff', plateRadius: 14, padding: 14, ...pos, w, h, opacity: 0.95 },
    ],
  };
}

export type WebsiteImageSettings = { accentColour: string | null; logoPosition: string; featuredStyle: string; imageTemplate: string | null };

export function parseTemplateSet(raw: string | null | undefined): TemplateSet {
  if (!raw) return {};
  try {
    const t = JSON.parse(raw) as TemplateSet;
    return { featured: isDesign(t.featured) ? t.featured : null, body: isDesign(t.body) ? t.body : null };
  } catch {
    return {};
  }
}

export function isDesign(d: unknown): d is Design {
  return !!d && typeof d === 'object' && Array.isArray((d as Design).layers) && typeof (d as Design).width === 'number';
}

/** The design for a picture kind: the website's custom design, else the automatic one. */
export function designFor(kind: 'featured' | 'body', site: WebsiteImageSettings, accent: string, maxPictures?: number): Design {
  const custom = parseTemplateSet(site.imageTemplate)[kind];
  if (custom && (!maxPictures || pictureSlots(custom) <= maxPictures)) return custom;
  const pos = (['top-left', 'top-right', 'bottom-left', 'bottom-right', 'bottom-center'].includes(site.logoPosition) ? site.logoPosition : 'bottom-right') as LogoPosition;
  if (kind === 'body') return autoBodyDesign(pos);
  const style: FeaturedStyle = site.featuredStyle === 'single' || (maxPictures !== undefined && maxPictures < 2) ? 'single' : 'split';
  return autoFeaturedDesign(style, accent, pos);
}

/** Pixel slot sizes for each picture number (to know how much a picture is stretched). */
export function slotSizes(design: Design): Record<number, { w: number; h: number }> {
  const out: Record<number, { w: number; h: number }> = {};
  for (const l of design.layers) {
    if (l.type !== 'picture') continue;
    const cur = out[l.slot];
    if (!cur || l.w * l.h > cur.w * cur.h) out[l.slot] = { w: l.w, h: l.h };
  }
  return out;
}
