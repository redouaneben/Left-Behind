"use client";

import { useState, useEffect, useRef } from "react";

// ═══════════════════════════════════════════════════════════════════
//  MODAL « Leave a Fragment »
//  Animation : fade-in au montage, fade+scale(0.9) à la fermeture.
//  Le composant gère sa propre animation puis notifie le parent.
// ═══════════════════════════════════════════════════════════════════

interface CreateFragmentProps {
  coords: { lng: number; lat: number };
  onClose: () => void;
  onSubmit: (fragment: {
    year: number;
    title: string;
    text: string;
    mood: string;
    coords: { lng: number; lat: number };
  }) => void;
}

const MOODS = [
  { emoji: "\u2728", label: "Joie" },
  { emoji: "\uD83D\uDCA7", label: "M\u00e9lancolie" },
  { emoji: "\uD83D\uDD25", label: "Passion" },
  { emoji: "\uD83C\uDF3F", label: "S\u00e9r\u00e9nit\u00e9" },
  { emoji: "\uD83C\uDF0C", label: "Myst\u00e8re" },
  { emoji: "\u26A1", label: "\u00c9nergie" },
];

const currentYear = new Date().getFullYear();
const ANIM_MS = 350; // durée de l'animation de fermeture (synchro CSS, 300ms anim + 50ms buffer)

