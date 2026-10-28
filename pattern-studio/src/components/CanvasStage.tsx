import { useEffect, useRef, useState } from "react";
import type { Asset, BackgroundMode, PatternItem, PreviewMode, TileSettings } from "../lib/types";
import { wrap } from "../lib/types";
import { drawChecker, drawPreview, renderTileCanvas } from "../lib/pattern";

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

export default function CanvasStage(props: Props) {
  const { tile, items, assets, selectedId, preview, zoom, pan, showOutline } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [tick, setTick] = useState(0);
  const dragRef = useRef<
    | { kind: "item"; id: string; dx: number; dy: number }
    | { kind: "pan"; sx: number; sy: number; panX: number; panY: number }
    | null
  >(null);

  // Tile cache: render ulang hanya saat tile/items/assets berubah,
  // atau saat ada gambar yang baru selesai load (tick).
  const tileCanvas = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    tileCanvas.current = renderTileCanvas(tile, items, assets, 1, () => setTick((t) => t + 1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tile, items, assets, tick]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setSize({ w: Math.max(100, r.width), h: Math.max(100, r.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !tileCanvas.current) return;
    canvas.width = size.w;
    canvas.height = size.h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    if (tile.background === "checker") {
      drawChecker(ctx, size.w, size.h);
    } else if (tile.background === "light") {
      ctx.fillStyle = "#e6e6e6";
      ctx.fillRect(0, 0, size.w, size.h);
    } else {
      ctx.fillStyle = "#141414";
      ctx.fillRect(0, 0, size.w, size.h);
    }

    const tc = tileCanvas.current;
    if (preview === "tile") {
      const fit = Math.min(size.w / tile.width, size.h / tile.height) * 0.85;
      const eff = fit * zoom;
      const dw = tile.width * eff;
      const dh = tile.height * eff;
      const ox = (size.w - dw) / 2;
      const oy = (size.h - dh) / 2;
      ctx.drawImage(tc, ox, oy, dw, dh);
      if (showOutline) {
        ctx.strokeStyle = "#e5b83b";
        ctx.lineWidth = 1;
        ctx.strokeRect(ox, oy, dw, dh);
      }
      if (selectedId) {
        const item = items.find((i) => i.id === selectedId);
        if (item) {
          ctx.strokeStyle = "#e5b83b";
          ctx.setLineDash([6, 4]);
          const s = item.size * item.scale * eff;
          ctx.strokeRect(ox + wrap(item.x, tile.width) * eff - s / 2, oy + wrap(item.y, tile.height) * eff - s / 2, s, s);
          ctx.setLineDash([]);
        }
      }
    } else if (preview === "repeat3") {
      // 3x3 tile di tengah, dengan offset repeat yang sama seperti fill.
      const eff = zoom;
      const dw = tile.width * eff;
      const dh = tile.height * eff;
      const cx = size.w / 2;
      const cy = size.h / 2;
      for (let row = -1; row <= 1; row++) {
        for (let col = -1; col <= 1; col++) {
          let x = cx + col * dw - dw / 2;
          let y = cy + row * dh - dh / 2;
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
          if (showOutline) {
            ctx.strokeStyle = "rgba(229,184,59,0.6)";
            ctx.strokeRect(x, y, dw, dh);
          }
          ctx.translate(x + (flipX ? dw : 0), y + (flipY ? dh : 0));
          ctx.scale(flipX ? -1 : 1, flipY ? -1 : 1);
          ctx.drawImage(tc, 0, 0, dw, dh);
          ctx.restore();
        }
      }
    } else {
      drawPreview(ctx, tc, tile, tile.repeat, size.w, size.h, zoom, pan.x, pan.y);
      if (showOutline) {
        ctx.strokeStyle = "rgba(229,184,59,0.35)";
        ctx.lineWidth = 1;
        const dw = tile.width * zoom;
        const dh = tile.height * zoom;
        for (let x = pan.x % dw; x < size.w; x += dw) {
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, size.h);
          ctx.stroke();
        }
        for (let y = pan.y % dh; y < size.h; y += dh) {
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(size.w, y);
          ctx.stroke();
        }
      }
    }
  }, [size, tile, items, assets, selectedId, preview, zoom, pan, showOutline, tick]);

  function toTileCoords(clientX: number, clientY: number): { x: number; y: number; inside: boolean } {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0, inside: false };
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;
    if (preview === "tile") {
      const fit = Math.min(size.w / tile.width, size.h / tile.height) * 0.85;
      const eff = fit * zoom;
      const ox = (size.w - tile.width * eff) / 2;
      const oy = (size.h - tile.height * eff) / 2;
      const x = (sx - ox) / eff;
      const y = (sy - oy) / eff;
      return { x, y, inside: x >= 0 && x <= tile.width && y >= 0 && y <= tile.height };
    }
    if (preview === "repeat3") {
      const eff = zoom;
      const x = (sx - (size.w - tile.width * eff) / 2) / eff;
      const y = (sy - (size.h - tile.height * eff) / 2) / eff;
      return { x, y, inside: x >= 0 && x <= tile.width && y >= 0 && y <= tile.height };
    }
    const x = (sx - pan.x) / zoom;
    const y = (sy - pan.y) / zoom;
    return { x, y, inside: x >= 0 && x <= tile.width && y >= 0 && y <= tile.height };
  }

  function hitItem(x: number, y: number): PatternItem | null {
    for (let i = items.length - 1; i >= 0; i--) {
      const item = items[i];
      const half = (item.size * item.scale) / 2;
      if (Math.abs(x - wrap(item.x, tile.width)) <= half && Math.abs(y - wrap(item.y, tile.height)) <= half) {
        return item;
      }
    }
    return null;
  }

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
    const { x, y, inside } = toTileCoords(e.clientX, e.clientY);
    if (!inside) {
      props.onSelect(null);
      if (preview === "fill") dragRef.current = { kind: "pan", sx: e.clientX, sy: e.clientY, panX: pan.x, panY: pan.y };
      return;
    }
    const hit = hitItem(x, y);
    if (hit) {
      props.onSelect(hit.id);
      dragRef.current = { kind: "item", id: hit.id, dx: x - wrap(hit.x, tile.width), dy: y - wrap(hit.y, tile.height) };
    } else {
      props.onSelect(null);
      dragRef.current = { kind: "pan", sx: e.clientX, sy: e.clientY, panX: pan.x, panY: pan.y };
    }
  }

  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    if (drag.kind === "item") {
      const { x, y } = toTileCoords(e.clientX, e.clientY);
      props.onMoveItem(drag.id, wrap(x - drag.dx, tile.width), wrap(y - drag.dy, tile.height));
    } else {
      props.onViewChange(zoom, {
        x: drag.panX + (e.clientX - drag.sx),
        y: drag.panY + (e.clientY - drag.sy),
      });
    }
  }

  function onPointerUp() {
    dragRef.current = null;
  }

  function onWheel(e: React.WheelEvent<HTMLCanvasElement>) {
    // Zoom ke arah kursor secara kasar: cukup ubah zoom, pan dipertahankan.
    const next = Math.min(3, Math.max(0.1, zoom * Math.exp(-e.deltaY * 0.001)));
    props.onViewChange(next, pan);
  }

  return (
    <div ref={containerRef} className="relative h-full w-full overflow-hidden bg-background">
      <canvas
        ref={canvasRef}
        className="block h-full w-full cursor-grab active:cursor-grabbing"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onWheel={onWheel}
      />
      <div className="pointer-events-none absolute bottom-3 left-3 rounded-md border border-border bg-card px-2 py-1 text-[11px] text-muted-foreground">
        {preview === "tile"
          ? "Mode tile: drag item untuk memindah, klik kosong untuk melepas seleksi"
          : "Mode preview: drag kosong untuk pan, scroll untuk zoom, klik item untuk memilih"}
      </div>
      <div className="pointer-events-none absolute right-3 top-3 rounded-md border border-border bg-card px-2 py-1 text-[11px] text-muted-foreground">
        Tile {tile.width} x {tile.height} px · {tile.repeat} · zoom {Math.round(zoom * 100)}%
      </div>
    </div>
  );
}

export type { BackgroundMode };
