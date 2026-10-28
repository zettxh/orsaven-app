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
const MAX_CACHED_IMAGES = 64;
const loadCallbacks = new Map<string, Set<() => void>>();
const errorCallbacks = new Map<string, Set<(error: Error) => void>>();


function pruneImageCache() {
  let pixels = 0;
  for (const image of imageCache.values()) if (image.complete && image.naturalWidth) pixels += image.naturalWidth * image.naturalHeight;
  while (pixels > MAX_CACHED_IMAGE_PIXELS || imageCache.size > MAX_CACHED_IMAGES) {
    let entry: [string, HTMLImageElement] | undefined;
    for (const candidate of imageCache) {
      if (candidate[1].complete || imageCache.size > MAX_CACHED_IMAGES) {
        entry = candidate;
        break;
      }
    }
    if (!entry) break;
    const [src, image] = entry;
    const pixelsFreed = image.naturalWidth * image.naturalHeight;
    if (pixelsFreed) pixels -= pixelsFreed;
    imageCache.delete(src);
    loadCallbacks.delete(src);
    const callbacks = errorCallbacks.get(src);
    errorCallbacks.delete(src);
    if (!image.complete) {
      image.onload = null;
      image.onerror = null;
      image.src = "";
      callbacks?.forEach((callback) => callback(new Error("Image cache capacity exceeded")));
    }
  }
}

export function clearImageCache(): void {
  for (const image of imageCache.values()) {
    image.onload = null;
    image.onerror = null;
    image.src = "";
  }
  imageCache.clear();
  loadCallbacks.clear();
  errorCallbacks.clear();
}


export function removeImageCallbacks(src: string, onLoad: () => void, onError?: (error: Error) => void): void {
  const loads = loadCallbacks.get(src);
  loads?.delete(onLoad);
  if (!loads?.size) loadCallbacks.delete(src);
  if (onError) {
    const errors = errorCallbacks.get(src);
    errors?.delete(onError);
    if (!errors?.size) errorCallbacks.delete(src);
  }
}

export function loadImage(src: string, onLoad: () => void, onError?: (error: Error) => void): HTMLImageElement {
  const cached = imageCache.get(src);
  if (cached) {
    imageCache.delete(src);
    imageCache.set(src, cached);
    if (!cached.complete) {
      const loads = loadCallbacks.get(src) ?? new Set<() => void>();
      loads.add(onLoad);
      loadCallbacks.set(src, loads);
      if (onError) {
        const errors = errorCallbacks.get(src) ?? new Set<(error: Error) => void>();
        errors.add(onError);
        errorCallbacks.set(src, errors);
      }
    } else if (!cached.naturalWidth) onError?.(new Error("Image failed to load"));
    return cached;
  }

  const img = new Image();
  loadCallbacks.set(src, new Set([onLoad]));
  if (onError) errorCallbacks.set(src, new Set([onError]));
  imageCache.set(src, img);
  img.onload = () => {
    const callbacks = loadCallbacks.get(src);
    loadCallbacks.delete(src);
    errorCallbacks.delete(src);
    pruneImageCache();
    callbacks?.forEach((callback) => callback());
  };
  img.onerror = () => {
    const error = new Error(`Unable to load image: ${src}`);
    loadCallbacks.delete(src);
    const callbacks = errorCallbacks.get(src);
    errorCallbacks.delete(src);
    callbacks?.forEach((callback) => callback(error));
    pruneImageCache();
  };
  img.src = src;
  pruneImageCache();
  return img;
}

