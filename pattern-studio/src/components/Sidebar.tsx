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
  importing?: boolean;
  importMessage?: string;
  importError?: boolean;
}

export default function Sidebar(props: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const filtered = props.assets.filter((a) => a.name.toLowerCase().includes(props.search.toLowerCase()));

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-3">
      <div>
        <h2 className="lh-label mb-2">Library Aset</h2>
        <input
          type="text"
          aria-label="Cari aset"
          placeholder="Cari aset..."
          value={props.search}
          onChange={(e) => props.onSearch(e.target.value)}
        />
        <button
          className="mt-2 w-full rounded-lg border border-border bg-accent px-3 py-2 text-left hover:bg-[#333]"
          disabled={props.importing}
          aria-label="Import SVG asset"
          onClick={() => fileRef.current?.click()}
        >
          + Import SVG
        </button>
        <input
          ref={fileRef}
          type="file"
          aria-label="File aset SVG"
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
        <div aria-busy={Boolean(props.importing)}>
          {props.importing && <p role="status" className="mt-2 text-[12px]">Memuat aset SVG...</p>}
          {!props.importing && props.importMessage && (
            <p role={props.importError ? "alert" : "status"} className="mt-2 break-words text-[12px]">
              {props.importMessage}
              {props.importError && " Dokumen tetap tersedia. Periksa file lalu impor ulang."}
            </p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {filtered.map((asset) => (
          <button
            key={asset.id}
            className="rounded-xl border border-border bg-card p-2 text-left hover:border-ring"
            aria-label={`Tambah ${asset.name} ke tile`}
            onClick={() => props.onAddAsset(asset.id)}
            title={`Tambah ${asset.name} ke tile`}
          >
            <div className="flex h-16 items-center justify-center overflow-hidden rounded-lg bg-[#2a2a2a]">
              <img src={asset.src} alt="" className="max-h-full max-w-full object-contain" />
            </div>
            <div className="mt-2 truncate text-[12px]">{asset.name}</div>
            <div className="text-[10px] text-muted-foreground">{asset.builtin ? "Contoh" : "Asetmu"}</div>
          </button>
        ))}
        {filtered.length === 0 && (
          <p className="col-span-2 text-[12px] text-muted-foreground">
            {props.assets.length === 0 ? "Library masih kosong. Impor SVG untuk mulai menata tile." : "Tidak ada aset yang cocok. Ubah pencarian."}
          </p>
        )}
      </div>

      <div className="border-t border-border pt-3">
        <h2 className="lh-label mb-2">Layers di Tile ({props.items.length})</h2>
        <div className="flex flex-col gap-1">
          {props.items.map((item, i) => (
            <button
              key={item.id}
              aria-pressed={item.id === props.selectedId}
              className={`rounded-lg border px-2 py-1.5 text-left text-[12px] ${
                item.id === props.selectedId ? "border-ring bg-accent" : "border-border bg-card"
              }`}
              onClick={() => props.onSelectItem(item.id)}
            >
              Layer {i + 1} · {Math.round(item.x)}, {Math.round(item.y)} · {Math.round(item.rotation)}°
              <span className="block truncate text-muted-foreground">{props.assets.find((asset) => asset.id === item.assetId)?.name ?? "Aset"}</span>
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
