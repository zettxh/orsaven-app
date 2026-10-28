const MAX_BYTES = 256_000;
const MAX_NODES = 2_000;
const MAX_DEPTH = 32;
const MAX_PATH_CHARS = 200_000;
const MAX_DIMENSION = 4_096;
const tags = new Set(["svg", "defs", "clipPath", "g", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon"]);
const attributes = new Set(["xmlns", "id", "viewBox", "width", "height", "x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry", "d", "points", "fill", "fill-rule", "fill-opacity", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "stroke-miterlimit", "stroke-dasharray", "stroke-dashoffset", "stroke-opacity", "opacity", "transform", "clip-path", "clip-rule"]);
const numberPattern = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;

function finiteNumbers(value: string): number[] {
  const parts = value.trim().split(/[\s,]+/).filter(Boolean);
  const values = parts.map(Number);
  if (parts.some((part, index) => !numberPattern.test(part) || !Number.isFinite(values[index]))) throw new Error("SVG contains invalid or non-finite number");
  return values;
}

function checkTransform(value: string) {
  const pattern = /(matrix|translate|scale|rotate|skewX|skewY)\(([^()]*)\)/g;
  let end = 0;
  for (const match of value.matchAll(pattern)) {
    if (value.slice(end, match.index).trim().replaceAll(",", "") !== "") throw new Error("Unsupported SVG transform");
    const args = finiteNumbers(match[2]);
    const allowed = match[1] === "matrix" ? [6] : match[1] === "translate" || match[1] === "scale" ? [1, 2] : match[1] === "rotate" ? [1, 3] : [1];
    if (!allowed.includes(args.length) || args.some((n) => Math.abs(n) > MAX_DIMENSION)) throw new Error("SVG transform arguments exceed limits");
    end = match.index + match[0].length;
  }
  if (end !== value.length || end === 0) throw new Error("Unsupported SVG transform");
}

function checkPath(value: string) {
  const tokens: (string | number)[] = [];
  const tokenPattern = /([A-Za-z])|([+-]?(?:(?:\d+\.?\d*)|(?:\.\d+))(?:[eE][+-]?\d+)?)/y;
  let index = 0;
  while (index < value.length) {
    while (/[\s,]/.test(value[index] ?? "")) index++;
    if (index === value.length) break;
    tokenPattern.lastIndex = index;
    const match = tokenPattern.exec(value);
    if (!match) throw new Error("SVG path contains invalid syntax");
    if (match[1]) tokens.push(match[1]);
    else {
      const number = Number(match[2]);
      if (!Number.isFinite(number) || Math.abs(number) > 1_000_000) throw new Error("SVG path coordinate exceeds limit");
      tokens.push(number);
    }
    index = tokenPattern.lastIndex;
  }
  const arity: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7 };
  let cursor = 0;
  let command = "";
  while (cursor < tokens.length) {
    if (typeof tokens[cursor] === "string") command = tokens[cursor++] as string;
    const upper = command.toUpperCase();
    if (upper === "Z") {
      command = "";
      continue;
    }
    const count = arity[upper];
    if (!count) throw new Error("SVG path uses unsupported command");
    const start = cursor;
    while (cursor < tokens.length && typeof tokens[cursor] === "number") cursor++;
    const args = cursor - start;
    if (!args || args % count !== 0 || (upper === "M" && args < 2)) throw new Error("SVG path command has invalid arguments");
    if (upper === "A") {
      for (let i = start; i < cursor; i += 7) if (![0, 1].includes(tokens[i + 3] as number) || ![0, 1].includes(tokens[i + 4] as number)) throw new Error("SVG arc flags must be zero or one");
    }
    if (upper === "M") command = command === "M" ? "L" : "l";
  }
}

function checkPaint(value: string) {
  if (/^(none|transparent)$/i.test(value)) return;
  if (/^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value)) return;
  if (typeof CSS !== "undefined" && CSS.supports("color", value) && !/^(currentColor|inherit|initial|unset)$/i.test(value)) return;
  throw new Error("Only supported solid SVG fill and stroke colors are allowed");
}

function checkNumberAttr(name: string, value: string) {
  const number = finiteNumbers(value);
  if (number.length !== 1) throw new Error(`Invalid ${name}`);
  if (name.endsWith("opacity") && (number[0] < 0 || number[0] > 1)) throw new Error(`Invalid ${name}`);
  if ((name === "stroke-width" || name === "r" || name === "rx" || name === "ry" || name === "width" || name === "height") && number[0] < 0) throw new Error(`Invalid ${name}`);
  if (Math.abs(number[0]) > 1_000_000) throw new Error(`${name} exceeds limit`);
}

