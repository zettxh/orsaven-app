import { copyRange, itemBounds } from "./pattern";
import { validateSvg } from "./svg";
import type { Asset, PatternItem, TileSettings } from "./types";
import { Point, util } from "fabric";

const MAX_COPIES = 512;
const MAX_NODES = 40_000;
const MAX_SOURCE_BYTES = 8_000_000;
const PATH_ORIGIN = new Point(0, 0);

const MAX_PIXELS = 8_000_000;
interface SvgMetrics { width: number; height: number; root: string; nodes: number }

function svgSource(asset: Asset) {
  if (asset.fabricSvg) return asset.fabricSvg;
  if (asset.originalSvg) return validateSvg(asset.originalSvg);
  if (!asset.src.startsWith("data:image/svg+xml")) throw new Error(`${asset.name}: raster assets are not supported in SVG proof`);
  const data = asset.src.slice(asset.src.indexOf(",") + 1);
  return validateSvg(asset.src.includes(";base64,") ? atob(data) : decodeURIComponent(data));
}

function metrics(source: string): SvgMetrics {
  const doc = new DOMParser().parseFromString(source, "image/svg+xml");
  const root = doc.documentElement;
  const box = root.getAttribute("viewBox")?.trim().split(/[\s,]+/).map(Number);
  const width = Number(root.getAttribute("width") || box?.[2]);
  const height = Number(root.getAttribute("height") || box?.[3]);
  if (!(width > 0 && height > 0) || width * height > 4_000_000) throw new Error("SVG intrinsic dimensions exceed 4 megapixel limit");
  if (!box || box.length !== 4) root.setAttribute("viewBox", `0 0 ${width} ${height}`);
  return { width, height, root: new XMLSerializer().serializeToString(root), nodes: doc.querySelectorAll("*").length };
}

function embeddedSvg(scope: string, data: SvgMetrics, width: number, height: number) {
  const root = new DOMParser().parseFromString(data.root, "image/svg+xml").documentElement;
  root.setAttribute("x", String(-width / 2));
  root.setAttribute("y", String(-height / 2));
  root.setAttribute("width", String(width));
  root.setAttribute("height", String(height));
  let markup = new XMLSerializer().serializeToString(root);
  for (const [, id] of [...markup.matchAll(/\bid="([\w.-]+)"/g)]) {
    markup = markup.replaceAll(`id="${id}"`, `id="${scope}-${id}"`).replaceAll(`url(#${id})`, `url(#${scope}-${id})`);
  }
  return markup;
}

function scaledRoot(source: string, scale: number): SvgMetrics {
  const doc = new DOMParser().parseFromString(source, "image/svg+xml");
  const root = doc.documentElement;
  const rootStyle = root.getAttribute("style") ?? "";
  if (!root.hasAttribute("stroke-width") && !/(?:^|;)\s*stroke-width\s*:/.test(rootStyle)) root.setAttribute("stroke-width", "1");
  const geometry = ["x", "y", "x1", "x2", "y1", "y2", "cx", "cy", "r", "rx", "ry", "width", "height"];
  for (const element of [root, ...root.querySelectorAll("*")]) {
    if (element.localName === "svg" && element.hasAttribute("viewBox")) {
      const viewBox = element.getAttribute("viewBox")!.trim().split(/[\s,]+/).map(Number);
      element.setAttribute("viewBox", viewBox.map((value) => String(value * scale)).join(" "));
    }
    for (const name of geometry) {
      const value = element.getAttribute(name);
      if (value !== null && Number.isFinite(Number(value))) element.setAttribute(name, String(Number(value) * scale));
    }
    const points = element.getAttribute("points");
    if (points) element.setAttribute("points", points.trim().split(/[\s,]+/).map((value) => String(Number(value) * scale)).join(" "));
    const d = element.getAttribute("d");
    if (d) element.setAttribute("d", util.joinPath(util.transformPath(util.makePathSimpler(util.parsePath(d)), [scale, 0, 0, scale, 0, 0], PATH_ORIGIN)));
    const transform = element.getAttribute("transform");
    if (transform) {
      const svgElement = element instanceof SVGGraphicsElement || element instanceof SVGClipPathElement ? element : null;
      const matrix = svgElement?.transform.baseVal.consolidate()?.matrix;
      if (matrix) element.setAttribute("transform", `matrix(${[matrix.a, matrix.b, matrix.c, matrix.d, matrix.e * scale, matrix.f * scale].join(" ")})`);
    }
    for (const name of ["stroke-width", "stroke-dashoffset", "stroke-dasharray"]) {
      const value = element.getAttribute(name);
      if (value && value !== "none") element.setAttribute(name, value.trim().split(/[\s,]+/).map((part) => String(Number(part) * scale)).join(" "));
    }
    const style = element.getAttribute("style");
    if (style) element.setAttribute("style", style.replace(/(stroke-width|stroke-dashoffset|stroke-dasharray)\s*:\s*([^;]+)/g, (_match, property: string, value: string) => `${property}:${value.trim() === "none" ? value : value.trim().split(/[\s,]+/).map((part) => String(Number(part) * scale)).join(" ")}`));
  }
  const box = root.getAttribute("viewBox")!.split(" ").map(Number);
  return { width: Number(root.getAttribute("width") || box[2]), height: Number(root.getAttribute("height") || box[3]), root: new XMLSerializer().serializeToString(root), nodes: doc.querySelectorAll("*").length };
}



