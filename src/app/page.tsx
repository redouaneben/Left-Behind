"use client";

import MapGlobe from "@/components/MapGlobe";
import type { FragmentData, SelectedPoint, HistoricalEventDB } from "@/components/MapGlobe";
import { addFragmentToDB, fetchFragmentsFromDB, fetchHistoricalFromDB, reverseGeocode } from "@/components/MapGlobe";
import CreateFragment from "@/components/CreateFragment";
import StoryCard from "@/components/StoryCard";
import CapsuleRenderer from "@/components/CapsuleRenderer";
import type { CapsuleRendererHandle } from "@/components/CapsuleRenderer";
import { useState, useCallback, useEffect, useRef } from "react";
import { LANGS, I18N, type LangCode } from "@/lib/i18n";
import { LangProvider } from "@/lib/LangContext";

// ═══════════════════════════════════════════════════════════════════
//  STARFIELD CANVAS — Tunnel d'étoiles (centre → bords)
//  Chaque étoile a une position 3D (x, y, z). On projette en 2D
//  et on avance sur l'axe Z. Résultat = effet tunnel/warp.
// ═══════════════════════════════════════════════════════════════════
const STAR_COUNT = 600;
const BASE_SPEED = 0.4;
const WARP_SPEED = 8;
const WARP_DURATION = 1200; // ms

function useStarfield(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  warpActive: boolean
) {
  const starsRef = useRef<{ x: number; y: number; z: number }[]>([]);
  const speedRef = useRef(BASE_SPEED);
  const warpStartRef = useRef(0);
  const rafRef = useRef(0);
  // Couleur dynamique : blanc au repos → or pendant le warp
  const colorRef = useRef({ r: 255, g: 255, b: 255 }); // blanc initial

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Initialiser les étoiles
    const stars = starsRef.current;
    if (stars.length === 0) {
      for (let i = 0; i < STAR_COUNT; i++) {
        stars.push({
          x: (Math.random() - 0.5) * 1600,
          y: (Math.random() - 0.5) * 1600,
          z: Math.random() * 1500,
        });
      }
    }

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener("resize", resize);

    function draw() {
      if (!canvas || !ctx) return;
      const W = canvas.width;
      const H = canvas.height;
      const cx = W / 2;
      const cy = H / 2;

      // Fond noir avec traînée (motion blur)
      ctx.fillStyle = "rgba(0, 0, 0, 0.15)";
      ctx.fillRect(0, 0, W, H);

      const speed = speedRef.current;

      for (const star of stars) {
        star.z -= speed;

        // Recycler les étoiles qui passent derrière la caméra
        if (star.z <= 0.5) {
          star.x = (Math.random() - 0.5) * 1600;
          star.y = (Math.random() - 0.5) * 1600;
          star.z = 1500;
        }

        // Projection 2D
        const k = 300 / star.z;
        const sx = cx + star.x * k;
        const sy = cy + star.y * k;

        // Taille et opacité basées sur la profondeur
        const depth = 1 - star.z / 1500;
        const radius = Math.max(0.2, depth * 2.2);
        const opacity = Math.min(1, depth * 1.5);

        // Couleur dynamique (blanc → or pendant warp)
        const { r, g, b } = colorRef.current;

        // Traînée lumineuse en warp
        if (speed > 2) {
          const prevZ = star.z + speed;
          const pk = 300 / prevZ;
          const px = cx + star.x * pk;
          const py = cy + star.y * pk;
          ctx.beginPath();
          ctx.moveTo(px, py);
          ctx.lineTo(sx, sy);
          ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${opacity * 0.6})`;
          ctx.lineWidth = radius * 0.8;
          ctx.shadowColor = `rgba(${r}, ${g}, ${b}, 0.6)`;
          ctx.shadowBlur = 6;
          ctx.stroke();
          ctx.shadowBlur = 0;
        }

        // Point étoile
        ctx.beginPath();
        ctx.arc(sx, sy, radius, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${opacity})`;
        ctx.shadowColor = `rgba(${r}, ${g}, ${b}, 0.4)`;
        ctx.shadowBlur = 4;
        ctx.fill();
        ctx.shadowBlur = 0;
      }

      rafRef.current = requestAnimationFrame(draw);
    }

    draw();

    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", resize);
    };
  }, [canvasRef]);

  // Warp acceleration + transition couleur blanc → or
  useEffect(() => {
    if (!warpActive) return;
    warpStartRef.current = performance.now();

    const accelerate = () => {
      const elapsed = performance.now() - warpStartRef.current;
      const t = Math.min(1, elapsed / WARP_DURATION);
      // Ease-in-out cubic
      const ease = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      speedRef.current = BASE_SPEED + (WARP_SPEED - BASE_SPEED) * ease;

      // Transition couleur : blanc (255,255,255) → or (255,215,0)
      colorRef.current = {
        r: 255,
        g: Math.round(255 - (255 - 215) * ease),
        b: Math.round(255 - 255 * ease),
      };

      if (t < 1) {
        requestAnimationFrame(accelerate);
      }
    };
    accelerate();
  }, [warpActive]);
}

