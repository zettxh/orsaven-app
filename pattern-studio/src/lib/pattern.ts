import { loadImage } from "./assets";
import type { Asset, PatternItem, RepeatMode, TileSettings } from "./types";
import { wrap } from "./types";
export interface CopyRange {
  first: number;
  last: number;
}

export function itemBounds(item: PatternItem, aspect: number) {
  const objectWidth = item.size * item.scale;
  const objectHeight = objectWidth * aspect;
  const angle = (item.rotation * Math.PI) / 180;
  const sin = Math.abs(Math.sin(angle));
  const cos = Math.abs(Math.cos(angle));
  return {
    halfWidth: (cos * objectWidth + sin * objectHeight) / 2,
    halfHeight: (sin * objectWidth + cos * objectHeight) / 2,
  };
}

export function copyRange(position: number, halfExtent: number, tileExtent: number): CopyRange {
  return {
    first: Math.ceil((-halfExtent - position) / tileExtent),
    last: Math.floor((tileExtent + halfExtent - position) / tileExtent),
  };
}

/**
 * Render one clipped tile, drawing enough wrapped copies to cover each item's
 * rotated bounds. Preview and file exports use the same geometry.
 */

export function drawTile(
  ctx: CanvasRenderingContext2D,
  tile: TileSettings,
  items: PatternItem[],
  assets: Asset[],
  onImageLoad: () => void,
): void {
  const { width, height } = tile;
  ctx.clearRect(0, 0, width, height);
  if (tile.backgroundColor) {
    ctx.fillStyle = tile.backgroundColor;
    ctx.fillRect(0, 0, width, height);
  }
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, width, height);
  ctx.clip();

  const byId = new Map(assets.map((a) => [a.id, a]));
  for (const item of items) {
    const asset = byId.get(item.assetId);
    if (!asset) continue;
    const img = loadImage(asset.src, onImageLoad);
    if (!img.complete || img.naturalWidth === 0) continue;
    const size = item.size * item.scale;
    // Rasio aspek gambar dipertahankan; size = lebar.
    const drawW = size;
    const drawH = size * (img.naturalHeight / img.naturalWidth);
    const centerX = wrap(item.x, width);
    const centerY = wrap(item.y, height);
    const { halfWidth, halfHeight } = itemBounds(item, img.naturalHeight / img.naturalWidth);
    const xRange = copyRange(centerX, halfWidth, width);
    const yRange = copyRange(centerY, halfHeight, height);
    for (let copyX = xRange.first; copyX <= xRange.last; copyX++) {
      for (let copyY = yRange.first; copyY <= yRange.last; copyY++) {
        ctx.save();
        ctx.globalAlpha = item.opacity;
        ctx.translate(centerX + copyX * width, centerY + copyY * height);
        ctx.rotate((item.rotation * Math.PI) / 180);
        ctx.scale(item.flipX ? -1 : 1, item.flipY ? -1 : 1);
        ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
        ctx.restore();
      }
    }
  }
  ctx.restore();
}

/** Render satu tile ke canvas baru, dipakai untuk preview dan export. */
export function renderTileCanvas(
  tile: TileSettings,
  items: PatternItem[],
  assets: Asset[],
  scale: number,
  onImageLoad: () => void,
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(tile.width * scale));
  canvas.height = Math.max(1, Math.round(tile.height * scale));
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.scale(scale, scale);
    drawTile(ctx, tile, items, assets, onImageLoad);
  }
  return canvas;
}

/**
 * Gambar satu tile (sudah di-cache) berulang ke canvas preview,
 * sesuai mode repeat. Offset brick/half-drop tetap seamless karena
 * tile itu sendiri sudah seamless di semua sisinya.
 */
export function drawPreview(
  ctx: CanvasRenderingContext2D,
  tileCanvas: HTMLCanvasElement,
  tile: TileSettings,
  repeat: RepeatMode,
  viewWidth: number,
  viewHeight: number,
  zoom: number,
  panX: number,
  panY: number,
): void {
  const dw = tile.width * zoom;
  const dh = tile.height * zoom;
  if (dw <= 0 || dh <= 0) return;

  // Hitung rentang kolom/baris yang menutupi viewport (+1 margin).
  const colStart = Math.floor((-panX) / dw) - 1;
  const colEnd = Math.ceil((viewWidth - panX) / dw) + 1;
  const rowStart = Math.floor((-panY) / dh) - 1;
  const rowEnd = Math.ceil((viewHeight - panY) / dh) + 1;

  for (let row = rowStart; row <= rowEnd; row++) {
    for (let col = colStart; col <= colEnd; col++) {
      let x = panX + col * dw;
      let y = panY + row * dh;
      let flipX = false;
      let flipY = false;
      if (repeat === "brick" && Math.abs(row % 2) === 1) x += dw / 2;
      if (repeat === "half-drop" && Math.abs(col % 2) === 1) y += dh / 2;
      if (repeat === "mirror") {
        flipX = Math.abs(col % 2) === 1;
        flipY = Math.abs(row % 2) === 1;
      }
      ctx.save();
      ctx.globalAlpha = row === 0 && col === 0 ? 1 : 0.22;
      ctx.translate(x + (flipX ? dw : 0), y + (flipY ? dh : 0));
      ctx.scale(flipX ? -1 : 1, flipY ? -1 : 1);
      ctx.drawImage(tileCanvas, 0, 0, dw, dh);
      ctx.restore();
    }
  }
}

/** Gambar background checkerboard untuk area transparan. */
export function drawChecker(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  cell = 16,
): void {
  ctx.fillStyle = "#1c1c1c";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#2a2a2a";
  for (let y = 0; y < height; y += cell) {
    for (let x = 0; x < width; x += cell) {
      if ((x / cell + y / cell) % 2 === 0) ctx.fillRect(x, y, cell, cell);
    }
  }
}
