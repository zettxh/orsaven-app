import { useRef } from "react";
import type { Asset, PatternItem } from "../lib/types";

interface Props {
  assets: Asset[];
  search: string;
  onSearch: (v: string) => void;
  onAddAsset: (assetId: string) => void;
  onImport: (files: FileList | null) => void;
  items: PatternItem[];
  selectedId: string | null;
  onSelectItem: (id: string) => void;
}

export default function Sidebar(props: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const filtered = props.assets.filter((a) => a.name.toLowerCase().includes(props.search.toLowerCase()));

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-3">
      <div>
        <div className="lh-label mb-2">Library Aset</div>
        <input
          type="text"
          placeholder="Search..."
          value={props.search}
          onChange={(e) => props.onSearch(e.target.value)}
        />
        <button
          className="mt-2 w-full rounded-lg border border-border bg-accent px-3 py-2 text-left hover:bg-[#333]"
          onClick={() => fileRef.current?.click()}
        >
          + Import SVG
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".svg,image/svg+xml"
          multiple
          className="hidden"
          onChange={(e) => {
            props.onImport(e.target.files);
            e.target.value = "";
          }}
        />
        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
          Aset disimpan lokal di project. Klik aset untuk menambahkannya ke tile.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {filtered.map((asset) => (
          <button
            key={asset.id}
            className="rounded-xl border border-border bg-card p-2 text-left hover:border-ring"
            onClick={() => props.onAddAsset(asset.id)}
            title={`Tambah ${asset.name} ke tile`}
          >
            <div className="flex h-16 items-center justify-center overflow-hidden rounded-lg bg-[#2a2a2a]">
              <img src={asset.src} alt={asset.name} className="max-h-full max-w-full object-contain" />
            </div>
            <div className="mt-2 truncate text-[12px]">{asset.name}</div>
            <div className="text-[10px] text-muted-foreground">{asset.builtin ? "Contoh" : "Asetmu"}</div>
          </button>
        ))}
        {filtered.length === 0 && (
          <p className="col-span-2 text-[12px] text-muted-foreground">Tidak ada aset yang cocok.</p>
        )}
      </div>

      <div className="border-t border-border pt-3">
        <div className="lh-label mb-2">Layers di Tile ({props.items.length})</div>
        <div className="flex flex-col gap-1">
          {props.items.map((item, i) => (
            <button
              key={item.id}
              className={`rounded-lg border px-2 py-1.5 text-left text-[12px] ${
                item.id === props.selectedId ? "border-ring bg-accent" : "border-border bg-card"
              }`}
              onClick={() => props.onSelectItem(item.id)}
            >
              Layer {i + 1} · {Math.round(item.x)}, {Math.round(item.y)} · {Math.round(item.rotation)}°
            </button>
          ))}
          {props.items.length === 0 && (
            <p className="text-[12px] text-muted-foreground">Belum ada item. Klik aset di atas.</p>
          )}
        </div>
      </div>
    </div>
  );
}
