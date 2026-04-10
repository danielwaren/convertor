import { useState, useRef, useCallback, useEffect } from "react";
import { supabase } from "../lib/supabase";
import type { User } from "@supabase/supabase-js";

// ─── Types ────────────────────────────────────────────────────────────────────

type Plan = "anonymous" | "free" | "pro";

type ConversionSettings = {
  quality: number;
  maxWidth: number;
  maxHeight: number;
};

type ConvertedImage = {
  blob: Blob;
  url: string;
  originalSize: number;
  convertedSize: number;
  width: number;
  height: number;
};

type UsageInfo = {
  used: number;
  limit: number;
  plan: Plan;
  allowed: boolean;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const DEFAULT_SETTINGS: ConversionSettings = {
  quality: 82,
  maxWidth: 1920,
  maxHeight: 1080,
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function getSavingsColor(pct: number): string {
  if (pct >= 50) return "text-emerald-400";
  if (pct >= 25) return "text-lime-400";
  if (pct >= 10) return "text-yellow-400";
  return "text-zinc-400";
}

async function getAuthHeader(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? `Bearer ${token}` : null;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function WebpConverter() {
  const [user, setUser] = useState<User | null>(null);
  const [usage, setUsage] = useState<UsageInfo | null>(null);
  const [settings, setSettings] = useState<ConversionSettings>(DEFAULT_SETTINGS);
  const [isDragging, setIsDragging] = useState(false);
  const [isConverting, setIsConverting] = useState(false);
  const [result, setResult] = useState<ConvertedImage | null>(null);
  const [customName, setCustomName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [isLoadingCheckout, setIsLoadingCheckout] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Auth listener
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setUser(data.session?.user ?? null));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  // Fetch usage whenever user changes
  useEffect(() => {
    fetchUsage();
  }, [user]);

  async function fetchUsage() {
    const authHeader = await getAuthHeader();
    const res = await fetch("/api/conversions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(authHeader ? { Authorization: authHeader } : {}),
      },
      body: JSON.stringify({ action: "check" }),
    });
    if (res.ok) {
      const data = await res.json();
      setUsage(data);
    }
  }

  async function signInWithGoogle() {
    await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: window.location.href } });
  }

  async function signInWithGitHub() {
    await supabase.auth.signInWithOAuth({ provider: "github", options: { redirectTo: window.location.href } });
  }

  async function signOut() {
    await supabase.auth.signOut();
    setResult(null);
    fetchUsage();
  }

  async function handleUpgradeToPro() {
    const authHeader = await getAuthHeader();
    if (!authHeader) return;
    setIsLoadingCheckout(true);
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { Authorization: authHeader },
      });
      const data = await res.json();
      if (data.checkout_url) {
        window.location.href = data.checkout_url;
      }
    } catch {
      setError("No se pudo iniciar el pago. Intenta de nuevo.");
    } finally {
      setIsLoadingCheckout(false);
    }
  }

  const convertToWebP = useCallback(async (file: File) => {
    if (!file.type.match(/^image\/(jpeg|jpg|png|webp|gif|bmp|tiff)$/i)) {
      setError("Formato no soportado. Usa JPG, PNG, WebP, GIF, BMP o TIFF.");
      return;
    }

    // Verificar límite antes de convertir
    const authHeader = await getAuthHeader();
    const checkRes = await fetch("/api/conversions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(authHeader ? { Authorization: authHeader } : {}),
      },
      body: JSON.stringify({ action: "increment" }),
    });

    if (checkRes.status === 429) {
      const data = await checkRes.json();
      setError(
        data.plan === "anonymous"
          ? "Límite diario alcanzado. Crea una cuenta gratis para obtener 10 conversiones/día."
          : "Límite diario alcanzado. Actualiza a Pro para conversiones ilimitadas."
      );
      return;
    }

    setIsConverting(true);
    setError(null);
    setResult(null);

    try {
      const originalSize = file.size;
      const img = new Image();
      const objectUrl = URL.createObjectURL(file);

      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("No se pudo cargar la imagen."));
        img.src = objectUrl;
      });
      URL.revokeObjectURL(objectUrl);

      let { width, height } = img;
      if (width > settings.maxWidth || height > settings.maxHeight) {
        const ratio = Math.min(settings.maxWidth / width, settings.maxHeight / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }

      const canvas = canvasRef.current!;
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);

      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (b) => { if (b) resolve(b); else reject(new Error("Error generando WebP.")); },
          "image/webp",
          settings.quality / 100
        );
      });

      const baseName = file.name.replace(/\.[^/.]+$/, "");
      setCustomName(baseName);
      setResult({ blob, url: URL.createObjectURL(blob), originalSize, convertedSize: blob.size, width, height });
      await fetchUsage();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido.");
    } finally {
      setIsConverting(false);
    }
  }, [settings]);

  const handleFile = (file: File) => convertToWebP(file);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const handleDownload = () => {
    if (!result) return;
    const name = (customName.trim() || "imagen").replace(/[^a-zA-Z0-9_\-áéíóúñÁÉÍÓÚÑ ]/g, "_");
    const a = document.createElement("a");
    a.href = result.url;
    a.download = `${name}.webp`;
    a.click();
  };

  const savingsPct = result
    ? Math.round(((result.originalSize - result.convertedSize) / result.originalSize) * 100)
    : 0;

  const limitLabel = usage
    ? usage.plan === "pro"
      ? "∞ ilimitadas"
      : usage.limit === Infinity
      ? "∞"
      : `${usage.used} / ${usage.limit} hoy`
    : "—";

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-mono">
      <canvas ref={canvasRef} className="hidden" />

      {/* ── Nav ── */}
      <nav className="border-b border-zinc-800 px-6 py-4 flex items-center justify-between max-w-5xl mx-auto">
        <div className="flex items-baseline gap-1">
          <span className="text-xl font-bold text-white tracking-tight">WebP</span>
          <span className="text-emerald-400 text-xl font-bold">Convert</span>
        </div>

        <div className="flex items-center gap-4">
          {usage && (
            <span className="text-xs text-zinc-500 hidden sm:block">
              {usage.plan === "pro" && <span className="text-emerald-400 font-bold mr-1">PRO</span>}
              {limitLabel}
            </span>
          )}

          {user ? (
            <div className="flex items-center gap-3">
              {usage?.plan !== "pro" && (
                <button
                  onClick={handleUpgradeToPro}
                  disabled={isLoadingCheckout}
                  className="text-xs bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-bold px-3 py-1.5 rounded-lg transition-colors"
                >
                  {isLoadingCheckout ? "..." : "↑ Pro $5/mes"}
                </button>
              )}
              <button
                onClick={signOut}
                className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                Salir
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <button
                onClick={signInWithGoogle}
                className="text-xs bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 px-3 py-1.5 rounded-lg transition-colors"
              >
                Google
              </button>
              <button
                onClick={signInWithGitHub}
                className="text-xs bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 px-3 py-1.5 rounded-lg transition-colors"
              >
                GitHub
              </button>
            </div>
          )}
        </div>
      </nav>

      {/* ── Hero ── */}
      <div className="max-w-2xl mx-auto px-4 pt-16 pb-10 text-center">
        <div className="inline-flex items-center gap-2 bg-zinc-900 border border-zinc-800 rounded-full px-4 py-1.5 mb-6">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-xs text-zinc-400">Procesado en tu navegador — sin subir archivos</span>
        </div>
        <h1 className="text-4xl sm:text-5xl font-bold text-white leading-tight tracking-tight mb-4">
          Convierte a <span className="text-emerald-400">WebP</span><br />sin publicidad
        </h1>
        <p className="text-zinc-400 text-base leading-relaxed max-w-lg mx-auto">
          JPG, PNG, GIF y más → WebP optimizadoooo para web.
          {!user && " 10 conversiones gratis al día con cuenta. Sin tarjeta."}
        </p>
      </div>

      {/* ── Converter ── */}
      <div className="max-w-2xl mx-auto px-4 pb-20">

        {/* Barra de uso */}
        {usage && usage.plan !== "pro" && (
          <div className="mb-5 bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 flex items-center justify-between gap-4">
            <div className="flex-1">
              <div className="flex justify-between text-xs text-zinc-500 mb-1.5">
                <span>Conversiones hoy</span>
                <span className="font-mono">{usage.used}/{usage.limit}</span>
              </div>
              <div className="w-full bg-zinc-800 rounded-full h-1.5">
                <div
                  className="bg-emerald-500 h-1.5 rounded-full transition-all duration-500"
                  style={{ width: `${Math.min((usage.used / usage.limit) * 100, 100)}%` }}
                />
              </div>
            </div>
            {usage.plan === "free" ? (
              <button
                onClick={handleUpgradeToPro}
                className="text-xs text-emerald-400 hover:text-emerald-300 whitespace-nowrap transition-colors"
              >
                Pro ilimitado →
              </button>
            ) : (
              <button
                onClick={signInWithGoogle}
                className="text-xs text-emerald-400 hover:text-emerald-300 whitespace-nowrap transition-colors"
              >
                Crear cuenta →
              </button>
            )}
          </div>
        )}

        {/* Drop zone */}
        <div
          className={`relative border-2 border-dashed rounded-xl transition-all duration-200 cursor-pointer
            ${isDragging ? "border-emerald-400 bg-emerald-950/20" : "border-zinc-700 bg-zinc-900 hover:border-zinc-500"}
            ${isConverting ? "pointer-events-none opacity-50" : ""}
          `}
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/jpg,image/png,image/gif,image/bmp,image/tiff,image/webp"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }}
          />
          <div className="flex flex-col items-center justify-center py-14 px-8 text-center gap-4">
            {isConverting ? (
              <>
                <div className="w-9 h-9 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin" />
                <p className="text-sm text-zinc-400">Procesando...</p>
              </>
            ) : (
              <>
                <svg className={`w-10 h-10 transition-colors ${isDragging ? "text-emerald-400" : "text-zinc-600"}`} fill="none" viewBox="0 0 48 48" stroke="currentColor" strokeWidth={1.5}>
                  <rect x="6" y="10" width="36" height="28" rx="4" />
                  <circle cx="17" cy="20" r="4" />
                  <path d="M6 32l9-9 7 7 5-5 8 8" strokeLinejoin="round" />
                  <path d="M30 6v10M26 10l4-4 4 4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <div>
                  <p className="text-zinc-300 text-sm font-medium">
                    {isDragging ? "Suelta aquí" : "Arrastra tu imagen o haz clic"}
                  </p>
                  <p className="text-zinc-600 text-xs mt-1">JPG · PNG · GIF · BMP · TIFF</p>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="mt-4 bg-red-950/50 border border-red-800 rounded-xl px-4 py-3 text-sm text-red-400 flex gap-2">
            <span>⚠</span>
            <span>{error}</span>
          </div>
        )}

        {/* Resultado */}
        {result && (
          <div className="mt-5 bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
            <div className="bg-zinc-800/40 p-4 flex justify-center">
              <img src={result.url} alt="Vista previa" className="max-h-52 max-w-full rounded-lg object-contain" />
            </div>

            <div className="grid grid-cols-3 divide-x divide-zinc-800 border-t border-zinc-800">
              {[
                { label: "Original", value: formatBytes(result.originalSize), color: "text-zinc-300" },
                { label: "WebP", value: formatBytes(result.convertedSize), color: "text-emerald-400" },
                { label: "Ahorro", value: savingsPct > 0 ? `−${savingsPct}%` : `+${Math.abs(savingsPct)}%`, color: getSavingsColor(savingsPct) },
              ].map(({ label, value, color }) => (
                <div key={label} className="px-4 py-4 text-center">
                  <p className="text-xs text-zinc-500 uppercase tracking-wider mb-1">{label}</p>
                  <p className={`text-base font-bold ${color}`}>{value}</p>
                </div>
              ))}
            </div>

            <div className="px-4 py-3 border-t border-zinc-800 text-xs text-zinc-500 flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
              {result.width} × {result.height}px · calidad {settings.quality}%
            </div>

            {/* Nombre de archivo */}
            <div className="px-4 pt-3 pb-2 border-t border-zinc-800">
              <label className="text-[11px] text-zinc-500 uppercase tracking-wider block mb-1.5">
                Nombre del archivo
              </label>
              <div className="flex">
                <input
                  type="text"
                  value={customName}
                  onChange={(e) => setCustomName(e.target.value)}
                  placeholder="nombre-imagen"
                  className="flex-1 bg-zinc-800 border border-zinc-700 border-r-0 rounded-l-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-emerald-500 font-mono"
                />
                <span className="bg-zinc-700 border border-zinc-700 border-l-0 rounded-r-lg px-3 py-2 text-sm text-zinc-400 select-none">
                  .webp
                </span>
              </div>
            </div>

            <div className="px-4 pb-4 pt-2 flex gap-3">
              <button
                onClick={handleDownload}
                className="flex-1 bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-bold text-sm py-2.5 px-4 rounded-lg transition-colors"
              >
                ↓ Descargar {(customName.trim() || "imagen")}.webp
              </button>
              <button
                onClick={() => { setResult(null); setError(null); }}
                className="bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm py-2.5 px-4 rounded-lg transition-colors"
              >
                Nueva
              </button>
            </div>
          </div>
        )}

        {/* Settings */}
        <div className="mt-6">
          <button
            onClick={() => setShowSettings((v) => !v)}
            className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors flex items-center gap-2"
          >
            <span className="w-3 h-px bg-current inline-block" />
            {showSettings ? "Ocultar" : "Configuración avanzada"}
            <span className={`transition-transform duration-200 inline-block ${showSettings ? "rotate-180" : ""}`}>▾</span>
          </button>

          {showSettings && (
            <div className="mt-4 bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-5">
              <div>
                <div className="flex justify-between mb-2">
                  <label className="text-xs text-zinc-400 uppercase tracking-wider">Calidad</label>
                  <span className="text-xs font-bold text-emerald-400">{settings.quality}%</span>
                </div>
                <input
                  type="range" min={10} max={100} step={1}
                  value={settings.quality}
                  onChange={(e) => setSettings((s) => ({ ...s, quality: +e.target.value }))}
                  className="w-full accent-emerald-400"
                />
                <p className="text-[11px] text-zinc-600 mt-1">82% = estándar web 2026</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {[{ key: "maxWidth", label: "Ancho máx (px)" }, { key: "maxHeight", label: "Alto máx (px)" }].map(({ key, label }) => (
                  <div key={key}>
                    <label className="text-[11px] text-zinc-600 block mb-1">{label}</label>
                    <input
                      type="number" min={100} max={8000}
                      value={settings[key as keyof ConversionSettings]}
                      onChange={(e) => setSettings((s) => ({ ...s, [key]: +e.target.value }))}
                      className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                {[
                  { label: "OG/Social", w: 1200, h: 630, q: 85 },
                  { label: "Full HD", w: 1920, h: 1080, q: 82 },
                  { label: "Thumbnail", w: 400, h: 300, q: 75 },
                  { label: "4K", w: 3840, h: 2160, q: 80 },
                ].map((p) => (
                  <button
                    key={p.label}
                    onClick={() => setSettings((s) => ({ ...s, maxWidth: p.w, maxHeight: p.h, quality: p.q }))}
                    className="text-xs bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 px-3 py-1.5 rounded-lg transition-colors"
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <button
                onClick={() => setSettings(DEFAULT_SETTINGS)}
                className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors"
              >
                ↺ Restaurar
              </button>
            </div>
          )}
        </div>

        {/* Trust signals */}
        <div className="mt-10 pt-6 border-t border-zinc-900 grid grid-cols-1 sm:grid-cols-3 gap-4 text-center">
          {[
            { icon: "🔒", title: "100% privado", desc: "Ningún archivo sale de tu dispositivo" },
            { icon: "⚡", title: "Instantáneo", desc: "Sin esperas, sin colas de servidor" },
            { icon: "🚫", title: "Sin publicidad", desc: "Monetizamos con suscripciones, no con ads" },
          ].map(({ icon, title, desc }) => (
            <div key={title} className="bg-zinc-900/50 rounded-xl p-4">
              <div className="text-2xl mb-2">{icon}</div>
              <p className="text-sm font-medium text-zinc-300">{title}</p>
              <p className="text-xs text-zinc-600 mt-1">{desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ── Pricing ── */}
      <section id="precios" className="max-w-2xl mx-auto px-4 pb-24">
        <h2 className="text-2xl font-bold text-center mb-2">Precios</h2>
        <p className="text-zinc-500 text-sm text-center mb-10">Sin sorpresas. Cancela cuando quieras.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Free */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
            <p className="text-sm text-zinc-400 mb-1">Gratis</p>
            <p className="text-3xl font-bold text-white mb-4">$0 <span className="text-base font-normal text-zinc-500">/siempre</span></p>
            <ul className="space-y-2 text-sm text-zinc-400">
              {["10 conversiones por día", "Todos los formatos de entrada", "Configuración avanzada", "Sin tarjeta de crédito"].map((f) => (
                <li key={f} className="flex items-center gap-2">
                  <span className="text-emerald-500 text-xs">✓</span> {f}
                </li>
              ))}
            </ul>
            <button
              onClick={signInWithGoogle}
              className="mt-6 w-full border border-zinc-700 hover:border-zinc-500 text-zinc-300 text-sm py-2.5 rounded-lg transition-colors"
            >
              Crear cuenta gratis
            </button>
          </div>
          {/* Pro */}
          <div className="bg-zinc-900 border-2 border-emerald-500/50 rounded-xl p-6 relative">
            <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-emerald-500 text-zinc-950 text-xs font-bold px-3 py-1 rounded-full">
              MÁS POPULAR
            </div>
            <p className="text-sm text-emerald-400 mb-1">Pro</p>
            <p className="text-3xl font-bold text-white mb-4">$5 <span className="text-base font-normal text-zinc-500">/mes USD</span></p>
            <ul className="space-y-2 text-sm text-zinc-400">
              {["Conversiones ilimitadas", "Todo lo del plan Free", "Soporte prioritario", "Cancela cuando quieras"].map((f) => (
                <li key={f} className="flex items-center gap-2">
                  <span className="text-emerald-500 text-xs">✓</span> {f}
                </li>
              ))}
            </ul>
            <button
              onClick={user ? handleUpgradeToPro : signInWithGoogle}
              disabled={isLoadingCheckout}
              className="mt-6 w-full bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-bold text-sm py-2.5 rounded-lg transition-colors"
            >
              {isLoadingCheckout ? "Redirigiendo..." : "Empezar con Pro"}
            </button>
          </div>
        </div>
      </section>

      {/* ── FAQ SEO ── */}
      <section className="max-w-2xl mx-auto px-4 pb-24">
        <h2 className="text-2xl font-bold mb-8 text-center">Preguntas frecuentes</h2>
        <div className="space-y-4">
          {[
            { q: "¿Qué es WebP y por qué usarlo?", a: "WebP es un formato de imagen moderno desarrollado por Google. Ofrece compresión superior al JPEG y PNG manteniendo la calidad visual, lo que se traduce en páginas web más rápidas y mejor posicionamiento en Google (Core Web Vitals)." },
            { q: "¿Mis imágenes se suben a algún servidor?", a: "No. Todo el procesamiento ocurre directamente en tu navegador usando la API Canvas de HTML5. Tus imágenes nunca salen de tu dispositivo." },
            { q: "¿Qué calidad de WebP debería usar?", a: "Para la web en 2026, recomendamos entre 80% y 85%. El valor por defecto de 82% es el punto óptimo entre calidad visual y peso del archivo." },
            { q: "¿WebP es compatible con todos los navegadores?", a: "Sí. WebP es compatible con Chrome, Firefox, Safari (desde 2020), Edge y todos los navegadores modernos. Tiene soporte global de más del 97% de usuarios." },
            { q: "¿Puedo convertir imágenes PNG con transparencia?", a: "Sí, aunque el fondo transparente se convierte a blanco en el WebP resultante. Si necesitas mantener transparencia, el formato WebP sí la soporta — próximamente añadiremos esa opción." },
          ].map(({ q, a }) => (
            <details key={q} className="group bg-zinc-900 border border-zinc-800 rounded-xl">
              <summary className="px-5 py-4 text-sm font-medium text-zinc-200 cursor-pointer list-none flex justify-between items-center">
                {q}
                <span className="text-zinc-500 group-open:rotate-45 transition-transform duration-200 text-lg leading-none">+</span>
              </summary>
              <p className="px-5 pb-4 text-sm text-zinc-400 leading-relaxed">{a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-zinc-900 py-8 text-center text-xs text-zinc-700">
        <p>WebP Convert · Procesamiento local · Sin publicidad · Pagos seguros con MercadoPago</p>
      </footer>
    </div>
  );
}
