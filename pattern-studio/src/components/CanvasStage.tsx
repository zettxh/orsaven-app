import { useCallback, useEffect, useRef, useState } from "react";
import type { Asset, BackgroundMode, PatternItem, PreviewMode, TileSettings } from "../lib/types";
import { wrap } from "../lib/types";
import { copyRange, drawChecker, drawPreview, itemBounds, renderTileCanvas } from "../lib/pattern";
import { clearImageCache, loadImage, removeImageCallbacks } from "../lib/assets";

interface Props {
  tile: TileSettings;
  items: PatternItem[];
  assets: Asset[];
  selectedId: string | null;
  preview: PreviewMode;
  zoom: number;
  pan: { x: number; y: number };
  showOutline: boolean;
  onSelect: (id: string | null) => void;
  onMoveItem: (id: string, x: number, y: number) => void;
  onViewChange: (zoom: number, pan: { x: number; y: number }) => void;
}

type Drag =
  | { kind: "item"; pointerId: number; items: PatternItem[]; tile: TileSettings; id: string; dx: number; dy: number; startX: number; startY: number; x: number; y: number }
  | { kind: "pan"; pointerId: number; items: PatternItem[]; tile: TileSettings; sx: number; sy: number; panX: number; panY: number };
const MAX_TILE_CACHE_PIXELS = 8_000_000;
const clampZoom = (value: number) => Math.min(3, Math.max(0.1, value));

