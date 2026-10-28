import type { Asset, PatternItem, TileSettings } from "../lib/types";

interface Props {
  item: PatternItem | null;
  assets: Asset[];
  tile: TileSettings;
  onPatchItem: (patch: Partial<PatternItem>) => void;
  onPatchTile: (patch: Partial<TileSettings>) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onMoveLayer: (dir: 1 | -1) => void;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="lh-label">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

export default function PropertiesPanel(props: Props) {
  const { item, tile } = props;
  const asset = item ? props.assets.find((a) => a.id === item.assetId) : undefined;

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-3">
      <div>
        <h2 className="lh-label mb-2">Tile</h2>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Lebar (px)">
            <input
              type="number"
              min={64}
              max={4096}
              value={tile.width}
              onChange={(e) => props.onPatchTile({ width: Math.max(64, Number(e.target.value) || 64) })}
            />
          </Field>
          <Field label="Tinggi (px)">
            <input
              type="number"
              min={64}
              max={4096}
              value={tile.height}
              onChange={(e) => props.onPatchTile({ height: Math.max(64, Number(e.target.value) || 64) })}
            />
          </Field>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <Field label="Repeat">
            <select
              value={tile.repeat}
              onChange={(e) => props.onPatchTile({ repeat: e.target.value as TileSettings["repeat"] })}
            >
              <option value="grid">Grid</option>
              <option value="brick">Brick</option>
              <option value="half-drop">Half-drop</option>
              <option value="mirror">Mirror</option>
            </select>
          </Field>
          <Field label="Background preview">
            <select
              value={tile.background}
              onChange={(e) => props.onPatchTile({ background: e.target.value as TileSettings["background"] })}
            >
              <option value="checker">Checker (transparan)</option>
              <option value="dark">Gelap</option>
              <option value="light">Terang</option>
            </select>
          </Field>
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
          Tile yang seamless: item yang keluar dari satu sisi akan muncul di sisi berlawanan.
        </p>
      </div>

      <div className="border-t border-border pt-3">
        <h2 className="lh-label mb-2">Item Terpilih</h2>
        {!item && <p className="text-[12px] text-muted-foreground">Pilih item di canvas atau tombol Layers. Gunakan Tab untuk menjangkau kontrol.</p>}
        {item && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2 rounded-lg border border-border bg-card p-2">
              {asset && <img src={asset.src} alt={asset.name} className="h-10 w-10 object-contain" />}
              <div>
                <div className="text-[13px]">{asset?.name ?? "Aset"}</div>
                <div className="text-[11px] text-muted-foreground">
                  {Math.round(item.x)}, {Math.round(item.y)}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <Field label="X">
                <input
                  type="number"
                  value={Math.round(item.x)}
                  onChange={(e) => props.onPatchItem({ x: Number(e.target.value) || 0 })}
                />
              </Field>
              <Field label="Y">
                <input
                  type="number"
                  value={Math.round(item.y)}
                  onChange={(e) => props.onPatchItem({ y: Number(e.target.value) || 0 })}
                />
              </Field>
            </div>

            <Field label={`Rotasi: ${Math.round(item.rotation)}°`}>
              <input
                type="range"
                aria-label="Rotasi"
                min={-180}
                max={180}
                value={item.rotation}
                onChange={(e) => props.onPatchItem({ rotation: Number(e.target.value) })}
              />
            </Field>
            <Field label={`Skala: ${Math.round(item.scale * 100)}%`}>
              <input
                type="range"
                aria-label="Skala"
                min={10}
                max={300}
                value={Math.round(item.scale * 100)}
                onChange={(e) => props.onPatchItem({ scale: Number(e.target.value) / 100 })}
              />
            </Field>
            <Field label={`Opacity: ${Math.round(item.opacity * 100)}%`}>
              <input
                type="range"
                aria-label="Opacity"
                min={0}
                max={100}
                value={Math.round(item.opacity * 100)}
                onChange={(e) => props.onPatchItem({ opacity: Number(e.target.value) / 100 })}
              />
            </Field>

            <div className="grid grid-cols-2 gap-2">
              <button
                className={`rounded-lg border px-2 py-2 ${item.flipX ? "border-ring bg-accent" : "border-border bg-card"}`}
                aria-pressed={item.flipX}
                onClick={() => props.onPatchItem({ flipX: !item.flipX })}
              >
                Flip Horizontal
              </button>
              <button
                className={`rounded-lg border px-2 py-2 ${item.flipY ? "border-ring bg-accent" : "border-border bg-card"}`}
                aria-pressed={item.flipY}
                onClick={() => props.onPatchItem({ flipY: !item.flipY })}
              >
                Flip Vertikal
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button className="rounded-lg border border-border bg-card px-2 py-2" onClick={() => props.onMoveLayer(-1)}>
                Layer ke bawah
              </button>
              <button className="rounded-lg border border-border bg-card px-2 py-2" onClick={() => props.onMoveLayer(1)}>
                Layer ke atas
              </button>
              <button className="rounded-lg border border-border bg-card px-2 py-2" onClick={props.onDuplicate}>
                Duplikat
              </button>
              <button className="rounded-lg border border-border bg-[#2a1a1a] px-2 py-2" onClick={props.onDelete}>
                Hapus item
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