export function validateSvg(source: string): string {
  if (new TextEncoder().encode(source).byteLength > MAX_BYTES) throw new Error("SVG exceeds 256 KB import limit");
  if (/<!DOCTYPE|<!ENTITY|<\?xml-stylesheet/i.test(source)) throw new Error("SVG doctypes, entities, and stylesheets are not supported");
  const doc = new DOMParser().parseFromString(source, "image/svg+xml");
  if (doc.querySelector("parsererror")) throw new Error("SVG is not well-formed XML");
  const root = doc.documentElement;
  if (root.localName !== "svg" || root.namespaceURI !== "http://www.w3.org/2000/svg") throw new Error("File root must be an SVG element");
  const viewBox = root.getAttribute("viewBox");
  const dims = viewBox ? finiteNumbers(viewBox) : [0, 0, Number(root.getAttribute("width")), Number(root.getAttribute("height"))];
  const outputWidth = Number(root.getAttribute("width") || dims[2]);
  const outputHeight = Number(root.getAttribute("height") || dims[3]);
  if (dims.length !== 4 || dims.some((n) => !Number.isFinite(n)) || dims[2] <= 0 || dims[3] <= 0 || dims[2] > MAX_DIMENSION || dims[3] > MAX_DIMENSION || !Number.isFinite(outputWidth) || !Number.isFinite(outputHeight) || outputWidth <= 0 || outputHeight <= 0 || outputWidth > MAX_DIMENSION || outputHeight > MAX_DIMENSION || outputWidth * outputHeight > 4_000_000) throw new Error("SVG dimensions must fit 4096 px and 4 megapixel input limits");
  const ids = new Map<string, Element>();
  const refs: { id: string; owner: Element }[] = [];
  let nodes = 0;
  let pathChars = 0;
  const visit = (element: Element, depth: number) => {
    if (++nodes > MAX_NODES) throw new Error("SVG exceeds 2000 element limit");
    if (depth > MAX_DEPTH) throw new Error("SVG exceeds 32-level nesting limit");
    if (element.namespaceURI !== "http://www.w3.org/2000/svg" || !tags.has(element.localName)) throw new Error(`Unsupported SVG element: ${element.localName}`);
    for (const attr of [...element.attributes]) {
      if (!attributes.has(attr.name) || (attr.namespaceURI && !(attr.name === "xmlns" && attr.value === "http://www.w3.org/2000/svg"))) throw new Error(`Unsupported SVG attribute: ${attr.name}`);
      const value = attr.value.trim();
      if (attr.name === "xmlns") {
        if (value !== "http://www.w3.org/2000/svg") throw new Error("Unsupported SVG namespace");
        continue;
      }
      const lower = value.toLowerCase();
      if (attr.name !== "clip-path" && (lower.includes("url") || lower.includes("javascript:") || lower.includes("data:") || lower.includes("http:") || value.includes("//"))) throw new Error(`Unsafe SVG attribute: ${attr.name}`);
      if (attr.name === "fill" || attr.name === "stroke") checkPaint(value);
      else if (attr.name === "transform") checkTransform(value);
      else if (attr.name === "clip-path") {
        const ref = value.match(/^url\(#([\w.-]{1,128})\)$/);
        if (!ref || element.closest("clipPath")) throw new Error("Only acyclic local clip-path references are supported");
        refs.push({ id: ref[1], owner: element });
      } else if (attr.name === "id") {
        if (!/^[\w.-]{1,128}$/.test(value) || ids.has(value)) throw new Error("SVG IDs must be unique simple identifiers");
        ids.set(value, element);
      } else if (attr.name === "d") {
        pathChars += value.length;
        if (pathChars > MAX_PATH_CHARS) throw new Error("SVG path data exceeds 200 KB limit");
        checkPath(value);
      } else if (attr.name === "viewBox" || attr.name === "points" || attr.name === "stroke-dasharray") finiteNumbers(value);
      else if (["width", "height", "x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry", "stroke-width", "stroke-miterlimit", "stroke-dashoffset", "opacity", "fill-opacity", "stroke-opacity"].includes(attr.name)) checkNumberAttr(attr.name, value);
      else if (attr.name === "fill-rule" || attr.name === "clip-rule") {
        if (value !== "evenodd" && value !== "nonzero") throw new Error(`Unsupported ${attr.name}`);
      } else if (attr.name === "stroke-linecap" && !["butt", "round", "square"].includes(value)) throw new Error("Unsupported stroke-linecap");
      else if (attr.name === "stroke-linejoin" && !["miter", "round", "bevel"].includes(value)) throw new Error("Unsupported stroke-linejoin");
    }
    if ([...element.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && Boolean(node.textContent?.trim()))) throw new Error("SVG text content is not supported");
    for (const child of [...element.children]) visit(child, depth + 1);
  };
  visit(root, 1);
  for (const clipPath of [...doc.querySelectorAll("clipPath")]) {
    if (clipPath.children.length !== 1) throw new Error("Multiple shapes in internal clipPaths are not supported");
    const shape = clipPath.children[0];
    if (!["path", "rect", "circle", "ellipse", "polygon", "polyline"].includes(shape.localName) || shape.children.length) throw new Error("Only one direct vector shape is supported per internal clipPath");
    if (clipPath.hasAttribute("clip-rule") || (shape.hasAttribute("fill-rule") && !shape.hasAttribute("clip-rule"))) throw new Error("Clip paths require clip-rule on their single shape; fill-rule alone is unsupported");
  }
  for (const ref of refs) if (!ids.get(ref.id)?.matches("clipPath") || !doc.contains(ids.get(ref.id)!)) throw new Error("SVG references missing or non-clipping internal ID");
  return new XMLSerializer().serializeToString(doc);
}

export function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
