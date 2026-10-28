import type { Asset } from "./types";

function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/**
 * Aset contoh bawaan, digambar sebagai SVG transparan. Ini hanya contoh
 * supaya starter bisa langsung dicoba tanpa import file. Ganti/hapus
 * sesuka hati; aset user yang diimport selalu lebih diutamakan.
 */
export function builtinAssets(): Asset[] {
  const star = (fill: string) =>
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path fill="${fill}" d="M50 4 L61 36 L96 36 L68 57 L78 90 L50 70 L22 90 L32 57 L4 36 L39 36 Z"/></svg>`;
  const leaf = (fill: string) =>
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path fill="${fill}" d="M50 4 C84 26 88 66 50 96 C12 66 16 26 50 4 Z"/><path stroke="#141414" stroke-width="4" fill="none" d="M50 12 L50 88"/></svg>`;
  const ring = (fill: string) =>
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="36" fill="none" stroke="${fill}" stroke-width="14"/><circle cx="50" cy="50" r="10" fill="${fill}"/></svg>`;
  const diamond = (fill: string) =>
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path fill="${fill}" d="M50 4 L88 50 L50 96 L12 50 Z"/><circle cx="50" cy="50" r="14" fill="#141414"/></svg>`;
  const flower = (fill: string) =>
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><g fill="${fill}">${[0, 60, 120, 180, 240, 300]
      .map((a) => `<ellipse cx="50" cy="24" rx="14" ry="22" transform="rotate(${a} 50 50)"/>`)
      .join("")}</g><circle cx="50" cy="50" r="13" fill="#e5b83b"/></svg>`;

  return [
    { id: "builtin-star", name: "Bintang", src: svgDataUrl(star("#e6e6e6")), builtin: true },
    { id: "builtin-leaf", name: "Daun", src: svgDataUrl(leaf("#7fb069")), builtin: true },
    { id: "builtin-ring", name: "Cincin", src: svgDataUrl(ring("#e5b83b")), builtin: true },
    { id: "builtin-diamond", name: "Berlian", src: svgDataUrl(diamond("#8d8d8d")), builtin: true },
    { id: "builtin-flower", name: "Bunga", src: svgDataUrl(flower("#d96c6c")), builtin: true },
  ];
}

const MAX_CACHED_IMAGE_PIXELS = 16_000_000;
const imageCache = new Map<string, HTMLImageElement>();

function pruneImageCache() {
  let pixels = 0;
  for (const image of imageCache.values()) if (image.complete && image.naturalWidth) pixels += image.naturalWidth * image.naturalHeight;
  while (pixels > MAX_CACHED_IMAGE_PIXELS) {
    let removed = false;
    for (const [src, image] of imageCache) {
      if (!image.complete || !image.naturalWidth) continue;
      pixels -= image.naturalWidth * image.naturalHeight;
      imageCache.delete(src);
      removed = true;
      break;
    }
    if (!removed) break;
  }
}

export function loadImage(src: string, onLoad: () => void): HTMLImageElement {
  const cached = imageCache.get(src);
  if (cached) {
    imageCache.delete(src);
    imageCache.set(src, cached);
    return cached;
  }
  const img = new Image();
  img.onload = () => {
    pruneImageCache();
    onLoad();
  };
  img.onerror = () => imageCache.delete(src);
  img.src = src;
  imageCache.set(src, img);
  return img;
}