function format(value: number) {
  if (!Number.isFinite(value)) throw new Error("Export transform is not finite");
  return String(Number(value.toFixed(5)));
}

function validateItem(item: PatternItem) {
  if (![item.x, item.y, item.size, item.scale, item.rotation, item.opacity].every(Number.isFinite) || item.size <= 0 || item.scale <= 0 || item.scale > 3 || item.opacity < 0 || item.opacity > 1 || Math.abs(item.rotation) > 36_000) throw new Error("Item transform or opacity is outside proof limits");
}

function validateTile(tile: TileSettings, scale: number) {
  if (!Number.isInteger(tile.width) || !Number.isInteger(tile.height) || tile.width < 64 || tile.height < 64 || tile.width > 4_096 || tile.height > 4_096) throw new Error("Tile dimensions must be 64–4096 px");
  if (!Number.isInteger(scale) || scale < 1 || scale > 3 || tile.width * scale > 4_096 || tile.height * scale > 4_096 || tile.width * tile.height * scale * scale > MAX_PIXELS) throw new Error("Raster export exceeds 8 megapixel budget");
}

export function assertAssetPixelBudget(assets: Asset[]) {
  if (assets.length > 64) throw new Error("Proof project exceeds 64 assets");
  let pixels = 0;
  for (const asset of assets) {
    const image = metrics(svgSource(asset));
    pixels += image.width * image.height;
    if (pixels > 16_000_000) throw new Error("Assets exceed 16 megapixel decoded-image budget");
  }
}

function planCopies(tile: TileSettings, items: PatternItem[], assets: Asset[]) {
  if (items.length > 256) throw new Error("Export exceeds 256 object limit");
  const byId = new Map(assets.map((asset) => [asset.id, asset]));
  const sourceCache = new Map<Asset, { source: string; metrics: SvgMetrics }>();
  const plans: { item: PatternItem; index: number; metrics: SvgMetrics; x: ReturnType<typeof copyRange>; y: ReturnType<typeof copyRange> }[] = [];
  let copies = 0;
  let nodes = 0;
  let sourceBytes = 0;
  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    validateItem(item);
    const asset = byId.get(item.assetId);
    if (!asset) throw new Error("An item references a missing asset");
    let source = sourceCache.get(asset);
    if (!source) {
      const svg = svgSource(asset);
      const image = metrics(svg);
      source = { source: svg, metrics: image };
      sourceCache.set(asset, source);
      sourceBytes += new TextEncoder().encode(svg).byteLength;
    }
    const { halfWidth, halfHeight } = itemBounds(item, source.metrics.height / source.metrics.width);
    if (halfWidth > tile.width * 64 || halfHeight > tile.height * 64) throw new Error("Object extent exceeds wrapped-copy safety limit");
    const x = copyRange(((item.x % tile.width) + tile.width) % tile.width, halfWidth, tile.width);
    const y = copyRange(((item.y % tile.height) + tile.height) % tile.height, halfHeight, tile.height);
    const count = (x.last - x.first + 1) * (y.last - y.first + 1);
    copies += count;
    nodes += count * source.metrics.nodes;
    if (copies > MAX_COPIES || nodes > MAX_NODES || sourceBytes * copies > MAX_SOURCE_BYTES) throw new Error("Export exceeds wrapped-copy, source-node, or byte budget");
    plans.push({ item, index, metrics: source.metrics, x, y });
  }
  return plans;
}

export function assertRasterBudget(tile: TileSettings, items: PatternItem[], assets: Asset[], scale = 1) {
  validateTile(tile, scale);
  assertAssetPixelBudget(assets);
  planCopies(tile, items, assets);
}

export function buildSvgArtifact(tile: TileSettings, items: PatternItem[], assets: Asset[]) {
  validateTile(tile, 1);
  assertAssetPixelBudget(assets);
  const plans = planCopies(tile, items, assets);
  const chunks = [`<svg xmlns="http://www.w3.org/2000/svg" width="${tile.width}" height="${tile.height}" viewBox="0 0 ${tile.width} ${tile.height}" overflow="hidden">`];
  if (tile.backgroundColor) {
    const color = tile.backgroundColor.trim();
    if (!(CSS.supports("color", color) && !/url|var\(|currentColor/i.test(color))) throw new Error("Tile background must be a solid color");
    chunks.push(`<rect width="${tile.width}" height="${tile.height}" fill="${color}"/>`);
  }
  for (const plan of plans) {
    const { item, metrics: image, x, y } = plan;
    const width = item.size * item.scale;
    const height = width * image.height / image.width;
    const baked = scaledRoot(image.root, width / image.width);
    for (let copyX = x.first; copyX <= x.last; copyX++) {
      for (let copyY = y.first; copyY <= y.last; copyY++) {
        const cx = ((item.x % tile.width) + tile.width) % tile.width + copyX * tile.width;
        const cy = ((item.y % tile.height) + tile.height) % tile.height + copyY * tile.height;
        const source = embeddedSvg(`asset${plan.index}-x${copyX}-y${copyY}`, baked, width, height);
        chunks.push(`<g opacity="${format(item.opacity)}" transform="translate(${format(cx)} ${format(cy)}) rotate(${format(item.rotation)}) scale(${item.flipX ? -1 : 1} ${item.flipY ? -1 : 1})">${source}</g>`);
      }
    }
  }
  chunks.push("</svg>");
  const output = chunks.join("");
  if (new TextEncoder().encode(output).byteLength > MAX_SOURCE_BYTES) throw new Error("SVG output exceeds 8 MB limit");
  return output;
}