export default function CanvasStage(props: Props) {
  const { tile, items, assets, selectedId, preview, zoom, pan, showOutline } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const spaceRef = useRef(false);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [tick, setTick] = useState(0);
  const [retryVersion, setRetryVersion] = useState(0);
  const [draft, setDraft] = useState<{ id: string; x: number; y: number } | null>(null);
  const [loadErrors, setLoadErrors] = useState<string[]>([]);
  const tileCanvas = useRef<HTMLCanvasElement | null>(null);
  const assetNames = useRef(assets);
  assetNames.current = assets;
  const onImageLoad = useCallback(() => setTick((n) => n + 1), []);
  const onImageError = useCallback((error: Error, src: string) => {
    const name = assetNames.current.find((asset) => asset.src === src)?.name ?? error.message;
    setLoadErrors((current) => current.includes(name) ? current : [...current, name]);
  }, []);
  const activeItems = draft ? items.map((item) => item.id === draft.id ? { ...item, x: draft.x, y: draft.y } : item) : items;

  useEffect(() => {
    const cacheScale = Math.min(1, Math.sqrt(MAX_TILE_CACHE_PIXELS / (tile.width * tile.height)));
    const cache = renderTileCanvas(tile, activeItems, assets, cacheScale, onImageLoad);
    const previous = tileCanvas.current;
    tileCanvas.current = cache;
    previous && (previous.width = previous.height = 0);
    return () => { cache.width = 0; cache.height = 0; };
  }, [tile, activeItems, assets, tick, onImageLoad]);

  useEffect(() => {
    const sources = [...new Set(assets.map((asset) => asset.src))];
    const onErrors = new Map(sources.map((src) => [src, (error: Error) => onImageError(error, src)]));
    setLoadErrors((current) => current.length ? [] : current);
    for (const src of sources) loadImage(src, onImageLoad, onErrors.get(src));
    return () => {
      for (const src of sources) removeImageCallbacks(src, onImageLoad, onErrors.get(src));
    };
  }, [assets, retryVersion, onImageLoad, onImageError]);

  useEffect(() => {
    const drag = dragRef.current;
    if (drag && (drag.items !== items || drag.tile !== tile || drag.kind === "item" && selectedId !== drag.id)) cancelDrag();
  }, [items, tile, selectedId]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      const rect = element.getBoundingClientRect();
      setSize({ w: Math.max(100, rect.width), h: Math.max(100, rect.height) });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => () => {
    if (tileCanvas.current) { tileCanvas.current.width = 0; tileCanvas.current.height = 0; }
    clearImageCache();
  }, []);

  const fit = Math.min(size.w / tile.width, size.h / tile.height) * 0.85;
  const scale = preview === "tile" ? fit * zoom : zoom;
  const origin = {
    x: (size.w - tile.width * scale) / 2 + pan.x,
    y: (size.h - tile.height * scale) / 2 + pan.y,
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    const tc = tileCanvas.current;
    if (!canvas || !tc) return;
    canvas.width = size.w;
    canvas.height = size.h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    if (tile.background === "checker") drawChecker(ctx, size.w, size.h);
    else {
      ctx.fillStyle = tile.background === "light" ? "#e6e6e6" : "#141414";
      ctx.fillRect(0, 0, size.w, size.h);
    }

    const dw = tile.width * scale;
    const dh = tile.height * scale;
    if (preview === "tile") {
      ctx.drawImage(tc, origin.x, origin.y, dw, dh);
      ctx.strokeStyle = "#e5b83b";
      ctx.lineWidth = 1;
      ctx.strokeRect(origin.x, origin.y, dw, dh);
    } else if (preview === "repeat3") {
      for (let row = -1; row <= 1; row++) for (let col = -1; col <= 1; col++) {
        let x = origin.x + col * dw;
        let y = origin.y + row * dh;
        let flipX = false;
        let flipY = false;
        if (tile.repeat === "brick" && Math.abs(row % 2) === 1) x += dw / 2;
        if (tile.repeat === "half-drop" && Math.abs(col % 2) === 1) y += dh / 2;
        if (tile.repeat === "mirror") {
          flipX = Math.abs(col % 2) === 1;
          flipY = Math.abs(row % 2) === 1;
        }
        ctx.save();
        ctx.globalAlpha = row === 0 && col === 0 ? 1 : 0.22;
        if (showOutline || row === 0 && col === 0) {
          ctx.strokeStyle = row === 0 && col === 0 ? "#e5b83b" : "rgba(229,184,59,0.6)";
          ctx.lineWidth = 1;
          ctx.strokeRect(x, y, dw, dh);
        }
        ctx.translate(x + (flipX ? dw : 0), y + (flipY ? dh : 0));
        ctx.scale(flipX ? -1 : 1, flipY ? -1 : 1);
        ctx.drawImage(tc, 0, 0, dw, dh);
        ctx.restore();
      }
    } else {
      drawPreview(ctx, tc, tile, tile.repeat, size.w, size.h, scale, origin.x, origin.y);
      ctx.strokeStyle = "#e5b83b";
      ctx.lineWidth = 1;
      ctx.strokeRect(origin.x, origin.y, dw, dh);
      if (showOutline) {
        ctx.strokeStyle = "rgba(229,184,59,0.35)";
        ctx.lineWidth = 1;
        for (let x = origin.x % dw; x < size.w; x += dw) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, size.h); ctx.stroke(); }
        for (let y = origin.y % dh; y < size.h; y += dh) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(size.w, y); ctx.stroke(); }
      }
    }

    const selected = activeItems.find((item) => item.id === selectedId);
    if (selected) {
      const image = assets.find((asset) => asset.id === selected.assetId);
      const loaded = image && loadImage(image.src, onImageLoad);
      const aspect = loaded?.naturalWidth ? loaded.naturalHeight / loaded.naturalWidth : 1;
      const centerX = wrap(selected.x, tile.width);
      const centerY = wrap(selected.y, tile.height);
      const angle = selected.rotation * Math.PI / 180;
      const halfWidth = (Math.abs(Math.cos(angle)) * selected.size * selected.scale + Math.abs(Math.sin(angle)) * selected.size * selected.scale * aspect) / 2;
      const halfHeight = (Math.abs(Math.sin(angle)) * selected.size * selected.scale + Math.abs(Math.cos(angle)) * selected.size * selected.scale * aspect) / 2;
      const left = Math.ceil((-halfWidth - centerX) / tile.width);
      const right = Math.floor((tile.width + halfWidth - centerX) / tile.width);
      const top = Math.ceil((-halfHeight - centerY) / tile.height);
      const bottom = Math.floor((tile.height + halfHeight - centerY) / tile.height);
      ctx.save();
      ctx.beginPath();
      ctx.rect(origin.x, origin.y, tile.width * scale, tile.height * scale);
      ctx.clip();
      ctx.strokeStyle = "#e5b83b";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 3]);
      for (let cy = top; cy <= bottom; cy++) for (let cx = left; cx <= right; cx++) {
        const px = origin.x + (centerX + cx * tile.width) * scale;
        const py = origin.y + (centerY + cy * tile.height) * scale;
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(angle);
        ctx.strokeRect(-selected.size * selected.scale * scale / 2, -selected.size * selected.scale * aspect * scale / 2, selected.size * selected.scale * scale, selected.size * selected.scale * aspect * scale);
        ctx.restore();
      }
      ctx.restore();
    }
  }, [size, tile, activeItems, assets, selectedId, preview, scale, origin.x, origin.y, showOutline, tick, onImageLoad]);

  function toTileCoords(clientX: number, clientY: number) {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0, inside: false };
    const x = (clientX - rect.left - origin.x) / scale;
    const y = (clientY - rect.top - origin.y) / scale;
    return { x, y, inside: x >= 0 && x <= tile.width && y >= 0 && y <= tile.height };
  }

  function hitItem(x: number, y: number): PatternItem | null {
    for (let i = items.length - 1; i >= 0; i--) {
      const item = items[i];
      const asset = assets.find((candidate) => candidate.id === item.assetId);
      const image = asset && loadImage(asset.src, onImageLoad);
      const aspect = image?.naturalWidth ? image.naturalHeight / image.naturalWidth : 1;
      const { halfWidth, halfHeight } = itemBounds(item, aspect);
      const centerX = wrap(item.x, tile.width);
      const centerY = wrap(item.y, tile.height);
      const xCopies = copyRange(centerX, halfWidth, tile.width);
      const yCopies = copyRange(centerY, halfHeight, tile.height);
      const angle = -item.rotation * Math.PI / 180;
      for (let copyX = xCopies.first; copyX <= xCopies.last; copyX++) for (let copyY = yCopies.first; copyY <= yCopies.last; copyY++) {
        const dx = x - (centerX + copyX * tile.width);
        const dy = y - (centerY + copyY * tile.height);
        const localX = dx * Math.cos(angle) - dy * Math.sin(angle);
        const localY = dx * Math.sin(angle) + dy * Math.cos(angle);
        if (Math.abs(localX) <= item.size * item.scale / 2 && Math.abs(localY) <= item.size * item.scale * aspect / 2) return item;
      }
    }
    return null;
  }

  function beginPan(e: React.PointerEvent<HTMLCanvasElement>) {
    dragRef.current = { kind: "pan", pointerId: e.pointerId, items, tile, sx: e.clientX, sy: e.clientY, panX: pan.x, panY: pan.y };
  }

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (dragRef.current) return;
    e.currentTarget.focus();
    e.currentTarget.setPointerCapture(e.pointerId);
    const { x, y, inside } = toTileCoords(e.clientX, e.clientY);
    if (spaceRef.current || e.button === 1) { beginPan(e); return; }
    const hit = inside ? hitItem(x, y) : null;
    if (hit) {
      props.onSelect(hit.id);
      const cx = wrap(hit.x, tile.width);
      const cy = wrap(hit.y, tile.height);
      dragRef.current = { kind: "item", id: hit.id, pointerId: e.pointerId, items, tile, dx: x - cx, dy: y - cy, startX: hit.x, startY: hit.y, x: hit.x, y: hit.y };
      return;
    }
    props.onSelect(null);
    beginPan(e);
  }

  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    if (drag.kind === "item") {
      const point = toTileCoords(e.clientX, e.clientY);
      drag.x = wrap(point.x - drag.dx, tile.width);
      drag.y = wrap(point.y - drag.dy, tile.height);
      setDraft({ id: drag.id, x: drag.x, y: drag.y });
    } else props.onViewChange(zoom, { x: drag.panX + e.clientX - drag.sx, y: drag.panY + e.clientY - drag.sy });
  }

  function cancelDrag() {
    const drag = dragRef.current;
    dragRef.current = null;
    const canvas = canvasRef.current;
    if (canvas && drag && canvas.hasPointerCapture(drag.pointerId)) canvas.releasePointerCapture(drag.pointerId);
    if (drag?.kind === "item") setDraft(null);
  }

  function finishPointer(e: React.PointerEvent<HTMLCanvasElement>, commit: boolean) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    dragRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (drag.kind === "item") {
      const dx = Math.abs(drag.x - wrap(drag.startX, tile.width));
      const dy = Math.abs(drag.y - wrap(drag.startY, tile.height));
      const changed = Math.min(dx, tile.width - dx) > 0.001 || Math.min(dy, tile.height - dy) > 0.001;
      if (commit && changed) props.onMoveItem(drag.id, drag.x, drag.y);
      setDraft(null);
    }
  }

  function resetView() {
    props.onViewChange(clampZoom(1), { x: 0, y: 0 });
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLCanvasElement>) {
    if (e.key === " ") { spaceRef.current = true; e.preventDefault(); return; }
    if (e.key === "Escape") {
      cancelDrag();
      props.onSelect(null);
      return;
    }
    if (e.key === "Home") { e.preventDefault(); resetView(); return; }
    if (e.key === "+" || e.key === "=") { e.preventDefault(); props.onViewChange(clampZoom(zoom * 1.1), pan); return; }
    if (e.key === "-") { e.preventDefault(); props.onViewChange(clampZoom(zoom / 1.1), pan); return; }
    const delta = e.shiftKey ? 10 : 1;
    const moves: Record<string, [number, number]> = { ArrowLeft: [-delta, 0], ArrowRight: [delta, 0], ArrowUp: [0, -delta], ArrowDown: [0, delta] };
    const move = moves[e.key];
    if (!move) return;
    e.preventDefault();
    if (e.altKey || !selectedId) props.onViewChange(zoom, { x: pan.x + move[0] * 12, y: pan.y + move[1] * 12 });
    else {
      const item = items.find((candidate) => candidate.id === selectedId);
      if (item) props.onMoveItem(item.id, wrap(item.x + move[0], tile.width), wrap(item.y + move[1], tile.height));
    }
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      props.onViewChange(clampZoom(zoom * Math.exp(-event.deltaY * 0.001)), pan);
    };
    canvas.addEventListener("wheel", handleWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", handleWheel);
  }, [zoom, pan, props.onViewChange]);

  function discardCache() {
    if (tileCanvas.current) { tileCanvas.current.width = 0; tileCanvas.current.height = 0; }
    tileCanvas.current = null;
    clearImageCache();
    setRetryVersion((version) => version + 1);
    setTick((n) => n + 1);
  }

  return (
    <div ref={containerRef} className="relative h-full w-full overflow-hidden bg-background">
      <canvas ref={canvasRef} className="block h-full w-full cursor-grab active:cursor-grabbing focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold focus-visible:outline-offset-[-3px]" aria-label="Tile aktif" tabIndex={0} aria-describedby="canvas-instructions" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={(e) => finishPointer(e, true)} onPointerCancel={(e) => finishPointer(e, false)} onLostPointerCapture={cancelDrag} onKeyDown={onKeyDown} onKeyUp={(e) => { if (e.key === " ") spaceRef.current = false; }} onBlur={() => { spaceRef.current = false; }} />
      <span id="canvas-instructions" className="sr-only">Panah memindah pilihan, Alt dan panah menggeser tampilan, Shift dan panah memindah 10 piksel, plus atau minus mengubah zoom, Home reset tampilan, Escape membatalkan drag atau pilihan, Space dan drag menggeser tampilan.</span>
      <div className="pointer-events-none absolute bottom-3 left-3 max-w-[90%] whitespace-normal rounded-md border border-border bg-card px-2 py-1 text-[11px] text-muted-foreground">{preview === "tile" ? "Tile aktif: drag untuk memindah, kosong untuk pan" : "Preview: drag untuk pan, scroll untuk zoom, item dapat dipilih hanya pada tile aktif"}</div>
      <div className="absolute right-3 top-3 flex max-w-[90%] flex-wrap items-start gap-2">
        <div className="rounded-md border border-border bg-card px-2 py-1 text-[11px] text-muted-foreground">Tile {tile.width} × {tile.height} px · {tile.repeat} · zoom {Math.round(zoom * 100)}%</div>
        <button type="button" className="rounded border border-border bg-card px-2 py-1 text-[11px] text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold" onClick={discardCache}>Buang cache preview</button>
      </div>
      {loadErrors.length > 0 && <div role="alert" className="absolute left-3 right-3 top-16 rounded border border-border bg-card p-3 text-foreground">Gagal memuat aset: {loadErrors.join(", ")}. Cache preview dapat dibuang untuk mencoba ulang.<button type="button" className="ml-2 underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold" onClick={discardCache}>Coba lagi</button></div>}
    </div>
  );
}

export type { BackgroundMode };
