"use client";

import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import type { WikiEvent, WikiCategory } from "@/lib/wikipedia";
import { prepareQuizQuestion, calculatePoints } from "@/lib/gameEngine";
import type { QuizQuestion, QuizResult } from "@/lib/gameEngine";
import { useLang } from "@/lib/LangContext";

// ─────────────────────────────────────────────────────────────────
//  COLLECTION — Persistance localStorage
// ─────────────────────────────────────────────────────────────────
const DISCOVERY_KEY = "left_behind_discoveries";
function loadDiscoveries(): Set<string> {
  try {
    const raw = localStorage.getItem(DISCOVERY_KEY);
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
  } catch { return new Set(); }
}
function saveDiscovery(eventId: string): Set<string> {
  const d = loadDiscoveries();
  d.add(eventId);
  try { localStorage.setItem(DISCOVERY_KEY, JSON.stringify([...d])); } catch { /* */ }
  return d;
}

// ─────────────────────────────────────────────────────────────────
//  SCORE — Persistance localStorage
// ─────────────────────────────────────────────────────────────────
const CHALLENGES_WON_KEY = "left_behind_challenges_won";
function loadChallengesWon(): number {
  try {
    const raw = localStorage.getItem(CHALLENGES_WON_KEY);
    return raw ? parseInt(raw, 10) || 0 : 0;
  } catch { return 0; }
}
function saveChallengesWon(count: number): void {
  try { localStorage.setItem(CHALLENGES_WON_KEY, String(count)); } catch { /* */ }
}

// ─────────────────────────────────────────────────────────────────
//  CONSTANTES
// ─────────────────────────────────────────────────────────────────
const CAT_COLOR: Record<string, string> = {
  shock: "#FF4444", civilization: "#4FC3F7", struggle: "#FFB74D", origins: "#E0E0E0",
};
const CAT_LABEL: Record<string, string> = {
  shock: "Choc", civilization: "Civilisation", struggle: "Luttes", origins: "Origines",
};
const CAT_EMOJI: Record<string, string> = {
  shock: "💀", civilization: "🏛️", struggle: "✊", origins: "🌍",
};

const LABEL_STYLE: React.CSSProperties = {
  display: "block", fontSize: "9px", fontWeight: 600,
  letterSpacing: "0.08em", textTransform: "uppercase",
  color: "rgba(255,255,255,0.3)", marginBottom: "4px",
};

const INITIAL_TOP = 96;
const INITIAL_LEFT = 24;
const CARD_WIDTH = 420;
const EDGE_PAD = 8;

// ─────────────────────────────────────────────────────────────────
//  PROPS
// ─────────────────────────────────────────────────────────────────
export interface GamePanelProps {
  /** Premier événement + question pré-générée */
  initialQuestion: QuizQuestion;
  initialEvent: WikiEvent;
  /** Pool d'événements pour les questions suivantes */
  wikiEvents: WikiEvent[];
  /** Difficulté choisie */
  difficulty: "easy" | "hard";
  /** Callbacks */
  onClose: () => void;
  onQuizStart: (coords: { lng: number; lat: number }, category?: string) => void;
  onQuizEnd: () => void;
  onViewHistory: (event: WikiEvent) => void;
}

type GameStatus = "playing" | "result";

