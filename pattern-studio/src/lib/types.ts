export type RepeatMode = "grid" | "brick" | "half-drop" | "mirror";
export type PreviewMode = "tile" | "repeat3" | "fill";
export type BackgroundMode = "dark" | "checker" | "light";

export interface Asset {
  id: string;
  name: string;
  src: string;
  builtin?: boolean;
  originalSvg?: string;
  fabricSvg?: string;
}

export interface PatternItem {
  id: string;
  assetId: string;
  /** Posisi pusat item di dalam tile, dalam px. Selalu di-wrap ke [0, tile). */
  x: number;
  y: number;
  /** Ukuran dasar item (lebar) dalam px, sebelum scale. */
  size: number;
  rotation: number; // derajat
  scale: number; // 1 = 100%
  opacity: number; // 0..1
  flipX: boolean;
  flipY: boolean;
}

export interface TileSettings {
  width: number;
  height: number;
  repeat: RepeatMode;
  background: BackgroundMode;
  /** Warna background tile saat bukan transparan; kosong = transparan. */
  backgroundColor: string;
}

export interface Project {
  name: string;
  tile: TileSettings;
  items: PatternItem[];
  assets: Asset[];
}

export const DEFAULT_TILE: TileSettings = {
  width: 512,
  height: 512,
  repeat: "grid",
  background: "checker",
  backgroundColor: "",
};

export function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function wrap(value: number, max: number): number {
  return ((value % max) + max) % max;
}
