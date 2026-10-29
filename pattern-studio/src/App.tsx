import { assertAssetPixelBudget, assertRasterBudget, buildSvgArtifact } from "./lib/proofExport";
import { loadSVGFromString, util } from "fabric";
import { useEffect, useMemo, useRef, useState } from "react";
import CanvasStage from "./components/CanvasStage";
import PropertiesPanel from "./components/PropertiesPanel";
import Sidebar from "./components/Sidebar";
import { builtinAssets, loadImage } from "./lib/assets";
import { renderTileCanvas } from "./lib/pattern";
import type { Asset, PatternItem, PreviewMode, Project, TileSettings } from "./lib/types";
import { DEFAULT_TILE, uid, wrap } from "./lib/types";
import { svgDataUrl, validateSvg } from "./lib/svg";
import { decodeProject, encodeProject, MAX_PROJECT_BYTES } from "./lib/project";
import { useRecovery } from "./lib/useRecovery";

declare global {
  interface Window {
    __TAURI__?: { core: { invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> } };
  }
}

async function fabricSvgSource(source: string, parsed: Awaited<ReturnType<typeof loadSVGFromString>>) {
  const root = new DOMParser().parseFromString(source, "image/svg+xml").documentElement;
  const box = root.getAttribute("viewBox")?.trim().split(/[\s,]+/).map(Number);
  const width = Number(root.getAttribute("width") || box?.[2]);
  const height = Number(root.getAttribute("height") || box?.[3]);
  const viewBox = root.getAttribute("viewBox") || `0 0 ${width} ${height}`;
  const clipRules = new Map<string, string>();
  for (const clip of [...root.querySelectorAll("clipPath")]) {
    const id = clip.getAttribute("id");
    if (id) clipRules.set(id, clip.children[0].getAttribute("clip-rule") || "nonzero");
  }
  const objects = parsed.objects.filter((object) => object !== null);
  const serialized = util.groupSVGElements(objects, parsed.options).toSVG();
  const document = new DOMParser().parseFromString(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${viewBox}">${serialized}</svg>`,
    "image/svg+xml",
  );
  for (const clip of [...document.querySelectorAll("clipPath")]) {
    const shape = clip.firstElementChild;
    const rule = shape?.id ? clipRules.get(shape.id) : undefined;
    if (!shape || !rule) throw new Error("Fabric serialization lost an internal clipPath ID");
    shape.setAttribute("clip-rule", rule);
    if (rule === "evenodd") {
      const { normalizeEvenoddClip } = await import("./lib/svgClip");
      await normalizeEvenoddClip(shape);
    }
  }
  return new XMLSerializer().serializeToString(document.documentElement);
}

async function hydrateProject(contents: string): Promise<Project> {
  const portable = decodeProject(contents);
  const safeAssets: Asset[] = [];
  for (const asset of portable.assets) {
    const safeSvg = validateSvg(asset.originalSvg);
    const parsed = await loadSVGFromString(safeSvg);
    if (!parsed.objects.some(Boolean)) throw new Error(`${asset.name}: SVG project tidak dapat dibaca.`);
    const fabricSvg = await fabricSvgSource(safeSvg, parsed);
    safeAssets.push({ ...asset, fabricSvg, src: svgDataUrl(fabricSvg) });
  }
  assertAssetPixelBudget(safeAssets);
  assertRasterBudget(portable.tile, portable.items, safeAssets);
  return { ...portable, assets: safeAssets };
}

