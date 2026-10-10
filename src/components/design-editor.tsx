'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { ImagePlus, Square, Circle, Type, Image as ImageIcon, Undo2, Redo2, Maximize, ZoomIn, Upload, Trash2, ArrowUp, ArrowDown, RotateCcw, BadgeCheck } from 'lucide-react';
import { CANVAS_H, CANVAS_W, newId, type Design, type Layer } from '@/core/image-design';
import { importPolotno, isSafeSource, polotnoPageCount, type PolotnoJson } from '@/core/polotno';
import { Button, Field, Input, Select, Toggle, cn } from './ui';

type Props = { value: Design; onChange: (d: Design) => void; logoUrl: string | null; onReset?: () => void };
type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
type DragState = { kind: 'move' | Handle; id: string; startX: number; startY: number; orig: Layer; base: Design };

const SNAP = 10;
const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

function layerLabel(l: Layer): string {
  if (l.name) return l.name;
  switch (l.type) {
    case 'picture':
      return `Picture place ${l.slot}`;
    case 'logo':
      return 'Logo';
    case 'box':
      return l.shape === 'circle' ? 'Circle' : 'Box';
    case 'text':
      return `Text “${l.text.slice(0, 18)}”`;
    case 'image':
      return 'Fixed picture';
  }
}

/** Snaps a value to the nearest guide within SNAP canvas pixels. */
function snapValue(v: number, guides: number[]): { value: number; guide: number | null } {
  let best: number | null = null;
  for (const g of guides) if (Math.abs(g - v) <= SNAP && (best === null || Math.abs(g - v) < Math.abs(best - v))) best = g;
  return best === null ? { value: v, guide: null } : { value: best, guide: best };
}