// ═══════════════════════════════════════════════════════════════════
//  PAGE PRINCIPALE
// ═══════════════════════════════════════════════════════════════════
export default function Home() {
  const [showLanding, setShowLanding] = useState(true);
  const [transitioning, setTransitioning] = useState(false);
  const [lang, setLang] = useState<LangCode>("en");
  const [showLangMenu, setShowLangMenu] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  useStarfield(canvasRef, transitioning);

  const t = I18N[lang];

  // ── Fragment flow ───────────────────────────────────────────────
  const [pendingCoords, setPendingCoords] = useState<{
    lng: number;
    lat: number;
  } | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [fragments, setFragments] = useState<FragmentData[]>([]);

  // ── Story Card (clic sur un point) ────────────────────────────
  const [selectedPoint, setSelectedPoint] = useState<SelectedPoint | null>(null);

  // ── Deep link — ?f=[id] ──────────────────────────────────────
  const [deepLinkFlyTo, setDeepLinkFlyTo] = useState<{ lng: number; lat: number; zoom?: number } | null>(null);
  const deepLinkHandled = useRef(false);

  // ── Capsule Renderer (génération d'image partageable) ────────
  const capsuleRef = useRef<CapsuleRendererHandle>(null);

  // ══════════════════════════════════════════════════════════════
  //  FETCH DIRECT AU MOUNT — ne dépend PAS de MapGlobe
  //  Garantit que les fragments sont là dès le F5.
  // ══════════════════════════════════════════════════════════════
  useEffect(() => {
    (async () => {
      try {
        const data = await fetchFragmentsFromDB();
        console.log("[page.tsx] Fragments chargés:", data.length, data);
        if (data.length > 0) {
          setFragments(data);
        }
      } catch (err) {
        console.error("[page.tsx] Erreur fetch fragments:", err);
      }
    })();
  }, []);

  // ── Deep link resolution — ?f=[id] (fragment) ou ?h=[id] (history) ──
  useEffect(() => {
    if (deepLinkHandled.current) return;
    const params = new URLSearchParams(window.location.search);
    const fId = params.get("f");
    const hId = params.get("h");
    if (!fId && !hId) return;

    // ── Fragment deep link ──
    if (fId && fragments.length > 0) {
      deepLinkHandled.current = true;
      const frag = fragments.find((f) => f.id === fId);
      if (!frag) {
        console.warn("[DeepLink] Fragment non trouvé:", fId);
        return;
      }
      console.log("[DeepLink] Fragment trouvé:", frag.title, frag.id);
      setShowLanding(false);
      setDeepLinkFlyTo({ lng: frag.lng, lat: frag.lat, zoom: 12 });
      setTimeout(() => {
        setSelectedPoint({
          kind: "fragment",
          id: frag.id,
          title: frag.title ?? "",
          year: frag.year,
          content: frag.content ?? "",
          category: frag.mood ?? "",
          lat: frag.lat,
          lng: frag.lng,
        });
      }, 800);
      return;
    }

    // ── Historical event deep link ──
    if (hId) {
      deepLinkHandled.current = true;
      // Fetch l'événement directement depuis Supabase
      (async () => {
        try {
          const events = await fetchHistoricalFromDB();
          const evt = events.find((e) => String(e.id) === hId);
          if (!evt) {
            console.warn("[DeepLink] Événement historique non trouvé:", hId);
            return;
          }
          console.log("[DeepLink] Événement historique trouvé:", evt.title, evt.id);
          setShowLanding(false);
          setDeepLinkFlyTo({ lng: evt.lng, lat: evt.lat, zoom: 12 });
          setTimeout(() => {
            setSelectedPoint({
              kind: "history",
              id: String(evt.id),
              title: evt.title ?? "",
              year: evt.year ?? null,
              content: evt.description ?? "",
              category: evt.category ?? "",
              lat: evt.lat,
              lng: evt.lng,
            });
          }, 800);
        } catch (err) {
          console.error("[DeepLink] Erreur fetch historical:", err);
        }
      })();
    }
  }, [fragments]);

  const handleRequestFragment = useCallback(
    (coords: { lng: number; lat: number }) => {
      setPendingCoords(coords);
      setShowForm(true);
    },
    []
  );

  const handleConfirmFragment = useCallback(
    async (data: {
      year: number;
      title: string;
      text: string;       // reçu du formulaire comme "text" → envoyé comme "content"
      mood: string;
      coords: { lng: number; lat: number };
    }) => {
      // ── UI OPTIMISTE : le point apparaît instantanément ────────
      const optimisticId = `frag-${Date.now()}`;
      const optimistic: FragmentData = {
        id: optimisticId,
        lat: data.coords.lat,
        lng: data.coords.lng,
        year: data.year,
        title: data.title,
        content: data.text,
        mood: data.mood,
        isNew: true,  // ← déclenche le flash de naissance sur le globe
      };
      setFragments((prev) => [...prev, optimistic]);
      setPendingCoords(null);
      // FORCE le maintien du composant pour voir l'animation (500ms non-négociable)
      setTimeout(() => setShowForm(false), 500);

      // ── Reverse Geocoding (city + country) ─────────────────────
      let geo = { city: "", country: "" };
      try {
        geo = await reverseGeocode(data.coords.lat, data.coords.lng);
      } catch (err) {
        console.warn("[reverseGeocode] Impossible de géocoder:", err);
      }

      // ── Persister en arrière-plan dans Supabase ────────────────
      try {
        const saved = await addFragmentToDB(
          data.coords.lat,
          data.coords.lng,
          data.year,
          data.title,
          data.text,
          data.mood,
          geo.city,
          geo.country
        );
        if (saved) {
          // Remplacer l'optimistic par la vraie donnée (avec le vrai id + city/country)
          setFragments((prev) =>
            prev.map((f) => (f.id === optimisticId ? saved : f))
          );
        }
      } catch (err) {
        console.warn("[Supabase:addFragment] Fallback local utilisé", err);
      }

      // ── Rafraîchir tous les fragments depuis Supabase ──────────
      try {
        const fresh = await fetchFragmentsFromDB();
        if (fresh.length > 0) {
          setFragments(fresh);
          console.log("[page.tsx] Fragments rafraîchis après ajout:", fresh.length);
        }
      } catch (err) {
        console.warn("[page.tsx] Échec du refresh post-ajout:", err);
      }
    },
    []
  );

  /** Callback quand MapGlobe charge les fragments depuis Supabase au démarrage */
  const handleLoadFragments = useCallback((frags: FragmentData[]) => {
    setFragments(frags);
  }, []);

  // Cancel : CreateFragment joue son animation, on attend 500ms avant démontage
  const handleCancelFragment = useCallback(() => {
    setPendingCoords(null);
    setTimeout(() => setShowForm(false), 500);
  }, []);

  // ── Transition : Hyper-espace → Terre ───────────────────────────
  const handleStart = () => {
    setTransitioning(true);
    // Warp pendant 1.2s, puis cross-fade landing → globe
    setTimeout(() => {
      setShowLanding(false);
    }, 1400);
  };

  return (
    <LangProvider lang={lang}>
    <main
      className="relative w-screen h-screen overflow-hidden bg-black"
      style={{ fontFamily: "'Montserrat', 'Inter', system-ui, sans-serif" }}
    >
      {/* ═══════════════════════════════════════════════════════════
          GLOBE — toujours monté (préchargé derrière la landing)
         ═══════════════════════════════════════════════════════════ */}
      <div
        className={`absolute inset-0 ${
          transitioning && !showLanding ? "globe-enter" : ""
        }`}
        style={{
          opacity: showLanding ? 0 : undefined,
        }}
      >
        <MapGlobe
          onFirstInteraction={() => {}}
          onRequestFragment={handleRequestFragment}
          pendingSpotCoords={pendingCoords}
          fragments={fragments}
          onLoadFragments={handleLoadFragments}
          onSelectPoint={setSelectedPoint}
          showTabBar={!showLanding}
          highlightCoords={selectedPoint ? { lng: selectedPoint.lng, lat: selectedPoint.lat } : null}
          highlightKind={selectedPoint?.kind ?? null}
          flyToCoords={deepLinkFlyTo}
        />
      </div>

      {/* ═══════════════════════════════════════════════════════════
          LANDING — Starfield Tunnel + Typographie flottante
         ═══════════════════════════════════════════════════════════ */}
      {showLanding && (
        <div
          className={`absolute inset-0 z-50 ${transitioning ? "landing-exit" : ""}`}
        >
          {/* Canvas starfield — étoiles du centre vers les bords */}
          <canvas
            ref={canvasRef}
            className="absolute inset-0 w-full h-full"
            style={{ background: "#000" }}
          />

          {/* ── Langue + Footer — tout en bas ──────────────────── */}
          <div
            className="absolute bottom-5 left-1/2 -translate-x-1/2 z-[10] flex items-center gap-4"
          >
            {/* Sélecteur de langue discret */}
            <div className="relative">
              <button
                onClick={() => setShowLangMenu((v) => !v)}
                className="lang-btn flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all duration-300"
                style={{
                  fontSize: "11px",
                  fontWeight: 500,
                  letterSpacing: "0.04em",
                  background: "transparent",
                  border: "1px solid rgba(255,255,255,0.15)",
                  color: "#FFFFFF",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.color = "#FFD700"; e.currentTarget.style.borderColor = "rgba(255,215,0,0.3)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = "#FFFFFF"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.15)"; }}
              >
                {LANGS.find((l) => l.code === lang)?.label}
                <svg
                  width="7" height="4" viewBox="0 0 7 4" fill="none"
                  className={`transition-transform duration-200 ${showLangMenu ? "rotate-180" : ""}`}
                >
                  <path d="M0.5 0.5L3.5 3.5L6.5 0.5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>

              {showLangMenu && (
                <div
                  className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 min-w-[140px] rounded-xl overflow-hidden z-[61]"
                  style={{
                    background: "rgba(0, 0, 0, 0.9)",
                    backdropFilter: "blur(20px)",
                    border: "1px solid rgba(255,255,255,0.08)",
                  }}
                >
                  {LANGS.map((l) => (
                    <button
                      key={l.code}
                      onClick={() => { setLang(l.code); setShowLangMenu(false); }}
                      className="w-full text-left px-3.5 py-2 transition-all duration-150 hover:bg-white/[0.06]"
                      style={{
                        fontSize: "11px",
                        fontWeight: lang === l.code ? 600 : 400,
                        color: lang === l.code ? "#fff" : "rgba(255,255,255,0.4)",
                        borderTop: l.code !== "en" ? "1px solid rgba(255,255,255,0.04)" : "none",
                      }}
                    >
                      {l.label}
                    </button>
                  ))}
                </div>
              )}

              {showLangMenu && (
                <div
                  className="fixed inset-0 z-[59]"
                  onClick={() => setShowLangMenu(false)}
                />
              )}
            </div>

            <span style={{ fontSize: "10px", color: "#FFD700", letterSpacing: "0.06em", textTransform: "uppercase", fontWeight: 600, textShadow: "0px 1px 3px rgba(0,0,0,0.8)" }}>
              {t.anonymous_badge}
            </span>
          </div>

          {/* ── Bouton d'aide "?" — bas-droite, minimaliste ────────── */}
          <div className="absolute bottom-5 right-5 z-[12]">
            <button
              onClick={() => setShowHelp((v) => !v)}
              className="w-10 h-10 flex items-center justify-center transition-all duration-300 hover:scale-110"
              style={{
                background: "transparent",
                color: "#FFFFFF",
                fontSize: "20px",
                fontWeight: 700,
                border: "none",
                cursor: "pointer",
                textShadow: "0 2px 8px rgba(0,0,0,0.6)",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.color = "#FFD700"; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = "#FFFFFF"; }}
            >
              ?
            </button>

            {/* Popover */}
            {showHelp && (
              <div
                className="absolute bottom-14 right-0 w-[280px] rounded-2xl p-5 z-[13]"
                style={{
                  background: "rgba(8, 10, 16, 0.92)",
                  backdropFilter: "blur(20px)",
                  WebkitBackdropFilter: "blur(20px)",
                  border: "1px solid rgba(255,215,0,0.2)",
                  boxShadow: "0 12px 40px rgba(0,0,0,0.6)",
                }}
              >
                <p style={{ fontSize: "13px", fontWeight: 600, color: "#FFD700", marginBottom: "10px", letterSpacing: "0.02em" }}>
                  {t.help_concept_title}
                </p>
                <p style={{ fontSize: "12px", color: "rgba(255,255,255,0.7)", lineHeight: 1.7, marginBottom: "14px" }}>
                  {t.help_concept_text}
                </p>
                <p style={{ fontSize: "13px", fontWeight: 600, color: "#FFD700", marginBottom: "10px", letterSpacing: "0.02em" }}>
                  {t.help_how_title}
                </p>
                <p style={{ fontSize: "12px", color: "rgba(255,255,255,0.7)", lineHeight: 1.7 }}>
                  {t.help_how_text}
                </p>
              </div>
            )}

            {showHelp && (
              <div
                className="fixed inset-0 z-[11]"
                onClick={() => setShowHelp(false)}
              />
            )}
          </div>

          {/* ── Typographie flottante — directement sur les étoiles ── */}
          <div className="absolute inset-0 z-[5] flex items-center justify-center pointer-events-none">
            <div
              className="flex flex-col items-center text-center pointer-events-auto"
              style={{
                padding: "48px 64px",
                backdropFilter: "blur(6px)",
                WebkitBackdropFilter: "blur(6px)",
                borderRadius: "40px",
              }}
            >
              {/* Titre */}
              <h1
                className="whitespace-nowrap"
                style={{
                  fontSize: "clamp(2.2rem, 6vw, 4rem)",
                  fontWeight: 700,
                  letterSpacing: "0.5em",
                  textTransform: "uppercase",
                  lineHeight: 1,
                  color: "#FFFFFF",
                  marginBottom: "24px",
                  textShadow: "0px 2px 4px rgba(0,0,0,0.8)",
                }}
              >
                LEFT BEHIND
              </h1>

              {/* Sous-titre — Thin / Light */}
              <p
                style={{
                  fontSize: "clamp(0.85rem, 1.8vw, 1rem)",
                  fontWeight: 200,
                  color: "#FFFFFF",
                  letterSpacing: "0.04em",
                  lineHeight: 1.7,
                  marginBottom: "20px",
                  maxWidth: "480px",
                  textShadow: "0px 2px 4px rgba(0,0,0,0.8)",
                }}
              >
                {t.subtitle}
              </p>

              {/* Corps — blanc, seul "anonymous" en jaune */}
              <p
                style={{
                  fontSize: "13px",
                  fontWeight: 400,
                  color: "#FFFFFF",
                  lineHeight: 1.8,
                  letterSpacing: "0.01em",
                  maxWidth: "440px",
                  marginBottom: "36px",
                  textShadow: "0px 2px 4px rgba(0,0,0,0.8)",
                }}
              >
                {t.body.split(/(anonymous|anonym|anonyme|anónimo|anônimo|匿名)/i).map((part, i) =>
                  /anonymous|anonym|anonyme|anónimo|anônimo|匿名/i.test(part)
                    ? <span key={i} style={{ color: "#FFFFFF", fontWeight: 600 }}>{part}</span>
                    : part
                )}
              </p>

              {/* Bouton GET STARTED */}
              <button
                onClick={handleStart}
                className="landing-cta-btn active:scale-[0.97]"
                style={{
                  padding: "14px 52px",
                  fontSize: "13px",
                  fontWeight: 600,
                  letterSpacing: "0.12em",
                  textTransform: "uppercase",
                  color: "rgba(255,255,255,0.8)",
                  background: "rgba(255,255,255,0.05)",
                  border: "1px solid rgba(255,255,255,0.2)",
                  borderRadius: "14px",
                  boxShadow: "none",
                  cursor: "pointer",
                  backdropFilter: "blur(12px)",
                  WebkitBackdropFilter: "blur(12px)",
                }}
              >
                {t.cta}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════
          MODAL de création de fragment
         ═══════════════════════════════════════════════════════════ */}
      {showForm && pendingCoords && (
        <CreateFragment
          coords={pendingCoords}
          onClose={handleCancelFragment}
          onSubmit={handleConfirmFragment}
        />
      )}

      {/* ═══════════════════════════════════════════════════════════
          STORY CARD — affichée quand on clique sur un point
         ═══════════════════════════════════════════════════════════ */}
      {selectedPoint && (
        <StoryCard
          point={selectedPoint}
          onClose={() => setSelectedPoint(null)}
          capsuleRef={capsuleRef}
        />
      )}

      {/* Rendu invisible pour génération d'image partageable */}
      <CapsuleRenderer ref={capsuleRef} />
    </main>
    </LangProvider>
  );
}
