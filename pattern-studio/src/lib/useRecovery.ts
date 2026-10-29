import { useEffect, useRef, useState } from "react";
import { encodeProject } from "./project";
import type { Project } from "./types";

export function useRecovery(project: Project) {
  const native = window.__TAURI__?.core;
  const [phase, setPhase] = useState<"checking" | "choice" | "ready">(native ? "checking" : "ready");
  const [contents, setContents] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(native ? "Memeriksa recovery..." : "Recovery otomatis tersedia di aplikasi desktop saja.");
  const [error, setError] = useState("");
  const latest = useRef(project);
  const observed = useRef(project);
  const ready = useRef(!native);
  const mounted = useRef(false);
  const epoch = useRef(0);
  const pending = useRef(false);
  const paused = useRef(false);
  const failed = useRef<"write" | "clear" | null>(null);
  const saved = useRef<Project | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const flight = useRef<Promise<void> | null>(null);
  latest.current = project;

  function cancelTimer() {
    window.clearTimeout(timer.current);
    timer.current = undefined;
  }

  function schedule() {
    if (!native || !mounted.current || !ready.current || paused.current || failed.current || !pending.current || flight.current || timer.current !== undefined) return;
    timer.current = window.setTimeout(() => { timer.current = undefined; write(); }, 2000);
  }

  function write() {
    if (!native || !mounted.current || !ready.current || paused.current || flight.current || !pending.current) return;
    cancelTimer();
    const snapshot = latest.current;
    setStatus("Menyimpan recovery terpisah...");
    const operation = Promise.resolve().then(async () => {
      try {
        await native.invoke<void>("write_recovery", { contents: encodeProject(snapshot) });
        pending.current = latest.current !== snapshot;
        if (mounted.current) setStatus(pending.current ? "Perubahan terbaru menunggu batch recovery berikutnya." : "Recovery terpisah tersimpan. File project utama tidak berubah.");
      } catch (cause) {
        pending.current = true;
        failed.current = "write";
        if (mounted.current) {
          setError(String(cause instanceof Error ? cause.message : cause));
          setStatus("Recovery gagal disimpan. Edit tetap di editor; recovery sebelumnya tetap dipertahankan. Coba lagi atau simpan .orsaven.");
        }
      }
    }).finally(() => {
      if (flight.current === operation) flight.current = null;
      schedule();
    });
    flight.current = operation;
  }

  async function discover() {
    if (!native) return;
    const request = ++epoch.current;
    ready.current = false;
    setPhase("checking");
    setBusy(true);
    setError("");
    setStatus("Membaca recovery terpisah...");
    try {
      const found = await native.invoke<string | null>("read_recovery");
      if (!mounted.current || request !== epoch.current) return;
      setContents(found);
      ready.current = found === null;
      setPhase(found === null ? "ready" : "choice");
      setStatus(found === null ? "Belum ada recovery. Perubahan berikutnya dicadangkan dalam batch 2 detik." : "Recovery ditemukan terpisah dari file project. Belum diterapkan. Pulihkan pekerjaan, atau buang recovery lalu buka .orsaven untuk versi tersimpan.");
    } catch (cause) {
      if (!mounted.current || request !== epoch.current) return;
      setPhase("choice");
      setContents(null);
      setError(String(cause instanceof Error ? cause.message : cause));
      setStatus("Recovery tidak dapat dibaca. Editor belum diubah. Coba baca lagi, atau buang recovery secara eksplisit.");
    } finally {
      if (mounted.current && request === epoch.current) setBusy(false);
    }
  }

  async function discard() {
    if (!native || busy) return;
    setBusy(true);
    setError("");
    setStatus("Membuang recovery...");
    try {
      await native.invoke<void>("discard_recovery");
      if (!mounted.current) return;
      pending.current = false;
      setContents(null);
      ready.current = true;
      setPhase("ready");
      setStatus("Recovery dibuang. File project utama tidak berubah. Buka .orsaven untuk melanjutkan versi tersimpan.");
    } catch (cause) {
      if (mounted.current) {
        setError(String(cause instanceof Error ? cause.message : cause));
        setStatus("Recovery gagal dibuang dan tetap dipertahankan. Coba baca atau buang lagi.");
      }
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  function restored(snapshot: Project) {
    latest.current = snapshot;
    observed.current = snapshot;
    pending.current = false;
    setContents(null);
    setError("");
    ready.current = true;
    setPhase("ready");
    setStatus("Dokumen dipulihkan dari recovery. Salinan recovery tetap ada. Simpan .orsaven untuk menyimpan ke file project.");
  }

  function restoreFailed(cause: unknown) {
    setError(String(cause instanceof Error ? cause.message : cause));
    setStatus("Recovery gagal dipulihkan. Dokumen dan file recovery tetap dipertahankan. Coba baca lagi atau buang recovery.");
  }

  async function savedProject(snapshot: Project) {
    if (!native) return;
    saved.current = snapshot;
    paused.current = true;
    cancelTimer();
    await flight.current;
    try {
      failed.current = null;
      setError("");
      if (latest.current !== snapshot) {
        pending.current = true;
        return;
      }
      await native.invoke<void>("discard_recovery");
      pending.current = latest.current !== snapshot;
      if (mounted.current) setStatus(pending.current ? "Perubahan terbaru belum dicadangkan; menunggu batch recovery berikutnya." : "Project tersimpan. Recovery lama sudah dibuang.");
    } catch (cause) {
      failed.current = "clear";
      if (mounted.current) {
        setError(String(cause instanceof Error ? cause.message : cause));
        setStatus("Project berhasil disimpan, tetapi recovery lama gagal dibuang. Coba lagi; file project tetap tersimpan.");
      }
    } finally {
      paused.current = false;
      schedule();
    }
  }

  function openedProject(snapshot: Project) {
    latest.current = snapshot;
    observed.current = snapshot;
    return savedProject(snapshot);
  }

  function retry() {
    if (paused.current) return;
    const previous = failed.current;
    failed.current = null;
    setError("");
    if (previous === "clear" && saved.current) void savedProject(saved.current);
    else { pending.current = true; write(); }
  }

  useEffect(() => {
    mounted.current = true;
    void discover();
    return () => {
      mounted.current = false;
      epoch.current++;
      cancelTimer();
    };
  }, []);

  useEffect(() => {
    if (observed.current === project) return;
    observed.current = project;
    if (!native || !ready.current) return;
    pending.current = true;
    if (!failed.current && !flight.current) setStatus("Perubahan terbaru belum dicadangkan; menunggu batch recovery 2 detik.");
    schedule();
  }, [project]);

  return { available: !!native, blocked: phase !== "ready", contents, busy, status, error, discover, discard, restored, restoreFailed, savedProject, openedProject, retry };
}