export function DesignEditor({ value, onChange, logoUrl, onReset }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState<'fit' | 1>('fit');
  const [scale, setScale] = useState(0.4);
  const [selected, setSelected] = useState<string | null>(null);
  const [past, setPast] = useState<Design[]>([]);
  const [future, setFuture] = useState<Design[]>([]);
  const [guides, setGuides] = useState<{ x: number[]; y: number[] }>({ x: [], y: [] });
  const drag = useRef<DragState | null>(null);
  const [draft, setDraft] = useState<Design | null>(null);
  const design = draft ?? value;

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => setScale(zoom === 'fit' ? Math.max(0.1, (el.clientWidth - 2) / CANVAS_W) : 1);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [zoom]);

  const commit = useCallback(
    (next: Design, base: Design = value) => {
      setPast((p) => [...p.slice(-60), base]);
      setFuture([]);
      onChange(next);
    },
    [onChange, value],
  );

  const updateLayer = useCallback(
    (id: string, patch: Partial<Layer>) => {
      const next = clone(value);
      next.layers = next.layers.map((l) => (l.id === id ? ({ ...l, ...patch } as Layer) : l));
      commit(next);
    },
    [value, commit],
  );

  function undo() {
    const prev = past[past.length - 1];
    if (!prev) return;
    setPast(past.slice(0, -1));
    setFuture([value, ...future]);
    onChange(prev);
  }
  function redo() {
    const next = future[0];
    if (!next) return;
    setFuture(future.slice(1));
    setPast([...past, value]);
    onChange(next);
  }

  function addLayer(layer: Layer) {
    const next = clone(value);
    next.layers.push(layer);
    commit(next);
    setSelected(layer.id);
  }

  function removeSelected() {
    if (!selected) return;
    const next = clone(value);
    next.layers = next.layers.filter((l) => l.id !== selected);
    commit(next);
    setSelected(null);
  }

  function moveOrder(dir: 1 | -1) {
    if (!selected) return;
    const next = clone(value);
    const i = next.layers.findIndex((l) => l.id === selected);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= next.layers.length) return;
    [next.layers[i], next.layers[j]] = [next.layers[j]!, next.layers[i]!];
    commit(next);
  }

  // Keyboard: arrows move 1 px (Shift 10), Delete removes, Ctrl+Z / Ctrl+Y undo and redo.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable) return;
      if (!wrapRef.current?.closest('[data-design-editor]')?.contains(document.activeElement) && document.activeElement !== document.body) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) {
        e.preventDefault();
        redo();
        return;
      }
      if (!selected) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        removeSelected();
        return;
      }
      const step = e.shiftKey ? 10 : 1;
      const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      const m = moves[e.key];
      if (m) {
        e.preventDefault();
        const l = value.layers.find((x) => x.id === selected);
        if (l) updateLayer(selected, { x: l.x + m[0], y: l.y + m[1] });
      }
      if (e.key === 'Escape') setSelected(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  function startDrag(e: ReactPointerEvent, id: string, kind: DragState['kind']) {
    e.stopPropagation();
    e.preventDefault();
    const layer = value.layers.find((l) => l.id === id);
    if (!layer) return;
    setSelected(id);
    drag.current = { kind, id, startX: e.clientX, startY: e.clientY, orig: clone(layer), base: value };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  }

  function onPointerMove(e: ReactPointerEvent) {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.startX) / scale;
    const dy = (e.clientY - d.startY) / scale;
    const o = d.orig;
    let { x, y, w, h } = o;
    const others = d.base.layers.filter((l) => l.id !== d.id);
    const gx = [0, CANVAS_W / 2, CANVAS_W, ...others.flatMap((l) => [l.x, l.x + l.w / 2, l.x + l.w])];
    const gy = [0, CANVAS_H / 2, CANVAS_H, ...others.flatMap((l) => [l.y, l.y + l.h / 2, l.y + l.h])];
    const shownX: number[] = [];
    const shownY: number[] = [];
    const free = e.shiftKey;
    if (d.kind === 'move') {
      x = o.x + dx;
      y = o.y + dy;
      if (!free) {
        const cands = [
          { off: 0, s: snapValue(x, gx) },
          { off: w / 2, s: snapValue(x + w / 2, gx) },
          { off: w, s: snapValue(x + w, gx) },
        ].filter((c) => c.s.guide !== null);
        if (cands[0]) {
          x = cands[0].s.value - cands[0].off;
          shownX.push(cands[0].s.guide!);
        }
        const candsY = [
          { off: 0, s: snapValue(y, gy) },
          { off: h / 2, s: snapValue(y + h / 2, gy) },
          { off: h, s: snapValue(y + h, gy) },
        ].filter((c) => c.s.guide !== null);
        if (candsY[0]) {
          y = candsY[0].s.value - candsY[0].off;
          shownY.push(candsY[0].s.guide!);
        }
      }
    } else {
      const k = d.kind;
      let left = o.x;
      let top = o.y;
      let right = o.x + o.w;
      let bottom = o.y + o.h;
      if (k.includes('w')) left = o.x + dx;
      if (k.includes('e')) right = o.x + o.w + dx;
      if (k.includes('n')) top = o.y + dy;
      if (k.includes('s')) bottom = o.y + o.h + dy;
      if (!free) {
        if (k.includes('w')) {
          const s = snapValue(left, gx);
          left = s.value;
          if (s.guide !== null) shownX.push(s.guide);
        }
        if (k.includes('e')) {
          const s = snapValue(right, gx);
          right = s.value;
          if (s.guide !== null) shownX.push(s.guide);
        }
        if (k.includes('n')) {
          const s = snapValue(top, gy);
          top = s.value;
          if (s.guide !== null) shownY.push(s.guide);
        }
        if (k.includes('s')) {
          const s = snapValue(bottom, gy);
          bottom = s.value;
          if (s.guide !== null) shownY.push(s.guide);
        }
      }
      x = Math.min(left, right - 4);
      y = Math.min(top, bottom - 4);
      w = Math.max(4, right - left);
      h = Math.max(4, bottom - top);
    }
    const next = clone(d.base);
    next.layers = next.layers.map((l) => (l.id === d.id ? ({ ...l, x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) } as Layer) : l));
    setDraft(next);
    setGuides({ x: shownX, y: shownY });
  }

  function onPointerUp() {
    const d = drag.current;
    drag.current = null;
    setGuides({ x: [], y: [] });
    if (d && draft) {
      commit(draft, d.base);
    }
    setDraft(null);
  }

  async function importFile(file: File) {
    try {
      const json = JSON.parse(await file.text()) as PolotnoJson;
      const pages = polotnoPageCount(json);
      if (!pages) throw new Error('No pages in this file.');
      let page = 0;
      if (pages > 1) {
        const answer = prompt(`This file has ${pages} pages. Which page should be used? (1–${pages})`, '1');
        page = Math.min(pages, Math.max(1, Number(answer) || 1)) - 1;
      }
      const d = importPolotno(json, page);
      commit(d);
      setSelected(null);
    } catch (err) {
      alert(`Could not import: ${(err as Error).message}`);
    }
  }

  async function addFixedPicture(file?: File) {
    let src: string | null = null;
    if (file) {
      if (file.size > 3 * 1024 * 1024) return alert('Use a picture smaller than 3 MB.');
      src = await new Promise<string>((r) => {
        const fr = new FileReader();
        fr.onload = () => r(String(fr.result));
        fr.readAsDataURL(file);
      });
    } else {
      src = prompt('Picture address (https://…)');
    }
    if (!src || !isSafeSource(src)) return src ? alert('Only https:// addresses or uploaded pictures are allowed.') : undefined;
    addLayer({ id: newId(), type: 'image', src, x: 760, y: 340, w: 400, h: 400, fit: 'contain' });
  }

  const sel = design.layers.find((l) => l.id === selected) ?? null;
  const maxSlot = Math.max(0, ...design.layers.filter((l) => l.type === 'picture').map((l) => (l as { slot: number }).slot));

  return (
    <div data-design-editor tabIndex={-1} className="outline-none">
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <Button size="xs" icon={<ImagePlus className="h-3.5 w-3.5" />} onClick={() => addLayer({ id: newId(), type: 'picture', slot: maxSlot + 1, x: 560, y: 190, w: 800, h: 700 })}>
          Picture place
        </Button>
        <Button size="xs" icon={<BadgeCheck className="h-3.5 w-3.5" />} onClick={() => addLayer({ id: newId(), type: 'logo', plate: true, plateColor: '#ffffff', plateRadius: 14, padding: 14, x: 1620, y: 940, w: 260, h: 100 })}>
          Logo
        </Button>
        <Button size="xs" icon={<Square className="h-3.5 w-3.5" />} onClick={() => addLayer({ id: newId(), type: 'box', shape: 'rect', fill: '#2753e6', x: 860, y: 0, w: 200, h: 1080 })}>
          Box
        </Button>
        <Button size="xs" icon={<Circle className="h-3.5 w-3.5" />} onClick={() => addLayer({ id: newId(), type: 'box', shape: 'circle', fill: '#ffffff', x: 860, y: 440, w: 200, h: 200 })}>
          Circle
        </Button>
        <Button size="xs" icon={<Type className="h-3.5 w-3.5" />} onClick={() => addLayer({ id: newId(), type: 'text', text: '{{keyword}}', fontSize: 72, fontFamily: 'Arial', fontWeight: 800, color: '#ffffff', align: 'center', x: 360, y: 880, w: 1200, h: 120 })}>
          Text
        </Button>
        <label className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-gray-800 shadow-sm hover:bg-gray-50">
          <ImageIcon className="h-3.5 w-3.5" /> Fixed picture
          <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && addFixedPicture(e.target.files[0])} />
        </label>
        <span className="mx-1 h-5 w-px bg-gray-200" />
        <Button size="xs" variant="ghost" icon={<Undo2 className="h-3.5 w-3.5" />} onClick={undo} disabled={!past.length} title="Ctrl+Z">
          Undo
        </Button>
        <Button size="xs" variant="ghost" icon={<Redo2 className="h-3.5 w-3.5" />} onClick={redo} disabled={!future.length} title="Ctrl+Y">
          Redo
        </Button>
        <Button size="xs" variant={zoom === 'fit' ? 'secondary' : 'ghost'} icon={<Maximize className="h-3.5 w-3.5" />} onClick={() => setZoom('fit')}>
          Fit
        </Button>
        <Button size="xs" variant={zoom === 1 ? 'secondary' : 'ghost'} icon={<ZoomIn className="h-3.5 w-3.5" />} onClick={() => setZoom(1)}>
          100%
        </Button>
        <span className="flex-1" />
        <label className="inline-flex cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100">
          <Upload className="h-3.5 w-3.5" /> Import Polotno JSON
          <input type="file" accept=".json,application/json" className="hidden" onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])} />
        </label>
        {onReset && (
          <Button size="xs" variant="ghost" icon={<RotateCcw className="h-3.5 w-3.5" />} onClick={() => confirm('Drop this design and go back to the automatic one?') && onReset()}>
            Back to automatic
          </Button>
        )}
      </div>

      <div className="grid gap-3 xl:grid-cols-[1fr_280px]">
        <div ref={wrapRef} className={cn('relative rounded-md border border-gray-300 bg-gray-100', zoom === 1 ? 'max-h-[70vh] overflow-auto' : 'overflow-hidden')} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerLeave={onPointerUp}>
          <div style={{ width: CANVAS_W * scale, height: CANVAS_H * scale }} onPointerDown={() => setSelected(null)}>
            <div className="relative origin-top-left select-none" style={{ width: CANVAS_W, height: CANVAS_H, transform: `scale(${scale})`, background: design.background }}>
              {design.layers.map((l) => (
                <LayerView key={l.id} layer={l} logoUrl={logoUrl} selected={l.id === selected} onPointerDown={(e) => startDrag(e, l.id, 'move')} />
              ))}
              {sel && (
                <div className="pointer-events-none absolute" style={{ left: sel.x, top: sel.y, width: sel.w, height: sel.h, outline: `${2 / scale}px solid #2753e6` }}>
                  {HANDLES.map((hd) => {
                    const size = 12 / scale;
                    const pos: Record<Handle, React.CSSProperties> = {
                      nw: { left: -size / 2, top: -size / 2, cursor: 'nwse-resize' },
                      n: { left: '50%', top: -size / 2, marginLeft: -size / 2, cursor: 'ns-resize' },
                      ne: { right: -size / 2, top: -size / 2, cursor: 'nesw-resize' },
                      e: { right: -size / 2, top: '50%', marginTop: -size / 2, cursor: 'ew-resize' },
                      se: { right: -size / 2, bottom: -size / 2, cursor: 'nwse-resize' },
                      s: { left: '50%', bottom: -size / 2, marginLeft: -size / 2, cursor: 'ns-resize' },
                      sw: { left: -size / 2, bottom: -size / 2, cursor: 'nesw-resize' },
                      w: { left: -size / 2, top: '50%', marginTop: -size / 2, cursor: 'ew-resize' },
                    };
                    return <div key={hd} className="pointer-events-auto absolute border border-brand-600 bg-white" style={{ width: size, height: size, ...pos[hd] }} onPointerDown={(e) => startDrag(e, sel.id, hd)} />;
                  })}
                </div>
              )}
              {guides.x.map((g, i) => (
                <div key={`gx${i}`} className="pointer-events-none absolute top-0 bg-pink-500" style={{ left: g, width: 1 / scale, height: CANVAS_H }} />
              ))}
              {guides.y.map((g, i) => (
                <div key={`gy${i}`} className="pointer-events-none absolute left-0 bg-pink-500" style={{ top: g, height: 1 / scale, width: CANVAS_W }} />
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <div className="rounded-md border border-gray-200 bg-white">
            <div className="border-b border-gray-100 px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">Layers (top last)</div>
            <ul className="max-h-48 overflow-y-auto text-sm">
              {design.layers.map((l) => (
                <li key={l.id}>
                  <button onClick={() => setSelected(l.id)} className={cn('w-full truncate px-2 py-1 text-left', l.id === selected ? 'bg-brand-50 text-brand-700' : 'hover:bg-gray-50')}>
                    {layerLabel(l)}
                  </button>
                </li>
              ))}
            </ul>
          </div>
          {sel ? (
            <Properties layer={sel} onChange={(patch) => updateLayer(sel.id, patch)} onDelete={removeSelected} onOrder={moveOrder} />
          ) : (
            <div className="rounded-md border border-dashed border-gray-300 p-3 text-xs text-gray-500">
              Click a layer to edit it. Drag to move, use the handles to resize. Shift turns snapping off. Arrow keys move 1 px (Shift: 10 px), Delete removes, Ctrl+Z / Ctrl+Y undo and redo.
              <Field label="Background" className="mt-3">
                <Input type="color" value={/^#[0-9a-f]{6}$/i.test(design.background) ? design.background : '#ffffff'} onChange={(e) => commit({ ...clone(value), background: e.target.value })} />
              </Field>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function LayerView({ layer: l, logoUrl, selected, onPointerDown }: { layer: Layer; logoUrl: string | null; selected: boolean; onPointerDown: (e: ReactPointerEvent) => void }) {
  const style: React.CSSProperties = {
    position: 'absolute',
    left: l.x,
    top: l.y,
    width: l.w,
    height: l.h,
    transform: l.rotation ? `rotate(${l.rotation}deg)` : undefined,
    opacity: l.opacity,
    boxShadow: l.shadow ? `${l.shadow.x}px ${l.shadow.y}px ${l.shadow.blur}px ${l.shadow.color}` : undefined,
    cursor: 'move',
  };
  let inner: React.ReactNode = null;
  switch (l.type) {
    case 'picture':
      Object.assign(style, { background: 'repeating-linear-gradient(45deg,#cbd5e1,#cbd5e1 20px,#e2e8f0 20px,#e2e8f0 40px)', borderRadius: l.radius, border: l.borderWidth ? `${l.borderWidth}px solid ${l.borderColor ?? '#fff'}` : undefined, boxSizing: 'border-box' });
      inner = <div className="flex h-full w-full items-center justify-center text-[120px] font-bold text-slate-500">{l.slot}</div>;
      break;
    case 'logo':
      Object.assign(style, { background: l.plate ? l.plateColor ?? '#fff' : undefined, borderRadius: l.plate ? l.plateRadius : undefined, padding: l.plate ? l.padding ?? 16 : 0, boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: 'center' });
      // eslint-disable-next-line @next/next/no-img-element
      inner = logoUrl ? <img src={logoUrl} alt="" draggable={false} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} /> : <span className="text-4xl font-bold text-gray-400">LOGO</span>;
      break;
    case 'box':
      Object.assign(style, { background: l.fill, borderRadius: l.shape === 'circle' ? '50%' : l.radius, border: l.strokeWidth ? `${l.strokeWidth}px solid ${l.stroke ?? '#000'}` : undefined, boxSizing: 'border-box' });
      break;
    case 'text':
      Object.assign(style, { fontFamily: l.fontFamily, fontSize: l.fontSize, fontWeight: l.fontWeight, color: l.color, textAlign: l.align, lineHeight: l.lineHeight ?? 1.2, fontStyle: l.italic ? 'italic' : undefined, textTransform: l.uppercase ? 'uppercase' : undefined, letterSpacing: l.letterSpacing, background: l.background, overflow: 'hidden', whiteSpace: 'pre-wrap' });
      inner = l.text;
      break;
    case 'image':
      // eslint-disable-next-line @next/next/no-img-element
      inner = <img src={l.src} alt="" draggable={false} style={{ width: '100%', height: '100%', objectFit: l.fit ?? 'cover', borderRadius: l.radius }} />;
      break;
  }
  return (
    <div style={style} onPointerDown={onPointerDown} data-selected={selected || undefined}>
      {inner}
    </div>
  );
}

function NumberField({ label, value, onChange, step = 1 }: { label: string; value: number | undefined; onChange: (v: number) => void; step?: number }) {
  return (
    <label className="block text-xs">
      <span className="text-gray-500">{label}</span>
      <input type="number" step={step} value={value ?? 0} onChange={(e) => onChange(Number(e.target.value))} className="mt-0.5 block w-full rounded border border-gray-300 px-1.5 py-1 text-xs" />
    </label>
  );
}

function ColorField({ label, value, onChange }: { label: string; value: string | undefined; onChange: (v: string) => void }) {
  return (
    <label className="flex items-center justify-between gap-2 text-xs">
      <span className="text-gray-500">{label}</span>
      <input type="color" value={value && /^#[0-9a-f]{6}$/i.test(value) ? value : '#000000'} onChange={(e) => onChange(e.target.value)} className="h-6 w-10 rounded border border-gray-300" />
    </label>
  );
}

function Properties({ layer: l, onChange, onDelete, onOrder }: { layer: Layer; onChange: (p: Partial<Layer>) => void; onDelete: () => void; onOrder: (d: 1 | -1) => void }) {
  return (
    <div className="space-y-3 rounded-md border border-gray-200 bg-white p-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold">{layerLabel(l)}</span>
        <div className="flex gap-1">
          <button className="rounded p-1 text-gray-500 hover:bg-gray-100" title="Bring forward" onClick={() => onOrder(1)}>
            <ArrowUp className="h-4 w-4" />
          </button>
          <button className="rounded p-1 text-gray-500 hover:bg-gray-100" title="Send backward" onClick={() => onOrder(-1)}>
            <ArrowDown className="h-4 w-4" />
          </button>
          <button className="rounded p-1 text-gray-500 hover:bg-red-50 hover:text-red-600" title="Delete" onClick={onDelete}>
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <NumberField label="X" value={l.x} onChange={(v) => onChange({ x: v })} />
        <NumberField label="Y" value={l.y} onChange={(v) => onChange({ y: v })} />
        <NumberField label="Width" value={l.w} onChange={(v) => onChange({ w: Math.max(1, v) })} />
        <NumberField label="Height" value={l.h} onChange={(v) => onChange({ h: Math.max(1, v) })} />
        <NumberField label="Rotation" value={l.rotation} onChange={(v) => onChange({ rotation: v })} />
        <NumberField label="Opacity" value={l.opacity ?? 1} step={0.05} onChange={(v) => onChange({ opacity: Math.min(1, Math.max(0, v)) })} />
      </div>
      {l.type === 'picture' && (
        <div className="grid grid-cols-2 gap-2">
          <NumberField label="Picture number" value={l.slot} onChange={(v) => onChange({ slot: Math.min(10, Math.max(1, Math.round(v))) } as Partial<Layer>)} />
          <NumberField label="Corner radius" value={l.radius} onChange={(v) => onChange({ radius: v } as Partial<Layer>)} />
          <NumberField label="Border" value={l.borderWidth} onChange={(v) => onChange({ borderWidth: v } as Partial<Layer>)} />
          <ColorField label="Border colour" value={l.borderColor} onChange={(v) => onChange({ borderColor: v } as Partial<Layer>)} />
        </div>
      )}
      {l.type === 'logo' && (
        <div className="space-y-2">
          <Toggle checked={l.plate} onChange={(v) => onChange({ plate: v } as Partial<Layer>)} label="White plate behind the logo" />
          {l.plate && (
            <>
              <ColorField label="Plate colour" value={l.plateColor} onChange={(v) => onChange({ plateColor: v } as Partial<Layer>)} />
              <div className="grid grid-cols-2 gap-2">
                <NumberField label="Plate radius" value={l.plateRadius} onChange={(v) => onChange({ plateRadius: v } as Partial<Layer>)} />
                <NumberField label="Padding" value={l.padding} onChange={(v) => onChange({ padding: v } as Partial<Layer>)} />
              </div>
            </>
          )}
        </div>
      )}
      {l.type === 'box' && (
        <div className="space-y-2">
          <Select value={l.shape} onChange={(e) => onChange({ shape: e.target.value as 'rect' | 'circle' } as Partial<Layer>)}>
            <option value="rect">Rectangle</option>
            <option value="circle">Circle</option>
          </Select>
          <ColorField label="Fill" value={l.fill} onChange={(v) => onChange({ fill: v } as Partial<Layer>)} />
          <ColorField label="Line colour" value={l.stroke} onChange={(v) => onChange({ stroke: v } as Partial<Layer>)} />
          <div className="grid grid-cols-2 gap-2">
            <NumberField label="Line width" value={l.strokeWidth} onChange={(v) => onChange({ strokeWidth: v } as Partial<Layer>)} />
            <NumberField label="Corner radius" value={l.radius} onChange={(v) => onChange({ radius: v } as Partial<Layer>)} />
          </div>
        </div>
      )}
      {l.type === 'text' && (
        <div className="space-y-2">
          <label className="block text-xs">
            <span className="text-gray-500">Text ({'{{keyword}}'}, {'{{title}}'}, {'{{image_text}}'})</span>
            <textarea value={l.text} rows={2} onChange={(e) => onChange({ text: e.target.value } as Partial<Layer>)} className="mt-0.5 block w-full rounded border border-gray-300 px-1.5 py-1 text-xs" />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <NumberField label="Size" value={l.fontSize} onChange={(v) => onChange({ fontSize: Math.max(4, v) } as Partial<Layer>)} />
            <NumberField label="Weight" value={l.fontWeight} step={100} onChange={(v) => onChange({ fontWeight: Math.min(900, Math.max(100, v)) } as Partial<Layer>)} />
          </div>
          <label className="block text-xs">
            <span className="text-gray-500">Font</span>
            <input value={l.fontFamily} onChange={(e) => onChange({ fontFamily: e.target.value.replace(/[^\w\s,'"-]/g, '') } as Partial<Layer>)} className="mt-0.5 block w-full rounded border border-gray-300 px-1.5 py-1 text-xs" />
          </label>
          <ColorField label="Colour" value={l.color} onChange={(v) => onChange({ color: v } as Partial<Layer>)} />
          <Select value={l.align} onChange={(e) => onChange({ align: e.target.value as 'left' | 'center' | 'right' } as Partial<Layer>)}>
            <option value="left">Left</option>
            <option value="center">Centre</option>
            <option value="right">Right</option>
          </Select>
          <Toggle checked={!!l.uppercase} onChange={(v) => onChange({ uppercase: v } as Partial<Layer>)} label="Capitals" />
        </div>
      )}
      {l.type === 'image' && (
        <Select value={l.fit ?? 'cover'} onChange={(e) => onChange({ fit: e.target.value as 'cover' | 'contain' } as Partial<Layer>)}>
          <option value="cover">Fill the box</option>
          <option value="contain">Fit inside the box</option>
        </Select>
      )}
    </div>
  );
}