export default function App() {
  const [project, setProject] = useState<Project>(() => ({
    name: "Pattern tanpa judul",
    tile: DEFAULT_TILE,
    items: [
      { id: uid(), assetId: "builtin-star", x: 128, y: 128, size: 140, rotation: 0, scale: 1, opacity: 1, flipX: false, flipY: false },
      { id: uid(), assetId: "builtin-leaf", x: 384, y: 384, size: 150, rotation: 25, scale: 1, opacity: 1, flipX: false, flipY: false },
      { id: uid(), assetId: "builtin-ring", x: 384, y: 128, size: 100, rotation: 0, scale: 1, opacity: 0.9, flipX: false, flipY: false },
    ],
    assets: builtinAssets(),
  }));
  const { name: projectName, assets, items, tile } = project;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [preview, setPreview] = useState<PreviewMode>("fill");
  const [zoom, setZoom] = useState(0.6);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [showOutline, setShowOutline] = useState(true);
  const [importMessage, setImportMessage] = useState("");
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState(false);
  const [exportError, setExportError] = useState(false);
  const loadRef = useRef<HTMLInputElement>(null);
  const [exporting, setExporting] = useState(false);
  const [projectBusy, setProjectBusy] = useState(false);
  const projectIo = useRef(false);
  const [exportMessage, setExportMessage] = useState("");
  const [artifacts, setArtifacts] = useState<{ format: string; name: string; url: string }[]>([]);
  const artifactUrls = useRef(new Map<string, string>());
  const documentRevision = useRef(0);
  const generation = useRef(0);
  const history = useRef<{ past: Project[]; future: Project[] }>({ past: [], future: [] });
  const current = useRef(project);
  current.current = project;
  const recovery = useRecovery(project);
  const [origin, setOrigin] = useState<"new" | "saved" | "recovery">("new");
  const baseline = useRef<Project | null>(project);
  const [restoring, setRestoring] = useState(false);
  const recoveryRegion = useRef<HTMLElement>(null);
  const blocked = recovery.blocked || restoring;
  const dirty = baseline.current !== project;

  useEffect(() => {
    if (recovery.blocked) recoveryRegion.current?.focus();
  }, [recovery.blocked, recovery.contents, recovery.error]);

  async function restoreRecovery() {
    if (recovery.contents === null || recovery.busy || restoring) return;
    const request = ++generation.current;
    const revision = documentRevision.current;
    setRestoring(true);
    try {
      const restored = await hydrateProject(recovery.contents);
      if (request !== generation.current || revision !== documentRevision.current) return;
      baseline.current = null;
      setOrigin("recovery");
      applyProject(restored);
      recovery.restored(restored);
    } catch (error) {
      if (request === generation.current) recovery.restoreFailed(error);
    } finally {
      setRestoring(false);
    }
  }
  const canUndo = history.current.past.length > 0;
  const canRedo = history.current.future.length > 0;

  function invalidateArtifacts() {
    documentRevision.current += 1;
    const hasArtifacts = artifacts.length > 0 || artifactUrls.current.size > 0;
    for (const url of artifactUrls.current.values()) URL.revokeObjectURL(url);
    artifactUrls.current.clear();
    if (hasArtifacts) setArtifacts([]);
    if (exportMessage) setExportMessage("");
    if (exportError) setExportError(false);
  }

  function commit(next: Project) {
    if (blocked) return;
    const previous = current.current;
    const sameTile = Object.keys(previous.tile).every((key) => previous.tile[key as keyof TileSettings] === next.tile[key as keyof TileSettings]);
    const sameItems = previous.items.length === next.items.length && previous.items.every((item, index) => {
      const other = next.items[index];
      return item.id === other.id && item.assetId === other.assetId && item.x === other.x && item.y === other.y &&
        item.size === other.size && item.rotation === other.rotation && item.scale === other.scale &&
        item.opacity === other.opacity && item.flipX === other.flipX && item.flipY === other.flipY;
    });
    const sameAssets = previous.assets.length === next.assets.length && previous.assets.every((asset, index) => asset === next.assets[index]);
    if (next.name === previous.name && sameTile && sameItems && sameAssets) return;
    invalidateArtifacts();
    history.current.past = [...history.current.past.slice(-49), previous];
    history.current.future = [];
    current.current = next;
    setProject(next);
  }
  function resetEditorView() {
    setSelectedId(null);
    setSearch("");
    setPreview("fill");
    setZoom(0.6);
    setPan({ x: 0, y: 0 });
    setShowOutline(true);
    setImportMessage("");
    setImporting(false);
    setImportError(false);
    setExporting(false);
    history.current = { past: [], future: [] };
  }
  function applyProject(project: Project) {
    generation.current += 1;
    invalidateArtifacts();
    current.current = project;
    setProject(project);
    resetEditorView();
  }

  function undo() {
    if (blocked) return;
    const previous = history.current.past[history.current.past.length - 1];
    if (!previous) return;
    invalidateArtifacts();
    history.current = { past: history.current.past.slice(0, -1), future: [current.current, ...history.current.future].slice(0, 50) };
    current.current = previous;
    setProject(previous);
    setSelectedId((id) => previous.items.some((item) => item.id === id) ? id : null);
  }

  function redo() {
    if (blocked) return;
    const next = history.current.future[0];
    if (!next) return;
    invalidateArtifacts();
    history.current = { past: [...history.current.past.slice(-49), current.current], future: history.current.future.slice(1) };
    current.current = next;
    setProject(next);
    setSelectedId((id) => next.items.some((item) => item.id === id) ? id : null);
  }

  function newProject() {
    if (blocked) return;
    if (baseline.current !== current.current && !window.confirm("Buang perubahan project yang belum tersimpan dan buat project baru?")) return;
    const next = { name: "Pattern tanpa judul", tile: DEFAULT_TILE, items: [], assets: builtinAssets() };
    baseline.current = next;
    setOrigin("new");
    applyProject(next);
  }

  useEffect(() => () => {
    generation.current += 1;
    for (const url of artifactUrls.current.values()) URL.revokeObjectURL(url);
    artifactUrls.current.clear();
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (blocked) return;
      if (event.isComposing || event.metaKey && event.key === "Process") return;
      const target = event.target;
      const editable = target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target instanceof HTMLInputElement && ["text", "search", "number", "range"].includes(target.type));
      if (editable) return;
      const mod = event.ctrlKey || event.metaKey;
      if (mod && event.key.toLowerCase() === "z") {
        event.preventDefault();
        event.shiftKey ? redo() : undo();
      } else if (mod && event.key.toLowerCase() === "y") {
        event.preventDefault();
        redo();
      } else if (mod && event.key.toLowerCase() === "d") {
        event.preventDefault();
        duplicateSelected();
      } else if ((event.key === "Delete" || event.key === "Backspace") && selectedId) {
        event.preventDefault();
        deleteSelected();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const selected = useMemo(() => items.find((i) => i.id === selectedId) ?? null, [items, selectedId]);

  function addAsset(assetId: string, asset?: Asset) {
    const item: PatternItem = {
      id: uid(), assetId, x: tile.width / 2, y: tile.height / 2, size: Math.round(tile.width / 4),
      rotation: 0, scale: 1, opacity: 1, flipX: false, flipY: false,
    };
    commit({ ...current.current, assets: asset ? [...current.current.assets, asset] : current.current.assets, items: [...current.current.items, item] });
    setSelectedId(item.id);
  }

  async function importFiles(files: FileList | null) {
    if (!files?.length) return;
    const request = ++generation.current;
    setImporting(true);
    setImportMessage("");
    setImportError(false);
    try {
      const imported: Asset[] = [];
      for (const file of Array.from(files)) {
        if (file.size > 16_000_000) throw new Error("File exceeds 16 MB import limit");
        if (file.type !== "image/svg+xml" && !file.name.toLowerCase().endsWith(".svg")) throw new Error("SVG files only");
        if (file.size > 256_000) throw new Error("SVG exceeds 256 KB import limit");
        const originalSvg = await file.text();
        const safeSvg = validateSvg(originalSvg);
        const asset: Asset = { id: uid(), name: file.name, src: svgDataUrl(safeSvg), originalSvg };
        assertAssetPixelBudget([...current.current.assets, ...imported, asset]);
        const parsed = await loadSVGFromString(safeSvg);
        if (!parsed.objects.some(Boolean)) throw new Error("Fabric could not parse SVG artwork");
        const fabricSvg = await fabricSvgSource(safeSvg, parsed);
        imported.push({ ...asset, src: svgDataUrl(fabricSvg), fabricSvg });
      }
      if (request !== generation.current) return;
      const nextItems = [...current.current.items];
      const addedItems = imported.map((asset) => ({
        id: uid(), assetId: asset.id, x: current.current.tile.width / 2, y: current.current.tile.height / 2,
        size: Math.round(current.current.tile.width / 4), rotation: 0, scale: 1, opacity: 1, flipX: false, flipY: false,
      }));
      commit({ ...current.current, assets: [...current.current.assets, ...imported], items: [...nextItems, ...addedItems] });
      setSelectedId(addedItems[addedItems.length - 1]?.id ?? selectedId);
      setImportMessage(`${imported.length} SVG imported`);
      setImportError(false);
    } catch (error) {
      if (request !== generation.current) return;
      setImportMessage(error instanceof Error ? error.message : "Import failed");
      setImportError(true);
    } finally {
      if (request === generation.current) setImporting(false);
    }
  }

  function patchItem(patch: Partial<PatternItem>) {
    if (!selectedId) return;
    const nextItems = current.current.items.map((item) => item.id === selectedId ? { ...item, ...patch } : item);
    commit({ ...current.current, items: nextItems });
  }

  function patchTile(patch: Partial<TileSettings>) {
    const next = { ...current.current.tile, ...patch };
    if (!Number.isInteger(next.width) || !Number.isInteger(next.height) || next.width < 64 || next.height < 64 || next.width > 4_096 || next.height > 4_096 || next.width * next.height > 8_000_000) {
      setImportMessage("Tile edit rejected: use integer dimensions from 64 to 4096 px and stay below 8 megapixels");
      setImportError(true);
      return;
    }
    setImportMessage("");
    setImportError(false);
    commit({ ...current.current, tile: next });
  }

  function moveItem(id: string, x: number, y: number) {
    const nextItems = current.current.items.map((item) => item.id === id ? { ...item, x: wrap(x, current.current.tile.width), y: wrap(y, current.current.tile.height) } : item);
    commit({ ...current.current, items: nextItems });
  }

  function moveLayer(dir: 1 | -1) {
    if (!selectedId) return;
    const items = current.current.items;
    const index = items.findIndex((item) => item.id === selectedId);
    if (index < 0 || index + dir < 0 || index + dir >= items.length) return;
    const next = [...items];
    const [item] = next.splice(index, 1);
    next.splice(index + dir, 0, item);
    commit({ ...current.current, items: next });
  }

  function duplicateSelected() {
    if (!selected) return;
    const copy: PatternItem = { ...selected, id: uid(), x: wrap(selected.x + 32, tile.width), y: wrap(selected.y + 32, tile.height) };
    commit({ ...current.current, items: [...current.current.items, copy] });
    setSelectedId(copy.id);
  }

  function deleteSelected() {
    if (!selectedId) return;
    const nextItems = current.current.items.filter((item) => item.id !== selectedId);
    if (nextItems.length === current.current.items.length) return;
    commit({ ...current.current, items: nextItems });
    setSelectedId(null);
  }

  function beginArtifact(format: string) {
    const previous = artifactUrls.current.get(format);
    if (previous) URL.revokeObjectURL(previous);
    artifactUrls.current.delete(format);
    setArtifacts((prev) => prev.filter((artifact) => artifact.format !== format));
  }

  function publishArtifact(format: string, extension: string, blob: Blob, revision = documentRevision.current) {
    if (revision !== documentRevision.current) return false;
    const url = URL.createObjectURL(blob);
    artifactUrls.current.set(format, url);
    const name = `${projectName.replace(/[^\w-]+/g, "-") || "pattern"}-tile.${extension}`;
    setArtifacts((prev) => [...prev.filter((artifact) => artifact.format !== format), { format, name, url }]);
    setExportMessage(`${format.toUpperCase()} artifact ready`);
    setExportError(false);
    return true;
  }

  async function waitForItemImages() {
    const byId = new Map(assets.map((asset) => [asset.id, asset]));
    const sources = new Set(items.map((item) => byId.get(item.assetId)?.src).filter((src): src is string => Boolean(src)));
    await Promise.all([...sources].map((src) => {
      const image = loadImage(src, () => {});
      return image.decode();
    }));
  }

  async function exportSvg() {
    const revision = documentRevision.current;
    beginArtifact("svg");
    setExporting(true);
    setExportMessage("");
    setExportError(false);
    try {
      const output = buildSvgArtifact(tile, items, assets);
      publishArtifact("svg", "svg", new Blob([output], { type: "image/svg+xml" }), revision);
    } catch (error) {
      if (revision !== documentRevision.current) return;
      setExportMessage(error instanceof Error ? error.message : "SVG export failed");
      setExportError(true);
    } finally {
      setExporting(false);
    }
  }

  async function exportRaster(format: "png" | "jpeg", scale: number) {
    const revision = documentRevision.current;
    beginArtifact(format);
    setExporting(true);
    setExportMessage("");
    setExportError(false);
    try {
      assertRasterBudget(tile, items, assets, scale);
      await waitForItemImages();
      if (revision !== documentRevision.current) return;
      const outputTile = format === "jpeg" ? { ...tile, backgroundColor: "#ffffff" } : tile;
      const canvas = renderTileCanvas(outputTile, items, assets, scale, () => {});
      const mime = format === "jpeg" ? "image/jpeg" : "image/png";
      try {
        const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((result) => result ? resolve(result) : reject(new Error("Browser could not encode raster output")), mime, 0.92));
        if (revision !== documentRevision.current) return;
        publishArtifact(format, format === "jpeg" ? "jpg" : "png", blob, revision);
      } finally {
        canvas.width = 0;
        canvas.height = 0;
      }
    } catch (error) {
      if (revision !== documentRevision.current) return;
      setExportMessage(error instanceof Error ? error.message : "Raster export failed");
      setExportError(true);
    } finally {
      setExporting(false);
    }
  }

  async function saveProject() {
    if (blocked || projectIo.current) return;
    projectIo.current = true;
    setProjectBusy(true);
    const revision = documentRevision.current;
    try {
      const snapshot = current.current;
      const contents = encodeProject(snapshot);
      const native = window.__TAURI__?.core;
      if (native) {
        const path = await native.invoke<string | null>("save_project", {
          contents,
          suggestedName: `${snapshot.name.replace(/[^\w-]+/g, "-") || "pattern"}.orsaven`,
        });
        if (revision !== documentRevision.current) return;
        setExportMessage(path ? "Project tersimpan." : "Penyimpanan dibatalkan.");
        setExportError(false);
        if (path) {
          baseline.current = snapshot;
          setOrigin("saved");
          await recovery.savedProject(snapshot);
        }
      } else {
        beginArtifact("project");
        publishArtifact("project", "orsaven", new Blob([contents], { type: "application/json" }), revision);
      }
    } catch (error) {
      if (revision !== documentRevision.current) return;
      setExportMessage(error instanceof Error ? error.message : String(error));
      setExportError(true);
    } finally {
      projectIo.current = false;
      setProjectBusy(false);
    }
  }

  async function readProject(read: () => Promise<string | null>) {
    if (blocked || projectIo.current) return;
    if (baseline.current !== current.current && !window.confirm("Buang perubahan project yang belum tersimpan dan buka file ini?")) return;
    projectIo.current = true;
    setProjectBusy(true);
    const request = ++generation.current;
    const revision = documentRevision.current;
    setImporting(true);
    setImportMessage("Membuka project...");
    setImportError(false);
    try {
      const contents = await read();
      if (request !== generation.current) return;
      if (contents === null) {
        setImportMessage("Pembukaan dibatalkan.");
        return;
      }
      const portable = await hydrateProject(contents);
      if (request !== generation.current) return;
      if (revision !== documentRevision.current) throw new Error("Dokumen berubah saat project dibaca. Buka ulang file agar edit terbaru tidak hilang.");
      baseline.current = portable;
      setOrigin("saved");
      applyProject(portable);
      setImportMessage("Project terbuka.");
      setImportError(false);
      await recovery.openedProject(portable);
    } catch (error) {
      if (request !== generation.current) return;
      setImportMessage(error instanceof Error ? error.message : String(error));
      setImportError(true);
    } finally {
      projectIo.current = false;
      setProjectBusy(false);
      if (request === generation.current) setImporting(false);
    }
  }

  function loadProjectFile(file: File) {
    void readProject(async () => {
      if (file.size > MAX_PROJECT_BYTES) throw new Error("Project melebihi batas 16 MB.");
      return file.text();
    });
  }

  function openProject() {
    const native = window.__TAURI__?.core;
    if (!native) { loadRef.current?.click(); return; }
    void readProject(async () => {
      const file = await native.invoke<{ path: string; contents: string } | null>("open_project");
      return file?.contents ?? null;
    });
  }

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <section ref={recoveryRegion} tabIndex={-1} aria-label="Recovery project" aria-busy={recovery.busy || restoring} className="min-w-0 shrink-0 border-b border-border px-4 py-2 text-[12px] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring">
        <p>Sumber dokumen: {origin === "recovery" ? "recovery" : origin === "saved" ? "file project tersimpan" : "dokumen baru"}. {dirty ? "Perubahan belum tersimpan ke file project." : ""}</p>
        <p role={recovery.error ? "alert" : "status"} className="break-words">
          {restoring ? "Memvalidasi dan memulihkan recovery..." : recovery.status} {recovery.error}
        </p>
        {recovery.blocked && (
          <div className="mt-2 flex flex-wrap gap-2">
            {recovery.contents !== null && <button disabled={recovery.busy || restoring} onClick={() => void restoreRecovery()} className="rounded-lg bg-primary px-3 py-2 font-bold text-primary-foreground disabled:opacity-50">Pulihkan pekerjaan</button>}
            {recovery.error && <button disabled={recovery.busy || restoring} onClick={() => void recovery.discover()} className="rounded-lg border border-border bg-card px-3 py-2 disabled:opacity-50">Coba baca recovery lagi</button>}
            <button disabled={recovery.busy || restoring} onClick={() => {
              if (window.confirm("Hapus salinan recovery ini? Pekerjaan yang hanya ada di recovery akan hilang. File project utama tidak berubah.")) void recovery.discard();
            }} className="rounded-lg border border-border bg-card px-3 py-2 disabled:opacity-50">Buang recovery</button>
          </div>
        )}
        {!recovery.blocked && recovery.error && <button onClick={recovery.retry} className="mt-2 rounded-lg border border-border bg-card px-3 py-2">Coba recovery lagi</button>}
      </section>
      <header inert={blocked} className="flex flex-wrap items-center gap-3 border-b border-border bg-background px-4 py-3">
        <h1 className="font-title text-[28px] font-bold leading-none">Pattern Studio</h1>
        <input
          type="text"
          value={projectName}
          onChange={(event) => commit({ ...current.current, name: event.target.value })}
          className="!w-56"
          aria-label="Nama pattern"
        />
        <div className="flex min-w-0 max-w-full flex-wrap items-center gap-x-2 gap-y-2">
          <select
            aria-label="Preview"
            value={preview}
            onChange={(event) => setPreview(event.target.value as PreviewMode)}
            className="!w-auto"
          >
            <option value="tile">1 Tile</option>
            <option value="repeat3">3 x 3</option>
            <option value="fill">Fill layar</option>
          </select>
          <label className="flex items-center gap-1 text-[12px] text-muted-foreground">
            <input type="checkbox" checked={showOutline} onChange={(event) => setShowOutline(event.target.checked)} />
            Outline tile
          </label>
          <label className="flex items-center gap-1 text-[12px] text-muted-foreground">
            Zoom
            <input
              type="range"
              min={10}
              max={300}
              value={Math.round(zoom * 100)}
              onChange={(event) => setZoom(Number(event.target.value) / 100)}
              className="w-24"
            />
            {Math.round(zoom * 100)}%
          </label>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button className="rounded-lg border border-border bg-card px-3 py-2" onClick={newProject} aria-label="Project baru">
            Project baru
          </button>
          <button
            disabled={!canUndo}
            className="rounded-lg border border-border bg-card px-3 py-2 disabled:opacity-50"
            onClick={undo}
            aria-label="Undo"
          >
            Undo
          </button>
          <button
            disabled={!canRedo}
            className="rounded-lg border border-border bg-card px-3 py-2 disabled:opacity-50"
            onClick={redo}
            aria-label="Redo"
          >
            Redo
          </button>
          <button disabled={projectBusy} className="rounded-lg border border-border bg-card px-3 py-2 disabled:opacity-50" onClick={saveProject} aria-label="Save portable project">
            Simpan .orsaven
          </button>
          <button
            disabled={projectBusy}
            className="rounded-lg border border-border bg-card px-3 py-2 disabled:opacity-50"
            onClick={openProject}
            aria-label="Open portable project"
          >
            Buka .orsaven
          </button>
          <input
            ref={loadRef}
            type="file"
            accept=".orsaven,application/json"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) loadProjectFile(file);
              event.target.value = "";
            }}
          />
          <button
            disabled={exporting}
            className="rounded-lg border border-gold px-3 py-2 text-gold disabled:opacity-50"
            onClick={exportSvg}
            aria-label="Export actual vector SVG"
          >
            Export SVG
          </button>
          <button
            disabled={exporting}
            className="rounded-lg bg-primary px-3 py-2 font-bold text-primary-foreground disabled:opacity-50"
            onClick={() => exportRaster("png", 1)}
            aria-label="Export PNG at 1x"
          >
            Export PNG 1x
          </button>
          <button
            disabled={exporting}
            className="rounded-lg border border-border bg-card px-3 py-2 disabled:opacity-50"
            onClick={() => exportRaster("jpeg", 1)}
            aria-label="Export JPEG with white background"
          >
            Export JPG (putih)
          </button>
          {artifacts.map((artifact) => (
            <a
              key={artifact.format}
              href={artifact.url}
              download={artifact.name}
              className="rounded border border-border px-2 py-2 text-[12px] underline"
            >
              Download {artifact.format.toUpperCase()}
            </a>
          ))}
          {exporting || exportMessage ? (
            <span
              role={exportError ? "alert" : "status"}
              aria-live={exportError ? "assertive" : "polite"}
              className="text-[12px] text-muted-foreground"
            >
              {exporting ? "Preparing export…" : exportMessage}
            </span>
          ) : null}
        </div>
      </header>
      <div inert={blocked} className="editor-workspace flex min-h-0 flex-1 flex-col md:flex-row">
        <aside className="editor-library max-h-[30vh] w-full shrink-0 overflow-y-auto border-b border-border bg-background md:max-h-none md:w-[260px] md:border-b-0 md:border-r">
          <Sidebar
            assets={assets}
            search={search}
            onSearch={setSearch}
            onAddAsset={addAsset}
            onImport={importFiles}
            items={items}
            selectedId={selectedId}
            onSelectItem={setSelectedId}
            importing={importing}
            importMessage={importMessage}
            importError={importError}
          />
        </aside>
        <main className="editor-canvas min-h-[280px] min-w-0 flex-1">
          <CanvasStage
            tile={tile}
            items={items}
            assets={assets}
            selectedId={selectedId}
            preview={preview}
            zoom={zoom}
            pan={pan}
            showOutline={showOutline}
            onSelect={setSelectedId}
            onMoveItem={moveItem}
            onViewChange={(nextZoom, nextPan) => {
              setZoom(nextZoom);
              setPan(nextPan);
            }}
          />
        </main>
        <aside className="editor-properties max-h-[38vh] w-full shrink-0 overflow-y-auto border-t border-border bg-background md:max-h-none md:w-[300px] md:border-l md:border-t-0">
          <PropertiesPanel
            item={selected}
            assets={assets}
            tile={tile}
            onPatchItem={patchItem}
            onPatchTile={patchTile}
            onDuplicate={duplicateSelected}
            onDelete={deleteSelected}
            onMoveLayer={moveLayer}
          />
        </aside>
      </div>
      <footer className="flex items-center gap-4 border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
        <span>{items.length} item</span>
        <span>{assets.length} aset</span>
        <span className="hidden md:inline">Drag item di canvas untuk memindah · drag area kosong untuk pan · scroll untuk zoom</span>
        <span className="ml-auto">Starter lokal · aset tidak diupload</span>
      </footer>
    </div>
  );
}
