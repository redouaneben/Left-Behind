"use client";

import { forwardRef, useImperativeHandle, useRef } from "react";

// ═══════════════════════════════════════════════════════════════════
//  CAPSULE RENDERER
//  Rendu invisible (hors-écran) d'une image 1080×1080 "capsule"
//  pour le partage. Utilise html-to-image pour la capture.
// ═══════════════════════════════════════════════════════════════════

export interface CapsuleData {
  title: string;
  content: string;
  year: number | null;
  city?: string;
  country?: string;
  kind: "fragment" | "history";
}

export interface CapsuleRendererHandle {
  generate: (data: CapsuleData) => Promise<string>; // retourne un data URL
}

const SITE_URL = typeof window !== "undefined" ? window.location.origin : "leftbehind.app";

const CapsuleRenderer = forwardRef<CapsuleRendererHandle>((_, ref) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useImperativeHandle(ref, () => ({
    async generate(data: CapsuleData): Promise<string> {
      // Import dynamique pour ne pas alourdir le bundle
      const { toPng } = await import("html-to-image");

      const el = containerRef.current;
      if (!el) throw new Error("CapsuleRenderer non monté");

      // ── Construire le contenu ──────────────────────────────────
      const accent = data.kind === "fragment" ? "#FFD700" : "#BB86FC";
      const kindLabel = data.kind === "fragment" ? "Human Fragment" : "Historical Event";
      const locationParts: string[] = [];
      if (data.city) locationParts.push(data.city);
      if (data.country) locationParts.push(data.country);
      const locationStr = locationParts.length > 0 ? locationParts.join(", ") : "";
      const yearStr = data.year ? String(data.year) : "";
      const footer = [locationStr, yearStr].filter(Boolean).join(" — ");

      el.innerHTML = `
        <div style="
          width: 1080px; height: 1080px;
          background: #050505;
          display: flex; flex-direction: column;
          align-items: center; justify-content: center;
          position: relative;
          font-family: 'Montserrat', 'Inter', system-ui, sans-serif;
          color: #ffffffe6;
          overflow: hidden;
        ">
          <!-- Bordure dorée intérieure -->
          <div style="
            position: absolute;
            top: 10%; left: 10%; right: 10%; bottom: 10%;
            border: 1px solid ${accent}40;
            border-radius: 4px;
            pointer-events: none;
          "></div>

          <!-- Contenu centré -->
          <div style="
            max-width: 720px;
            padding: 0 80px;
            display: flex; flex-direction: column;
            align-items: center; justify-content: center;
            text-align: center;
            gap: 32px;
          ">
            <!-- Badge type -->
            <div style="
              font-size: 12px; font-weight: 600;
              letter-spacing: 0.25em; text-transform: uppercase;
              color: ${accent}; opacity: 0.8;
            ">${kindLabel}</div>

            <!-- Titre -->
            <div style="
              font-size: 36px; font-weight: 700;
              letter-spacing: 0.2em; text-transform: uppercase;
              line-height: 1.3;
              color: #FFFFFF;
            ">${data.title || "Untitled"}</div>

            <!-- Séparateur -->
            <div style="
              width: 60px; height: 1px;
              background: linear-gradient(90deg, transparent, ${accent}, transparent);
            "></div>

            <!-- Contenu avec guillemets -->
            <div style="
              font-size: 18px; font-weight: 300;
              line-height: 1.8;
              color: rgba(255,255,255,0.75);
              max-height: 400px;
              overflow: hidden;
            ">\u201C${(data.content || "").replace(/</g, "&lt;")}\u201D</div>
          </div>

          <!-- Footer -->
          <div style="
            position: absolute;
            bottom: 10%; left: 10%; right: 10%;
            display: flex; justify-content: space-between;
            align-items: center;
            font-size: 13px; font-weight: 400;
            color: rgba(255,255,255,0.35);
            letter-spacing: 0.05em;
          ">
            <span>${footer}</span>
            <span style="font-weight: 500; color: ${accent}80;">leftbehind.app</span>
          </div>
        </div>
      `;

      // Attendre un cycle de rendu pour que les polices se chargent
      await new Promise((r) => setTimeout(r, 200));

      // ── Capture ────────────────────────────────────────────────
      const dataUrl = await toPng(el.firstElementChild as HTMLElement, {
        width: 1080,
        height: 1080,
        pixelRatio: 1,
        fontEmbedCSS: `
          @import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@300;400;500;600;700&display=swap');
        `,
      });

      // Vider le conteneur
      el.innerHTML = "";

      return dataUrl;
    },
  }));

  return (
    <div
      ref={containerRef}
      aria-hidden
      style={{
        position: "fixed",
        top: "-9999px",
        left: "-9999px",
        width: "1080px",
        height: "1080px",
        overflow: "hidden",
        pointerEvents: "none",
        zIndex: -1,
      }}
    />
  );
});

CapsuleRenderer.displayName = "CapsuleRenderer";
export default CapsuleRenderer;
