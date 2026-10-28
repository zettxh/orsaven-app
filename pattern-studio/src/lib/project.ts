import { assertAssetPixelBudget, assertRasterBudget } from "./proofExport";
import { svgDataUrl, validateSvg } from "./svg";
import type { Asset, PatternItem, Project, TileSettings } from "./types";

export const MAX_PROJECT_BYTES = 16_000_000;
const MAX_ASSETS = 64;
const MAX_ITEMS = 256;
const MAX_NAME = 256;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const ITEM_KEYS = ["id", "assetId", "x", "y", "size", "rotation", "scale", "opacity", "flipX", "flipY"];
const TILE_KEYS = ["width", "height", "repeat", "background", "backgroundColor"];
const PROJECT_KEYS = ["name", "tile", "items", "assets"];

export type PortableAsset = { id: string; name: string; originalSvg: string };
export type PortableProject = { name: string; tile: TileSettings; items: PatternItem[]; assets: PortableAsset[] };

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: string[], label: string) {
  if (Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))) throw new Error(`${label} contains missing or unsupported fields`);
}

function name(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim() || value.length > MAX_NAME) throw new Error(`${label} must be a non-empty string of at most ${MAX_NAME} characters`);
  return value;
}

function id(value: unknown, label: string) {
  if (typeof value !== "string" || !ID_PATTERN.test(value) || value === "." || value === "..") throw new Error(`${label} must be a simple safe identifier`);
  return value;
}

function finite(value: unknown, label: string, min: number, max: number) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) throw new Error(`${label} is outside supported limits`);
  return value;
}

function validateTile(value: unknown): TileSettings {
  const tile = record(value, "Project tile");
  exactKeys(tile, TILE_KEYS, "Project tile");
  const width = finite(tile.width, "Tile width", 64, 4096);
  const height = finite(tile.height, "Tile height", 64, 4096);
  if (typeof tile.backgroundColor !== "string" || (tile.backgroundColor !== "" && !/^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(tile.backgroundColor))) throw new Error("Project background color must be empty or a safe hex color");
  if (!["grid", "brick", "half-drop", "mirror"].includes(String(tile.repeat))) throw new Error("Project repeat mode is invalid");
  if (!["dark", "checker", "light"].includes(String(tile.background))) throw new Error("Project background mode is invalid");
  return tile as unknown as TileSettings;
}

function validateItems(value: unknown, assetIds: Set<string>): PatternItem[] {
  if (!Array.isArray(value) || value.length > MAX_ITEMS) throw new Error("Project exceeds 256 item limit");
  const ids = new Set<string>();
  return value.map((entry) => {
    const item = record(entry, "Project item");
    exactKeys(item, ITEM_KEYS, "Project item");
    const itemId = id(item.id, "Item ID");
    if (ids.has(itemId)) throw new Error("Project item IDs must be unique");
    ids.add(itemId);
    const assetId = id(item.assetId, "Item asset ID");
    if (!assetIds.has(assetId)) throw new Error("An item references a missing asset");
    for (const [key, min, max] of [["x", -8192, 8192], ["y", -8192, 8192], ["size", 1, 4096], ["rotation", -360000, 360000], ["scale", 0.01, 100], ["opacity", 0, 1]] as const) finite(item[key], `Item ${key}`, min, max);
    if (typeof item.flipX !== "boolean" || typeof item.flipY !== "boolean") throw new Error("Project item flips must be booleans");
    return item as unknown as PatternItem;
  });
}

function validateAssets(value: unknown): PortableAsset[] {
  if (!Array.isArray(value) || value.length > MAX_ASSETS) throw new Error("Project exceeds 64 asset limit");
  const ids = new Set<string>();
  return value.map((entry) => {
    const asset = record(entry, "Project asset");
    exactKeys(asset, ["id", "name", "originalSvg"], "Project asset");
    const assetId = id(asset.id, "Asset ID");
    if (ids.has(assetId)) throw new Error("Project asset IDs must be unique");
    ids.add(assetId);
    const originalSvg = asset.originalSvg;
    if (typeof originalSvg !== "string") throw new Error("Project asset source must be SVG text");
    validateSvg(originalSvg);
    return { id: assetId, name: name(asset.name, "Asset name"), originalSvg };
  });
}

function validateProject(value: unknown): PortableProject {
  const project = record(value, "Project document");
  exactKeys(project, PROJECT_KEYS, "Project document");
  const assets = validateAssets(project.assets);
  const assetIds = new Set(assets.map((asset) => asset.id));
  const portable: PortableProject = {
    name: name(project.name, "Project name"),
    tile: validateTile(project.tile),
    items: validateItems(project.items, assetIds),
    assets,
  };
  const hydrated: Asset[] = assets.map((asset) => ({ ...asset, src: svgDataUrl(validateSvg(asset.originalSvg)) }));
  assertAssetPixelBudget(hydrated);
  assertRasterBudget(portable.tile, portable.items, hydrated);
  return portable;
}

function sourceFor(asset: Asset): string {
  if (typeof asset.originalSvg === "string" && asset.originalSvg) return asset.originalSvg;
  if (!asset.builtin || !asset.src.startsWith("data:image/svg+xml")) throw new Error(`${asset.name}: portable SVG source is unavailable`);
  const comma = asset.src.indexOf(",");
  if (comma < 0 || asset.src.length > 400_000) throw new Error(`${asset.name}: portable SVG source is invalid`);
  const payload = asset.src.slice(comma + 1);
  try {
    return asset.src.slice(0, comma).includes(";base64") ? atob(payload) : decodeURIComponent(payload);
  } catch {
    throw new Error(`${asset.name}: portable SVG source is invalid`);
  }
}

export function encodeProject(project: Project): string {
  const assets = project.assets.map(({ id: assetId, name: assetName, ...asset }) => ({
    id: assetId,
    name: assetName,
    originalSvg: sourceFor({ id: assetId, name: assetName, ...asset }),
  }));
  const document = { name: project.name, tile: project.tile, items: project.items, assets };
  const text = JSON.stringify({ format: "orsaven", version: 1, document });
  if (new TextEncoder().encode(text).byteLength > MAX_PROJECT_BYTES) throw new Error("Project exceeds 16 MB limit");
  validateProject(document);
  return text;
}

export function decodeProject(text: string): PortableProject {
  if (typeof text !== "string" || new TextEncoder().encode(text).byteLength > MAX_PROJECT_BYTES) throw new Error("Project exceeds 16 MB limit");
  let envelope: unknown;
  try {
    envelope = JSON.parse(text);
  } catch {
    throw new Error("Project file is not valid JSON");
  }
  const root = record(envelope, "Project envelope");
  exactKeys(root, ["format", "version", "document"], "Project envelope");
  if (root.format !== "orsaven" || root.version !== 1) throw new Error("Unsupported project format or version");
  return validateProject(root.document);
}