export default function CreateFragment({
  coords,
  onClose,
  onSubmit,
}: CreateFragmentProps) {
  const [year, setYear] = useState<number | "">(currentYear);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [mood, setMood] = useState(MOODS[0].label);

  // ── Animation ─────────────────────────────────────────────────
  const [isClosing, setIsClosing] = useState(false);
  const [mounted, setMounted] = useState(false);
  const closingRef = useRef(false);

  // Fade-in au montage
  useEffect(() => {
    const raf = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  const yearValid = typeof year === "number" && year >= 1 && year <= currentYear;
  const canSubmit = yearValid && title.trim().length > 0 && text.trim().length > 0;

  // Déclenche l'animation CSS de sortie, puis appelle le callback
  const startClose = (callback: () => void) => {
    if (closingRef.current) return;
    closingRef.current = true;
    setIsClosing(true);
    setTimeout(callback, ANIM_MS);
  };

  const handleClose = () => startClose(onClose);

  const handleSubmit = () => {
    if (!canSubmit || typeof year !== "number") return;
    const data = { year, title: title.trim(), text: text.trim(), mood, coords };
    startClose(() => onSubmit(data));
  };

  // Entrée : monté ET pas en fermeture
  const show = mounted && !isClosing;

  return (
    <div
      className={`fixed inset-0 z-[200] flex items-center justify-center ${isClosing ? "form-overlay-exit" : ""}`}
      style={{
        opacity: show ? 1 : 0,
        transition: !isClosing ? `opacity ${ANIM_MS}ms ease` : undefined,
      }}
    >
      {/* Fond assombri */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={handleClose}
      />

      {/* Carte modale — animation CSS pure pour la sortie */}
      <div
        className={`relative w-full max-w-md mx-4 p-6 rounded-3xl bg-gradient-to-b from-white/[0.08] to-white/[0.03] border border-white/[0.08] backdrop-blur-2xl shadow-[0_0_80px_rgba(0,0,0,0.8)] ${isClosing ? "form-exit" : ""}`}
        style={!isClosing ? {
          transform: show ? "scale(1)" : "scale(0.92)",
          opacity: show ? 1 : 0,
          transition: `transform ${ANIM_MS}ms cubic-bezier(0.16, 1, 0.3, 1), opacity ${ANIM_MS}ms ease`,
        } : undefined}
      >
        {/* En-tete */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-white text-lg font-semibold tracking-wide">
            Ancrer un souvenir
          </h2>
          <button
            onClick={handleClose}
            className="text-white/40 hover:text-white/80 transition-colors text-xl leading-none"
          >
            &times;
          </button>
        </div>

        {/* Annee */}
        <div className="mb-5">
          <label className="block text-[10px] text-white/30 uppercase tracking-widest mb-2">
            Ann&eacute;e <span className="text-amber-400/60">*</span>
          </label>
          <input
            type="number"
            min={1}
            max={currentYear}
            value={year}
            onChange={(e) => {
              const v = e.target.value;
              setYear(v === "" ? "" : parseInt(v, 10));
            }}
            placeholder="ex: 1998, 2024..."
            className="w-full px-4 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.06] text-white/90 text-sm font-mono placeholder-white/20 outline-none focus:border-amber-400/30 transition-colors [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
          />
          {typeof year === "number" && !yearValid && (
            <p className="text-red-400/70 text-[10px] mt-1">
              Entrez une ann&eacute;e entre 1 et {currentYear}
            </p>
          )}
        </div>

        {/* Titre */}
        <div className="mb-5">
          <label className="block text-[10px] text-white/30 uppercase tracking-widest mb-2">
            Titre <span className="text-amber-400/60">*</span>
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Un mot, une phrase pour nommer ce souvenir..."
            maxLength={100}
            className="w-full px-4 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.06] text-white/90 text-sm placeholder-white/20 outline-none focus:border-amber-400/30 transition-colors"
          />
        </div>

        {/* Humeur */}
        <div className="mb-5">
          <p className="text-[10px] text-white/30 uppercase tracking-widest mb-2">
            Humeur
          </p>
          <div className="flex gap-2 flex-wrap">
            {MOODS.map((m) => (
              <button
                key={m.label}
                onClick={() => setMood(m.label)}
                className={`px-3 py-1.5 rounded-full text-xs transition-all ${
                  mood === m.label
                    ? "bg-white/15 text-white border border-white/20"
                    : "bg-white/[0.04] text-white/50 border border-transparent hover:bg-white/[0.08]"
                }`}
              >
                {m.emoji} {m.label}
              </button>
            ))}
          </div>
        </div>

        {/* Souvenir */}
        <div className="mb-5">
          <label className="block text-[10px] text-white/30 uppercase tracking-widest mb-2">
            Souvenir <span className="text-amber-400/60">*</span>
          </label>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Qu'est-ce que tu laisses ici ?..."
            maxLength={500}
            rows={4}
            className="w-full px-4 py-3 rounded-2xl bg-white/[0.04] border border-white/[0.06] text-white/90 text-sm placeholder-white/20 resize-none outline-none focus:border-white/15 transition-colors"
          />
          <div className="flex justify-end mt-1">
            <span className="text-white/20 text-[10px]">
              {text.length}/500
            </span>
          </div>
        </div>

        {/* GPS */}
        <div className="mb-5 px-3 py-2 rounded-xl bg-white/[0.03] border border-white/[0.04]">
          <p className="text-[9px] text-white/20 uppercase tracking-widest mb-0.5">
            Coordonn&eacute;es GPS
          </p>
          <p className="text-white/40 text-[11px] font-mono">
            {coords.lat.toFixed(4)}&deg;, {coords.lng.toFixed(4)}&deg;
          </p>
        </div>

        {/* Boutons */}
        <div className="flex items-center justify-between">
          <button
            onClick={handleClose}
            className="text-white/40 hover:text-white/70 text-[11px] uppercase tracking-wider transition-colors"
          >
            Annuler
          </button>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="px-6 py-2.5 rounded-xl bg-amber-400 text-black text-[11px] font-bold uppercase tracking-wide hover:bg-amber-300 hover:shadow-[0_0_20px_rgba(255,215,0,0.4)] transition-all duration-200 active:scale-[0.95] active:shadow-[0_0_30px_rgba(255,215,0,0.6)] disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:shadow-none"
          >
            Ancrer le fragment
          </button>
        </div>
      </div>
    </div>
  );
}
