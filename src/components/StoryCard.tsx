"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import type { SelectedPoint } from "./MapGlobe";
import type { CapsuleRendererHandle, CapsuleData } from "./CapsuleRenderer";

interface StoryCardProps {
  point: SelectedPoint;
  onClose: () => void;
  /** Ref du CapsuleRenderer (vit dans page.tsx) */
  capsuleRef?: React.RefObject<CapsuleRendererHandle | null>;
}

// ═══════════════════════════════════════════════════════════════════
//  STORY CARD — Glassmorphism draggable card
//  Positionnée sous la Tab Bar (top-left) avec 16px de marge.
//  Toute la surface est draggable. Bounding box = viewport.
// ═══════════════════════════════════════════════════════════════════

/** Marge Tab Bar: top(24) + hauteur estimée(56) + gap(16) */
const INITIAL_TOP = 96;
const INITIAL_LEFT = 24;
const CARD_WIDTH = 420;
const EDGE_PAD = 8;

export default function StoryCard({ point, onClose, capsuleRef }: StoryCardProps) {
  const [visible, setVisible] = useState(false);
  const [closing, setClosing] = useState(false);

  // ── Partage ────────────────────────────────────────────────────
  const [copied, setCopied] = useState(false);
  const [exporting, setExporting] = useState(false);

  // ── Drag state ────────────────────────────────────────────────
  const cardRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const offsetRef = useRef({ x: 0, y: 0 });
  const [pos, setPos] = useState({ x: INITIAL_LEFT, y: INITIAL_TOP });

  // Slide-in au montage
  useEffect(() => {
    const raf = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  // Reset position quand le point change
  useEffect(() => {
    setPos({ x: INITIAL_LEFT, y: INITIAL_TOP });
    setCopied(false);
  }, [point.id]);

  const handleClose = () => {
    setClosing(true);
    setTimeout(onClose, 280);
  };

  // ── Drag handlers avec bounding box ──────────────────────────
  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("button, a, input, textarea, select")) return;
    dragging.current = true;
    offsetRef.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [pos]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging.current) return;
    const card = cardRef.current;
    const cw = card ? card.offsetWidth : CARD_WIDTH;
    const ch = card ? card.offsetHeight : 300;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const rawX = e.clientX - offsetRef.current.x;
    const rawY = e.clientY - offsetRef.current.y;
    const x = Math.min(Math.max(rawX, EDGE_PAD), vw - cw - EDGE_PAD);
    const y = Math.min(Math.max(rawY, EDGE_PAD), vh - ch - EDGE_PAD);
    setPos({ x, y });
  }, []);

  const onPointerUp = useCallback(() => {
    dragging.current = false;
  }, []);

  // ── Partage : copier le lien ────────────────────────────────
  const handleCopyLink = useCallback(async () => {
    const param = point.kind === "history" ? "h" : "f";
    const url = `${window.location.origin}${window.location.pathname}?${param}=${point.id}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
      const ta = document.createElement("textarea");
      ta.value = url;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [point.id, point.kind]);

  // ── Partage : exporter en image ─────────────────────────────
  const handleExportImage = useCallback(async () => {
    if (!capsuleRef?.current) return;
    setExporting(true);
    try {
      const data: CapsuleData = {
        title: point.title || "Untitled",
        content: point.content || "",
        year: point.year,
        city: (point as any).city ?? "",
        country: (point as any).country ?? "",
        kind: point.kind,
      };
      const dataUrl = await capsuleRef.current.generate(data);

      // Télécharger
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = `left-behind-${point.id?.slice(0, 8) || "capsule"}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (err) {
      console.error("[StoryCard] Erreur export image:", err);
    } finally {
      setExporting(false);
    }
  }, [point, capsuleRef]);

  const isFragment = point.kind === "fragment";
  const accent = isFragment ? "#FFD700" : "#BB86FC";
  const accentDim = isFragment ? "rgba(255, 215, 0, 0.15)" : "rgba(187, 134, 252, 0.15)";
  const accentBorder = isFragment ? "rgba(255, 215, 0, 0.25)" : "rgba(187, 134, 252, 0.25)";

  // ── Couleur par catégorie historique ──────────────────────
  const CAT_COLORS: Record<string, string> = {
    shock: "#FF4444",
    civilization: "#4FC3F7",
    struggle: "#FFB74D",
    origins: "#E0E0E0",
  };
  const CAT_LABELS: Record<string, string> = {
    shock: "Choc",
    civilization: "Civilisation",
    struggle: "Luttes",
    origins: "Origines",
  };
  const CAT_EMOJIS: Record<string, string> = {
    shock: "💀",
    civilization: "🏛️",
    struggle: "✊",
    origins: "🌍",
  };

  const catKey = (point.category ?? "").toLowerCase();
  const catColor = !isFragment ? (CAT_COLORS[catKey] || accent) : accent;
  const catLabel = !isFragment ? (CAT_LABELS[catKey] || point.category || "History") : "";
  const catEmoji = !isFragment ? (CAT_EMOJIS[catKey] || "📍") : "";

  const displayTitle = isFragment
    ? (point.title || "A memory")
    : (point.title || "Historical Event");

  const subtitle = isFragment
    ? "Human Fragment"
    : (catLabel || point.category || "History");

  const body = point.content || "No additional information available.";

  return (
    <div
      ref={cardRef}
      className="fixed z-[201]"
      style={{
        left: `${pos.x}px`,
        top: `${pos.y}px`,
        width: `min(${CARD_WIDTH}px, calc(100vw - 48px))`,
        fontFamily: "'Montserrat', 'Inter', system-ui, sans-serif",
        animation: closing
          ? "storySlideOut 280ms ease-in forwards"
          : visible
            ? "storySlideIn 350ms cubic-bezier(0.16, 1, 0.3, 1) forwards"
            : "none",
        opacity: visible && !closing ? 1 : 0,
        cursor: dragging.current ? "grabbing" : "grab",
        userSelect: "none",
        touchAction: "none",
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <div
        style={{
          background: "rgba(10, 12, 18, 0.82)",
          backdropFilter: "blur(40px) saturate(1.6)",
          WebkitBackdropFilter: "blur(40px) saturate(1.6)",
          border: `1px solid ${accentBorder}`,
          borderRadius: "20px",
          boxShadow: `0 24px 64px rgba(0,0,0,0.5), 0 0 40px ${accentDim}`,
          maxHeight: "calc(100vh - 120px)",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Barre de couleur accent — catColor pour les historiques */}
        <div
          style={{
            height: "3px",
            flexShrink: 0,
            background: `linear-gradient(90deg, transparent, ${isFragment ? accent : catColor}, transparent)`,
            opacity: 0.7,
          }}
        />

        <div style={{ padding: "20px 24px 16px", display: "flex", flexDirection: "column", minHeight: 0, flex: 1 }}>
          {/* Header */}
          <div className="flex items-start justify-between gap-4 mb-3">
            <div className="flex-1 min-w-0">
              {/* Badge type — dot + label coloré par catégorie */}
              <div className="flex items-center gap-2 mb-2">
                <span
                  style={{
                    display: "inline-block",
                    width: "8px",
                    height: "8px",
                    borderRadius: "50%",
                    background: isFragment ? accent : catColor,
                    boxShadow: `0 0 8px ${isFragment ? accent : catColor}`,
                  }}
                />
                <span
                  style={{
                    fontSize: "10px",
                    fontWeight: 600,
                    letterSpacing: "0.1em",
                    textTransform: "uppercase",
                    color: isFragment ? accent : catColor,
                    opacity: 0.8,
                  }}
                >
                  {subtitle}
                </span>
              </div>

              {/* Année */}
              {point.year && (
                <div
                  style={{
                    fontSize: "24px",
                    fontWeight: 700,
                    letterSpacing: "-0.02em",
                    color: accent,
                    lineHeight: 1.1,
                    marginBottom: "4px",
                  }}
                >
                  {point.year}
                </div>
              )}

              {/* Titre */}
              <h3
                style={{
                  fontSize: "16px",
                  fontWeight: 700,
                  color: "rgba(255, 255, 255, 0.95)",
                  letterSpacing: "0.01em",
                  lineHeight: 1.3,
                  margin: 0,
                }}
              >
                {displayTitle}
              </h3>
            </div>

            {/* Bouton fermer */}
            <button
              onClick={handleClose}
              className="flex-shrink-0 flex items-center justify-center transition-all duration-200 hover:bg-white/10 active:scale-90"
              style={{
                width: "28px",
                height: "28px",
                borderRadius: "8px",
                border: "1px solid rgba(255,255,255,0.08)",
                background: "transparent",
                cursor: "pointer",
              }}
            >
              <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                <path d="M1 1L11 11M11 1L1 11" stroke="rgba(255,255,255,0.5)" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </div>

          {/* Séparateur */}
          <div
            style={{
              height: "1px",
              background: `linear-gradient(90deg, transparent, ${accentBorder}, transparent)`,
              marginBottom: "12px",
            }}
          />

          {/* Corps du texte — scrollable natif */}
          {body && (
            <div
              className={isFragment ? "story-scroll-gold" : "story-scroll-violet"}
              style={{
                maxHeight: "200px",
                overflowY: "auto" as const,
                paddingRight: "10px",
                whiteSpace: "pre-wrap" as const,
                fontSize: "13px",
                fontWeight: 300,
                color: "rgba(255, 255, 255, 0.7)",
                lineHeight: 1.7,
                letterSpacing: "0.01em",
                marginBottom: "12px",
                wordBreak: "break-word" as const,
                cursor: "text",
              }}
            >
              {body}
            </div>
          )}

          {/* ── Zone fixe (ne scroll pas) ────────────────────── */}
          <div style={{ flexShrink: 0 }}>
          {/* Category tag — coloré selon la catégorie pour les historiques */}
          {point.category && (
            <div className="flex items-center gap-2 mb-3">
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "5px",
                  padding: "3px 10px",
                  borderRadius: "100px",
                  border: `1px solid ${isFragment ? accentBorder : `${catColor}40`}`,
                  background: isFragment ? accentDim : `${catColor}1A`,
                  fontSize: "10px",
                  fontWeight: 600,
                  letterSpacing: "0.05em",
                  textTransform: "uppercase",
                  color: isFragment ? accent : catColor,
                }}
              >
                {!isFragment && catEmoji && <span style={{ fontSize: "11px" }}>{catEmoji}</span>}
                {isFragment ? point.category : catLabel || point.category}
              </span>
            </div>
          )}

          {/* Coordonnées */}
          <div
            style={{
              fontSize: "10px",
              fontWeight: 400,
              color: "rgba(255, 255, 255, 0.2)",
              letterSpacing: "0.03em",
              fontVariantNumeric: "tabular-nums",
              marginBottom: "14px",
            }}
          >
            {point.lat.toFixed(4)}°N, {point.lng.toFixed(4)}°E
          </div>

          {/* ── Section Partage ──────────────────────────────────── */}
          <div
            style={{
              borderTop: `1px solid ${accentBorder}`,
              paddingTop: "12px",
              display: "flex",
              gap: "10px",
            }}
          >
            {/* Copier le lien */}
            <button
              onClick={handleCopyLink}
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "6px",
                padding: "8px 12px",
                borderRadius: "10px",
                border: `1px solid ${copied ? accent : "rgba(255,255,255,0.1)"}`,
                background: copied ? "rgba(255,215,0,0.1)" : "rgba(255,255,255,0.04)",
                color: copied ? accent : "rgba(255,255,255,0.7)",
                fontSize: "11px",
                fontWeight: 500,
                fontFamily: "'Montserrat', system-ui, sans-serif",
                letterSpacing: "0.03em",
                cursor: "pointer",
                transition: "all 0.25s ease",
              }}
            >
              {copied ? (
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={accent} strokeWidth="2" strokeLinecap="round">
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                  Copié !
                </>
              ) : (
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <rect x="9" y="9" width="13" height="13" rx="2" />
                    <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                  </svg>
                  Copier le lien
                </>
              )}
            </button>

            {/* Exporter en image */}
            <button
              onClick={handleExportImage}
              disabled={exporting}
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "6px",
                padding: "8px 12px",
                borderRadius: "10px",
                border: `1px solid ${accentBorder}`,
                background: "rgba(255,215,0,0.06)",
                color: accent,
                fontSize: "11px",
                fontWeight: 500,
                fontFamily: "'Montserrat', system-ui, sans-serif",
                letterSpacing: "0.03em",
                cursor: exporting ? "wait" : "pointer",
                opacity: exporting ? 0.6 : 1,
                transition: "all 0.25s ease",
              }}
            >
              {exporting ? (
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={accent} strokeWidth="2" strokeLinecap="round" style={{ animation: "crownSpin 1s linear infinite" }}>
                    <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
                  </svg>
                  Export...
                </>
              ) : (
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" />
                  </svg>
                  Exporter en image
                </>
              )}
            </button>
          </div>
          </div>{/* fin zone fixe */}
        </div>
      </div>
    </div>
  );
}
