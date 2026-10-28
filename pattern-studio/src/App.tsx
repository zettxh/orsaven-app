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

async function fabricSvgSource(source: string, parsed: Awaited<ReturnType<typeof loadSVGFromString>>) {
  const root = new DOMParser().parseFromString(source, "image/svg+xml").documentElement;
  const box = root.getAttribute("viewBox")?.trim().split(/[\\s,]+/).map(Number);
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
export default function App() {
  const [projectName, setProjectName] = useState("Pattern tanpa judul");
  const [assets, setAssets] = useState<Asset[]>(() => builtinAssets());
  const [items, setItems] = useState<PatternItem[]>(() => [
    { id: uid(), assetId: "builtin-star", x: 128, y: 128, size: 140, rotation: 0, scale: 1, opacity: 1, flipX: false, flipY: false },
    { id: uid(), assetId: "builtin-leaf", x: 384, y: 384, size: 150, rotation: 25, scale: 1, opacity: 1, flipX: false, flipY: false },
    { id: uid(), assetId: "builtin-ring", x: 384, y: 128, size: 100, rotation: 0, scale: 1, opacity: 0.9, flipX: false, flipY: false },
  ]);
  const [tile, setTile] = useState<TileSettings>(DEFAULT_TILE);
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
  const importRef = useRef<HTMLInputElement>(null);
  const loadRef = useRef<HTMLInputElement>(null);
  const importingRef = useRef(false);
  const [exporting, setExporting] = useState(false);
  const [exportMessage, setExportMessage] = useState("");
  const [artifacts, setArtifacts] = useState<{ format: string; name: string; url: string }[]>([]);
  const artifactUrls = useRef(new Map<string, string>());
  const documentRevision = useRef(0);
  useEffect(() => {
    documentRevision.current += 1;
    for (const url of artifactUrls.current.values()) URL.revokeObjectURL(url);
    if (artifacts.length) setArtifacts([]);
    if (exportMessage) setExportMessage("");
    if (exportError) setExportError(false);
  }, [assets, items, tile, projectName]);
  useEffect(() => () => {
    for (const url of artifactUrls.current.values()) URL.revokeObjectURL(url);
    artifactUrls.current.clear();
  }, []);

  const selected = useMemo(() => items.find((i) => i.id === selectedId) ?? null, [items, selectedId]);

  function addAsset(assetId: string) {
    const item: PatternItem = {
      id: uid(),
      assetId,
      x: tile.width / 2,
      y: tile.height / 2,
      size: Math.round(tile.width / 4),
      rotation: 0,
      scale: 1,
      opacity: 1,
      flipX: false,
      flipY: false,
    };
    setItems((prev) => [...prev, item]);
    setSelectedId(item.id);
  }

  async function importFiles(files: FileList | null) {
    if (!files?.length) return;
    if (importingRef.current) {
      setImportMessage("An import is already running");
      setImportError(true);
      return;
    }
    importingRef.current = true;
    setImporting(true);
    setImportMessage("");
    setImportError(false);
    const pendingAssets = [...assets];
    try {
      for (const file of Array.from(files)) {
        try {
          if (file.size > 16_000_000) throw new Error("File exceeds 16 MB import limit");
          if (file.type !== "image/svg+xml" && !file.name.toLowerCase().endsWith(".svg")) throw new Error("Ticket 01 proof accepts SVG files only");
          if (file.size > 256_000) throw new Error("SVG exceeds 256 KB import limit");
          const originalSvg = await file.text();
          const safeSvg = validateSvg(originalSvg);
          const asset: Asset = { id: uid(), name: file.name, src: svgDataUrl(safeSvg), originalSvg };
          assertAssetPixelBudget([...pendingAssets, asset]);
          const parsed = await loadSVGFromString(safeSvg);
          if (!parsed.objects.some(Boolean)) throw new Error("Fabric could not parse SVG artwork");
          const fabricSvg = await fabricSvgSource(safeSvg, parsed);
          const fabricAsset = { ...asset, src: svgDataUrl(fabricSvg), fabricSvg };
          pendingAssets.push(fabricAsset);
          setAssets((prev) => [...prev, fabricAsset]);
          addAsset(fabricAsset.id);
          setImportMessage(`${file.name}: imported`);
          setImportError(false);
        } catch (error) {
          setImportMessage(`${file.name}: ${error instanceof Error ? error.message : "Import failed"}`);
          setImportError(true);
        }
      }
    } finally {
      importingRef.current = false;
      setImporting(false);
    }
  }

  function patchItem(patch: Partial<PatternItem>) {
    if (!selectedId) return;
    setItems((prev) => prev.map((i) => (i.id === selectedId ? { ...i, ...patch } : i)));
  }

  function patchTile(patch: Partial<TileSettings>) {
    const next = { ...tile, ...patch };
    if (!Number.isInteger(next.width) || !Number.isInteger(next.height) || next.width < 64 || next.height < 64 || next.width > 4_096 || next.height > 4_096 || next.width * next.height > 8_000_000) {
      setImportMessage("Tile edit rejected: use integer dimensions from 64 to 4096 px and stay below 8 megapixels");
      setImportError(true);
      return;
    }
    setTile(next);
    setImportMessage("");
    setImportError(false);
  }
  function moveItem(id: string, x: number, y: number) {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, x: wrap(x, tile.width), y: wrap(y, tile.height) } : i)));
  }

  function moveLayer(dir: 1 | -1) {
    if (!selectedId) return;
    setItems((prev) => {
      const idx = prev.findIndex((i) => i.id === selectedId);
      if (idx < 0) return prev;
      const next = [...prev];
      const target = idx + dir;
      if (target < 0 || target >= next.length) return prev;
      const [item] = next.splice(idx, 1);
      next.splice(target, 0, item);
      return next;
    });
  }

  function duplicateSelected() {
    if (!selected) return;
    const copy: PatternItem = { ...selected, id: uid(), x: wrap(selected.x + 32, tile.width), y: wrap(selected.y + 32, tile.height) };
    setItems((prev) => [...prev, copy]);
    setSelectedId(copy.id);
  }

  function deleteSelected() {
    if (!selectedId) return;
    setItems((prev) => prev.filter((i) => i.id !== selectedId));
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

  function saveProject() {
    try {
      beginArtifact("project");
      assertAssetPixelBudget(assets);
      const project: Project = { name: projectName, tile, items, assets };
      publishArtifact("project", "json", new Blob([JSON.stringify(project, null, 2)], { type: "application/json" }));
    } catch (error) {
      setExportMessage(error instanceof Error ? error.message : "Project save failed");
      setExportError(true);
    }
  }

  function loadProjectFile(file: File) {
    if (file.size > 16_000_000) {
      setImportMessage("Project exceeds 16 MB limit");
      setImportError(true);
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => {
      setImportMessage("Project file could not be read");
      setImportError(true);
    };
    reader.onload = async () => {
      try {
        const project = JSON.parse(String(reader.result)) as Project;
        if (!Array.isArray(project.assets) || !Array.isArray(project.items) || project.assets.length > 64 || project.items.length > 256) throw new Error("Project data exceeds proof limits");
        const safeAssets: Asset[] = [];
        for (const asset of project.assets) {
          if (typeof asset.id !== "string" || typeof asset.name !== "string" || typeof asset.src !== "string") throw new Error("Project asset data is invalid");
          let originalSvg = asset.originalSvg;
          if (!originalSvg) {
            if (!asset.src.startsWith("data:image/svg+xml") || asset.src.length > 400_000) throw new Error("Only bounded SVG assets are supported in project files");
            const payload = asset.src.slice(asset.src.indexOf(",") + 1);
            originalSvg = asset.src.includes(";base64,") ? atob(payload) : decodeURIComponent(payload);
          }
          const safeSvg = validateSvg(originalSvg);
          assertAssetPixelBudget([...safeAssets, { ...asset, originalSvg, src: svgDataUrl(safeSvg) }]);
          const parsed = await loadSVGFromString(safeSvg);
          if (!parsed.objects.some(Boolean)) throw new Error(`${asset.name}: Fabric could not parse project SVG`);
          const fabricSvg = await fabricSvgSource(safeSvg, parsed);
          safeAssets.push({ ...asset, originalSvg, fabricSvg, src: svgDataUrl(fabricSvg) });
        }
        const safeTile = project.tile ?? DEFAULT_TILE;
        if (!["grid", "brick", "half-drop", "mirror"].includes(safeTile.repeat) || !["dark", "checker", "light"].includes(safeTile.background)) throw new Error("Project tile settings are invalid");
        assertAssetPixelBudget(safeAssets);
        assertRasterBudget(safeTile, project.items, safeAssets);
        setProjectName(typeof project.name === "string" ? project.name : "Pattern tanpa judul");
        setTile(safeTile);
        setItems(project.items);
        setAssets(safeAssets);
        setSelectedId(null);
        setImportMessage("Project opened");
        setImportError(false);
      } catch (error) {
        setImportMessage(error instanceof Error ? error.message : "Project file invalid");
        setImportError(true);
      }
    };
    reader.readAsText(file);
  }

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      {/* Top bar bergaya LearnHarness: judul serif, kontrol mono, aksi di kanan. */}
      <header className="flex flex-wrap items-center gap-3 border-b border-border bg-background px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="flex gap-1.5" aria-hidden>
            <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
            <span className="h-3 w-3 rounded-full bg-[#febc2e]" />
            <span className="h-3 w-3 rounded-full bg-[#28c840]" />
          </span>
          <h1 className="font-title text-[28px] font-bold leading-none">Pattern Studio</h1>
        </div>

        <input
          type="text"
          value={projectName}
          onChange={(e) => setProjectName(e.target.value)}
          className="!w-56"
          aria-label="Nama pattern"
        />

        <div className="flex min-w-0 max-w-full flex-wrap items-center gap-x-2 gap-y-2">
          <span className="lh-label">Preview</span>
          <select
            value={preview}
            onChange={(e) => setPreview(e.target.value as PreviewMode)}
            className="!w-auto"
          >
            <option value="tile">1 Tile</option>
            <option value="repeat3">3 x 3</option>
            <option value="fill">Fill layar</option>
          </select>
          <label className="flex items-center gap-1 text-[12px] text-muted-foreground">
            <input type="checkbox" checked={showOutline} onChange={(e) => setShowOutline(e.target.checked)} />
            Outline tile
          </label>
          <label className="flex items-center gap-1 text-[12px] text-muted-foreground">
            Zoom
            <input
              type="range"
              min={10}
              max={300}
              value={Math.round(zoom * 100)}
              onChange={(e) => setZoom(Number(e.target.value) / 100)}
              className="w-24"
            />
            {Math.round(zoom * 100)}%
          </label>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button className="rounded-lg border border-border bg-card px-3 py-2 md:hidden" onClick={() => importRef.current?.click()} aria-label="Import SVG asset">
            Import SVG
          </button>
          <input
            ref={importRef}
            type="file"
            accept=".svg,image/svg+xml"
            multiple
            className="hidden"
            onChange={(e) => {
              importFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <button className="rounded-lg border border-border bg-card px-3 py-2" onClick={saveProject} aria-label="Save project JSON">
            Simpan .json
          </button>
          <button className="rounded-lg border border-border bg-card px-3 py-2" onClick={() => loadRef.current?.click()} aria-label="Open project JSON">
            Buka .json
          </button>
          <input
            ref={loadRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) loadProjectFile(f);
              e.target.value = "";
            }}
          />
          <button disabled={exporting} className="rounded-lg border border-gold px-3 py-2 text-gold disabled:opacity-50" onClick={exportSvg} aria-label="Export actual vector SVG">
            Export SVG
          </button>
          <button disabled={exporting} className="rounded-lg bg-primary px-3 py-2 font-bold text-primary-foreground disabled:opacity-50" onClick={() => exportRaster("png", 1)} aria-label="Export PNG at 1x">
            Export PNG 1x
          </button>
          <button disabled={exporting} className="rounded-lg border border-border bg-card px-3 py-2 disabled:opacity-50" onClick={() => exportRaster("jpeg", 1)} aria-label="Export JPEG with white background">
            Export JPG (putih)
          </button>
          {artifacts.map((artifact) => (
            <a key={artifact.format} href={artifact.url} download={artifact.name} className="rounded border border-border px-2 py-2 text-[12px] underline">
              Download {artifact.format.toUpperCase()}
            </a>
          ))}
          {exporting || exportMessage ? <span role={exportError ? "alert" : "status"} aria-live={exportError ? "assertive" : "polite"} className="text-[12px] text-muted-foreground">{exporting ? "Preparing export…" : exportMessage}</span> : null}
          {importing || importMessage ? <span role={importError ? "alert" : "status"} aria-live={importError ? "assertive" : "polite"} className="text-[12px] text-muted-foreground">{importing ? "Importing SVG…" : importMessage}</span> : null}
        </div>
      </header>
      <details className="border-b border-border bg-background lg:hidden">
        <summary className="cursor-pointer px-4 py-3 font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
          Kontrol item dan tile
        </summary>
        <div className="max-h-[45vh] overflow-y-auto">
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
        </div>
      </details>

      {/* Layout tiga kolom: sidebar | canvas | properti. */}
      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-[280px] shrink-0 border-r border-border bg-background md:block">
          <Sidebar
            assets={assets}
            search={search}
            onSearch={setSearch}
            onAddAsset={addAsset}
            onImport={importFiles}
            items={items}
            selectedId={selectedId}
            onSelectItem={setSelectedId}
          />
 
        </aside>

        <main className="min-w-0 flex-1">
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
            onViewChange={(z, p) => {
              setZoom(z);
              setPan(p);
            }}
          />
        </main>

        <aside className="hidden w-[300px] shrink-0 border-l border-border bg-background lg:block">
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