// ═══════════════════════════════════════════════════════════════════
//  GAME PANEL — Draggable glassmorphism quiz window
// ═══════════════════════════════════════════════════════════════════
export default function GamePanel({
  initialQuestion,
  initialEvent,
  wikiEvents,
  difficulty,
  onClose,
  onQuizStart,
  onQuizEnd,
  onViewHistory,
}: GamePanelProps) {
  const { t } = useLang();

  // ── Visibilité & animation ────────────────────────────────────
  const [visible, setVisible] = useState(false);
  const [closing, setClosing] = useState(false);

  // ── Drag state ────────────────────────────────────────────────
  const cardRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const offsetRef = useRef({ x: 0, y: 0 });
  const [pos, setPos] = useState({ x: INITIAL_LEFT, y: INITIAL_TOP });

  // ── Quiz state ────────────────────────────────────────────────
  const [gameStatus, setGameStatus] = useState<GameStatus>("playing");
  const [currentQuestion, setCurrentQuestion] = useState<QuizQuestion>(initialQuestion);
  const [currentEvent, setCurrentEvent] = useState<WikiEvent>(initialEvent);
  const [hintsRevealed, setHintsRevealed] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
  const [freeTextAnswer, setFreeTextAnswer] = useState("");
  const [quizResult, setQuizResult] = useState<QuizResult | null>(null);
  const [showAutocomplete, setShowAutocomplete] = useState(false);
  const freeInputRef = useRef<HTMLInputElement>(null);

  // ── Score persistant ──────────────────────────────────────────
  const [totalScore, setTotalScore] = useState(0);
  const [questionsPlayed, setQuestionsPlayed] = useState(0);
  const [discoveries, setDiscoveries] = useState<Set<string>>(loadDiscoveries);
  const [showSuccessToast, setShowSuccessToast] = useState(false);

  // ── Slide-in au montage ───────────────────────────────────────
  useEffect(() => {
    const raf = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  const handleClose = useCallback(() => {
    setClosing(true);
    onQuizEnd();
    setTimeout(onClose, 280);
  }, [onClose, onQuizEnd]);

  // ── Drag handlers ─────────────────────────────────────────────
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
    const ch = card ? card.offsetHeight : 400;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const rawX = e.clientX - offsetRef.current.x;
    const rawY = e.clientY - offsetRef.current.y;
    setPos({
      x: Math.min(Math.max(rawX, EDGE_PAD), vw - cw - EDGE_PAD),
      y: Math.min(Math.max(rawY, EDGE_PAD), vh - ch - EDGE_PAD),
    });
  }, []);

  const onPointerUp = useCallback(() => { dragging.current = false; }, []);

  // ── Autocomplétion ────────────────────────────────────────────
  const autocompleteSuggestions = useMemo(() => {
    if (!freeTextAnswer.trim() || freeTextAnswer.length < 2) return [];
    const q = freeTextAnswer.toLowerCase();
    return wikiEvents
      .map((e) => e.title)
      .filter((t) => t.toLowerCase().includes(q))
      .slice(0, 6);
  }, [freeTextAnswer, wikiEvents]);

  // ── Actions ───────────────────────────────────────────────────
  const handleRevealHint = useCallback(() => {
    setHintsRevealed((h) => Math.min(h + 1, 3));
  }, []);

  const handleSubmitAnswer = useCallback((answer: string) => {
    if (!currentQuestion) return;
    const isCorrect = answer.trim().toLowerCase() === currentQuestion.correctTitle.trim().toLowerCase();
    const result = calculatePoints(isCorrect, hintsRevealed, difficulty === "easy");
    setQuizResult(result);
    setSelectedAnswer(answer);
    setQuestionsPlayed((q) => q + 1);
    if (result.correct) {
      setTotalScore((s) => s + result.points);
      const updated = saveDiscovery(currentQuestion.eventId);
      setDiscoveries(new Set(updated));
      // Incrémenter défis réussis (persisté localStorage)
      const newWon = loadChallengesWon() + 1;
      saveChallengesWon(newWon);
      setShowSuccessToast(true);
    }
    setGameStatus("result");
    onQuizEnd();
  }, [currentQuestion, hintsRevealed, difficulty, onQuizEnd]);

  // Index pour parcourir séquentiellement les événements
  const nextIdxRef = useRef(0);

  const handleNextQuestion = useCallback(() => {
    if (wikiEvents.length < 2) return;
    // Parcours séquentiel (évite de retomber sur le même)
    let pick: WikiEvent | null = null;
    for (let attempt = 0; attempt < wikiEvents.length; attempt++) {
      const candidate = wikiEvents[nextIdxRef.current % wikiEvents.length];
      nextIdxRef.current++;
      if (candidate.id !== currentEvent.id) {
        pick = candidate;
        break;
      }
    }
    if (!pick) pick = wikiEvents[nextIdxRef.current % wikiEvents.length];
    const question = prepareQuizQuestion(pick, wikiEvents, difficulty);
    if (!question) return;
    setCurrentQuestion(question);
    setCurrentEvent(pick);
    setGameStatus("playing");
    setHintsRevealed(0);
    setSelectedAnswer(null);
    setFreeTextAnswer("");
    setQuizResult(null);
    setShowSuccessToast(false);
    onQuizStart({ lng: pick.lng, lat: pick.lat }, pick.category);
  }, [wikiEvents, difficulty, onQuizStart, currentEvent.id]);

  const handleRetry = useCallback(() => {
    setGameStatus("playing");
    setHintsRevealed(0);
    setSelectedAnswer(null);
    setFreeTextAnswer("");
    setQuizResult(null);
    setShowSuccessToast(false);
    onQuizStart({ lng: currentEvent.lng, lat: currentEvent.lat }, currentEvent.category);
  }, [currentEvent, onQuizStart]);

  // ── Accent color based on category ────────────────────────────
  const cat = currentQuestion.hints.category;
  const accent = CAT_COLOR[cat] || "#BB86FC";
  const accentDim = `${accent}25`;
  const accentBorder = `${accent}40`;

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
          background: "rgba(10, 12, 18, 0.88)",
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
        {/* Barre de couleur accent catégorie */}
        <div style={{ height: "3px", flexShrink: 0, background: `linear-gradient(90deg, transparent, ${accent}, transparent)`, opacity: 0.7 }} />

        {/* ── Croix de fermeture — absolute ─────────────────────── */}
        <button
          onClick={handleClose}
          className="absolute z-10 flex items-center justify-center rounded-full transition-all duration-200 hover:scale-110 hover:bg-white/[0.08]"
          style={{ top: "12px", right: "12px", width: "28px", height: "28px", border: "1px solid rgba(255,255,255,0.08)", background: "transparent", color: "rgba(255,255,255,0.4)", fontSize: "14px" }}
          onMouseEnter={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.8)")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.4)")}
        >
          &#x2715;
        </button>

        <div style={{ padding: "16px 20px 14px", display: "flex", flexDirection: "column", minHeight: 0, flex: 1 }}>

          {/* ── Score persistant ──────────────────────────────────── */}
          {questionsPlayed > 0 && gameStatus === "playing" && (
            <div className="flex items-center justify-between mb-2 px-2 py-1.5 rounded-lg" style={{ background: `${accent}12`, border: `1px solid ${accentBorder}` }}>
              <span style={{ fontSize: "10px", color: "rgba(255,255,255,0.5)", fontWeight: 500 }}>Score</span>
              <span style={{ fontSize: "14px", fontWeight: 700, color: accent }}>{totalScore} pts</span>
            </div>
          )}

          {/* ══════════════════════════════════════════════════════
              MODE PLAYING
             ══════════════════════════════════════════════════════ */}
          {gameStatus === "playing" && (
            <>
              {/* Zone énigme — scrollable */}
              <div className="flex-1 min-h-0 overflow-y-auto story-scroll-violet pr-1 mb-3" style={{ maxHeight: "220px" }}>
                <div className="rounded-xl px-4 py-3" style={{ background: `${accent}0D`, border: `1px solid ${accentBorder}` }}>
                  <div className="flex items-center gap-2 mb-2">
                    <span style={{ fontSize: "12px" }}>{CAT_EMOJI[cat] || "📍"}</span>
                    <span style={{ fontSize: "9px", fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: accent }}>
                      {t.game_question}
                    </span>
                  </div>
                  <div style={{ fontSize: "12px", fontWeight: 300, color: "rgba(255,255,255,0.8)", lineHeight: 1.7, letterSpacing: "0.01em" }}>
                    {currentQuestion.maskedDescription || t.misc_no_description}
                  </div>
                </div>
              </div>

              {/* Zone fixe — indices + réponses (footer) */}
              <div style={{ flexShrink: 0 }}>
                {/* Indices révélés */}
                <div className="flex flex-col gap-1.5 mb-3">
                  {hintsRevealed >= 1 && (
                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
                      <span style={{ fontSize: "9px", fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: CAT_COLOR[currentQuestion.hints.category] || accent }}>{t.game_category_hint}</span>
                      <span style={{ fontSize: "11px", color: "rgba(255,255,255,0.7)" }}>{CAT_LABEL[currentQuestion.hints.category] || currentQuestion.hints.category}</span>
                    </div>
                  )}
                  {hintsRevealed >= 2 && currentQuestion.hints.year && (
                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
                      <span style={{ fontSize: "9px", fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "#FFD700" }}>{t.game_year_hint}</span>
                      <span style={{ fontSize: "11px", color: "rgba(255,255,255,0.7)" }}>
                        {currentQuestion.hints.year < 0 ? `${Math.abs(currentQuestion.hints.year)} av. J.-C.` : currentQuestion.hints.year}
                      </span>
                    </div>
                  )}
                  {hintsRevealed >= 3 && currentQuestion.hints.actions.length > 0 && (
                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg flex-wrap" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
                      <span style={{ fontSize: "9px", fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "#FFB74D" }}>{t.game_actions_hint}</span>
                      {currentQuestion.hints.actions.map((v) => (
                        <span key={v} style={{ fontSize: "10px", color: "rgba(255,255,255,0.6)", padding: "2px 6px", borderRadius: "999px", background: "rgba(255,183,77,0.1)", border: "1px solid rgba(255,183,77,0.15)" }}>{v}</span>
                      ))}
                    </div>
                  )}
                  {hintsRevealed < 3 && (
                    <button onClick={handleRevealHint} className="self-start transition-all duration-150 hover:bg-white/[0.06]" style={{ padding: "5px 12px", borderRadius: "999px", fontSize: "10px", fontWeight: 500, color: "rgba(255,255,255,0.4)", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}>
                      💡 {t.game_hint} {hintsRevealed + 1}/3 <span style={{ fontSize: "8px", color: "rgba(255,255,255,0.25)", marginLeft: "4px" }}>{t.game_hint_pts}</span>
                    </button>
                  )}
                </div>

                {/* Séparateur */}
                <div style={{ height: "1px", background: `linear-gradient(90deg, transparent, ${accentBorder}, transparent)`, marginBottom: "10px" }} />

                {/* QCM (Facile) */}
                {currentQuestion.difficulty === "easy" && (
                  <div className="flex flex-col gap-1.5">
                    <label style={{ ...LABEL_STYLE, color: `${accent}80` }}>{t.game_choose}</label>
                    {currentQuestion.options.map((opt) => (
                      <button key={opt} onClick={() => handleSubmitAnswer(opt)} className="w-full text-left px-3 py-2.5 rounded-xl transition-all duration-150 hover:bg-white/[0.07] active:scale-[0.98]" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", fontSize: "11px", fontWeight: 500, color: "rgba(255,255,255,0.8)", lineHeight: 1.4 }}>
                        {opt}
                      </button>
                    ))}
                  </div>
                )}

                {/* Saisie libre (Expert) */}
                {currentQuestion.difficulty === "hard" && (
                  <div className="flex flex-col gap-1.5 relative">
                    <label style={{ ...LABEL_STYLE, color: `${accent}80` }}>{t.game_type_answer}</label>
                    <div className="relative">
                      <input
                        ref={freeInputRef}
                        type="text"
                        value={freeTextAnswer}
                        onChange={(e) => { setFreeTextAnswer(e.target.value); setShowAutocomplete(true); }}
                        onFocus={() => setShowAutocomplete(true)}
                        onKeyDown={(e) => { if (e.key === "Enter" && freeTextAnswer.trim()) handleSubmitAnswer(freeTextAnswer.trim()); }}
                        placeholder={t.game_placeholder}
                        className="w-full px-3 py-2.5 rounded-xl text-sm outline-none transition-colors"
                        style={{ background: "rgba(255,255,255,0.04)", border: `1px solid ${accentBorder}`, color: "rgba(255,255,255,0.9)", fontFamily: "'Montserrat', 'Inter', system-ui, sans-serif", fontSize: "11px" }}
                      />
                      {showAutocomplete && autocompleteSuggestions.length > 0 && (
                        <div className="absolute left-0 right-0 rounded-xl overflow-hidden" style={{ top: "calc(100% + 4px)", background: "rgba(15,15,20,0.95)", backdropFilter: "blur(16px)", border: `1px solid ${accentBorder}`, zIndex: 10, maxHeight: "140px", overflowY: "auto" }}>
                          {autocompleteSuggestions.map((s) => (
                            <button key={s} onClick={() => { setFreeTextAnswer(s); setShowAutocomplete(false); freeInputRef.current?.focus(); }} className="w-full text-left px-3 py-2 transition-colors hover:bg-white/[0.06]" style={{ fontSize: "11px", color: "rgba(255,255,255,0.7)", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                              {s}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <button onClick={() => { if (freeTextAnswer.trim()) handleSubmitAnswer(freeTextAnswer.trim()); }} disabled={!freeTextAnswer.trim()} className="w-full py-2.5 rounded-xl transition-all duration-200 active:scale-[0.97] disabled:opacity-30 disabled:cursor-not-allowed" style={{ fontSize: "11px", fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase", color: "#FFF", background: "transparent", border: `1px solid ${accent}` }}>
                      {t.game_validate}
                    </button>
                  </div>
                )}
              </div>
            </>
          )}

          {/* ══════════════════════════════════════════════════════
              MODE RESULT
             ══════════════════════════════════════════════════════ */}
          {gameStatus === "result" && currentQuestion && quizResult && (
            <div className="flex flex-col gap-3 items-center">
              {/* Confetti si victoire */}
              {quizResult.correct && (
                <div className="relative w-full flex justify-center" style={{ height: "0px", overflow: "visible" }}>
                  {[...Array(10)].map((_, i) => (
                    <span key={i} style={{ position: "absolute", fontSize: `${10 + Math.random() * 8}px`, left: `${10 + Math.random() * 80}%`, top: `${-10 - Math.random() * 25}px`, opacity: 0, animation: `quizConfetti 1.5s ease-out ${i * 0.08}s forwards`, pointerEvents: "none" }}>
                      {["✦", "✧", "⭐", "💫", "🌟"][i % 5]}
                    </span>
                  ))}
                </div>
              )}

              {/* Icône */}
              <div style={{ fontSize: "40px", marginTop: "4px", animation: "quizResultPop 0.5s cubic-bezier(0.34,1.56,0.64,1)" }}>
                {quizResult.correct ? "🎉" : "😔"}
              </div>
              <h3 style={{ fontSize: "15px", fontWeight: 700, color: quizResult.correct ? "#FFD700" : "#FF4444", textAlign: "center", lineHeight: 1.4 }}>
                {quizResult.correct ? t.result_correct : t.result_wrong}
              </h3>

              {/* Points */}
              <div className="px-4 py-2.5 rounded-xl w-full" style={{ background: quizResult.correct ? "rgba(255,215,0,0.06)" : "rgba(255,68,68,0.06)", border: `1px solid ${quizResult.correct ? "rgba(255,215,0,0.2)" : "rgba(255,68,68,0.15)"}`, textAlign: "center" }}>
                <div style={{ fontSize: "24px", fontWeight: 700, color: quizResult.correct ? "#FFD700" : "#FF4444" }}>
                  {quizResult.correct ? `+${quizResult.points}` : "0"}
                </div>
                <div style={{ fontSize: "9px", color: "rgba(255,255,255,0.35)", marginTop: "2px" }}>
                  {quizResult.correct ? t.result_points_earned : t.result_points}
                  {quizResult.hintsUsed > 0 && ` · ${quizResult.hintsUsed} ${t.result_hints_used}`}
                  {quizResult.wasQCM && ` · ${t.result_qcm}`}
                </div>
              </div>

              {/* Bonne réponse */}
              <div className="w-full px-3 py-2.5 rounded-xl" style={{ background: `${accent}0D`, border: `1px solid ${accentBorder}` }}>
                <div style={{ fontSize: "9px", fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: accent, marginBottom: "3px" }}>
                  {quizResult.correct ? t.result_found : t.result_answer_was}
                </div>
                <div style={{ fontSize: "13px", fontWeight: 600, color: "rgba(255,255,255,0.9)" }}>{currentQuestion.correctTitle}</div>
                {currentQuestion.hints.year && (
                  <div style={{ fontSize: "10px", color: "rgba(255,255,255,0.4)", marginTop: "2px" }}>
                    {currentQuestion.hints.year < 0 ? `${Math.abs(currentQuestion.hints.year)} av. J.-C.` : currentQuestion.hints.year}
                    {" · "}{CAT_LABEL[currentQuestion.hints.category] || currentQuestion.hints.category}
                  </div>
                )}
              </div>

              {/* Voir l'histoire complète */}
              {currentEvent && (
                <button onClick={() => { onQuizEnd(); onViewHistory(currentEvent); }} className="w-full py-2.5 rounded-xl transition-all duration-200 hover:bg-white/[0.08] active:scale-[0.97]" style={{ fontSize: "11px", fontWeight: 600, letterSpacing: "0.04em", color: accent, background: `${accent}0D`, border: `1px solid ${accentBorder}` }}>
                  📖 {t.result_view_story}
                </button>
              )}

              {/* Boutons d'action */}
              <div className="flex gap-2 w-full">
                <button onClick={handleNextQuestion} className="flex-1 py-2.5 rounded-xl transition-all duration-200 active:scale-[0.97]" style={{ fontSize: "11px", fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase", color: "#000", background: `linear-gradient(135deg, ${accent} 0%, ${accent}CC 100%)` }}>
                  {t.result_next}
                </button>
                {!quizResult.correct && (
                  <button onClick={handleRetry} className="py-2.5 px-3 rounded-xl transition-all duration-200 hover:bg-white/[0.06]" style={{ fontSize: "11px", fontWeight: 500, color: "#FFB74D", background: "rgba(255,183,77,0.06)", border: "1px solid rgba(255,183,77,0.2)" }}>
                    {t.result_retry}
                  </button>
                )}
                <button onClick={handleClose} className="py-2.5 px-3 rounded-xl transition-all duration-200 hover:bg-white/[0.06]" style={{ fontSize: "11px", fontWeight: 500, color: "rgba(255,255,255,0.5)", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}>
                    {t.result_quit}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Toast de succès */}
      {showSuccessToast && (
        <div className="absolute left-4 right-4 flex items-center gap-3 px-4 py-2.5 rounded-xl" style={{ top: "12px", zIndex: 50, background: "rgba(255,215,0,0.12)", border: "1px solid rgba(255,215,0,0.25)", backdropFilter: "blur(16px)", animation: "quizToastIn 0.4s ease-out" }}>
          <span style={{ fontSize: "18px" }}>🏆</span>
          <div>
            <div style={{ fontSize: "12px", fontWeight: 700, color: "#FFD700" }}>{t.result_discovered}</div>
            <div style={{ fontSize: "9px", color: "rgba(255,255,255,0.5)", marginTop: "1px" }}>{t.result_added} ({discoveries.size})</div>
          </div>
        </div>
      )}
    </div>
  );
}
