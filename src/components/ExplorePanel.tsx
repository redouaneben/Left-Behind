    "use client";

    import { useState, useMemo, useCallback, useRef, useEffect } from "react";
    import type { FragmentData } from "./MapGlobe";
    import type { WikiEvent, WikiCategory } from "@/lib/wikipedia";
    import { prepareQuizQuestion, calculatePoints } from "@/lib/gameEngine";
    import type { QuizQuestion, QuizResult } from "@/lib/gameEngine";
    import { useLang } from "@/lib/LangContext";

    // ─────────────────────────────────────────────────────────────────
    //  COLLECTION — Persistance localStorage des événements découverts
    // ─────────────────────────────────────────────────────────────────
    const DISCOVERY_STORAGE_KEY = "left_behind_discoveries";

    function loadDiscoveries(): Set<string> {
      try {
        const raw = localStorage.getItem(DISCOVERY_STORAGE_KEY);
        if (!raw) return new Set();
        return new Set(JSON.parse(raw) as string[]);
      } catch {
        return new Set();
      }
    }

    function saveDiscovery(eventId: string): Set<string> {
      const discoveries = loadDiscoveries();
      discoveries.add(eventId);
      try {
        localStorage.setItem(DISCOVERY_STORAGE_KEY, JSON.stringify([...discoveries]));
      } catch { /* quota exceeded, silently fail */ }
      return discoveries;
    }

    // ─────────────────────────────────────────────────────────────────
    //  SCORE — Persistance localStorage du nombre de défis réussis
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

    // ═══════════════════════════════════════════════════════════════════
    //  EXPLORE PANEL — Deux onglets : Fragments ↔ Explore History
    //  Onglet 1 : Filtres ↔ Résultats (fragments)
    //  Onglet 2 : Quiz « Devinez l'Histoire » (idle → playing → result)
    // ═══════════════════════════════════════════════════════════════════

    const MOOD_EMOJI: Record<string, string> = {
      Joie: "✨",
      Mélancolie: "💧",
      Passion: "🔥",
      Sérénité: "🌿",
      Mystère: "🌌",
      Énergie: "⚡",
    };

    const THEME_TAGS = [
      { key: "all", label: "Tous" },
      { key: "Joie", label: "✨ Joie" },
      { key: "Mélancolie", label: "💧 Mélancolie" },
      { key: "Passion", label: "🔥 Passion" },
      { key: "Sérénité", label: "🌿 Sérénité" },
      { key: "Mystère", label: "🌌 Mystère" },
      { key: "Énergie", label: "⚡ Énergie" },
    ];

    const HISTORY_CAT_TAGS = [
      { key: "all", label: "Toutes", color: "#BB86FC" },
      { key: "shock", label: "💀 Choc", color: "#FF4444" },
      { key: "civilization", label: "🏛️ Civilisation", color: "#4FC3F7" },
      { key: "struggle", label: "✊ Luttes", color: "#FFB74D" },
      { key: "origins", label: "🌍 Origines", color: "#E0E0E0" },
    ];

    const QUIZ_CAT_TAGS = [
      { key: "all", label: "Toutes", color: "#BB86FC" },
      { key: "shock", label: "💀 Choc", color: "#FF4444" },
      { key: "civilization", label: "🏛️ Civilisation", color: "#4FC3F7" },
      { key: "struggle", label: "✊ Luttes", color: "#FFB74D" },
      { key: "origins", label: "🌍 Origines", color: "#E0E0E0" },
    ];

    const CAT_COLOR: Record<string, string> = {
      shock: "#FF4444",
      civilization: "#4FC3F7",
      struggle: "#FFB74D",
      origins: "#E0E0E0",
    };

    const CAT_LABEL: Record<string, string> = {
      shock: "Choc",
      civilization: "Civilisation",
      struggle: "Luttes",
      origins: "Origines",
    };

    interface ExplorePanelProps {
      fragments: FragmentData[];
      historicalCount: number;
      /** Liste des WikiEvents actuellement sur le globe — pour le quiz */
      wikiEvents: WikiEvent[];
      onClose: () => void;
      onFlyTo: (fragment: FragmentData) => void;
      onFilter: (filters: ExploreFilters) => void;
      /** Appelé quand le quiz démarre — passe les coords de l'événement à deviner */
      onQuizStart?: (coords: { lng: number; lat: number }) => void;
      /** Appelé quand le quiz se termine (result ou retour menu) */
      onQuizEnd?: () => void;
      /** Ouvrir la StoryCard d'un événement historique (depuis le quiz) */
      onViewHistory?: (event: WikiEvent) => void;
      /** Demande au globe de fetcher des événements mondiaux (5 continents) */
      onRequestWorldFetch?: () => Promise<WikiEvent[]>;
      /** Notifie le parent quand l'onglet actif change (pour isoler les couches) */
      onTabChange?: (tab: "fragments" | "quiz") => void;
      /** Lance le GamePanel externe — ferme l'ExplorePanel et passe les données */
      onLaunchGame?: (data: { question: import("@/lib/gameEngine").QuizQuestion; event: WikiEvent; difficulty: "easy" | "hard" }) => void;
    }

    export interface ExploreFilters {
      year: number | null;
      search: string;
      mood: string | null;
      /** Catégorie historique — null = pas de filtre */
      historyCategory: string | null;
    }

    type ActiveTab = "fragments" | "quiz";
    type GameStatus = "idle" | "playing" | "result";
    type QuizZone = "local" | "world";
    type QuizEpoch = "all" | "antiquity" | "medieval" | "modern" | "contemporary";

    const EPOCH_TAGS: { key: QuizEpoch; label: string; color: string }[] = [
      { key: "all", label: "Toutes", color: "#BB86FC" },
      { key: "antiquity", label: "⏳ Antiquité", color: "#E0E0E0" },
      { key: "medieval", label: "⚔️ Moyen-Âge", color: "#FFB74D" },
      { key: "modern", label: "🏰 Moderne", color: "#4FC3F7" },
      { key: "contemporary", label: "🌍 Contemporaine", color: "#FF4444" },
    ];

    function matchEpoch(year: number | null, epoch: QuizEpoch): boolean {
      if (epoch === "all" || year === null) return epoch === "all";
      if (epoch === "antiquity") return year <= 476;
      if (epoch === "medieval") return year > 476 && year <= 1492;
      if (epoch === "modern") return year > 1492 && year <= 1789;
      if (epoch === "contemporary") return year > 1789;
      return true;
    }

    const LABEL_STYLE: React.CSSProperties = {
      display: "block",
      fontSize: "9px",
      fontWeight: 600,
      letterSpacing: "0.08em",
      textTransform: "uppercase",
      color: "rgba(255,255,255,0.3)",
      marginBottom: "4px",
    };

    /* Style pill compact réutilisable (History tab) */
    const PILL_COMPACT = (active: boolean, color: string): React.CSSProperties => ({
      padding: "4px 10px",
      borderRadius: "999px",
      fontSize: "10px",
      fontWeight: active ? 600 : 400,
      letterSpacing: "0.02em",
      color: active ? color : "rgba(255,255,255,0.5)",
      background: active ? `${color}1A` : "rgba(255,255,255,0.04)",
      border: active ? `1px solid ${color}40` : "1px solid transparent",
      lineHeight: "1.4",
      whiteSpace: "nowrap",
    });

    /* ── Styles FRAGMENTS ONLY — plus gros, plus gras ──────────── */
    const FRAG_LABEL: React.CSSProperties = {
      display: "block",
      fontSize: "11px",
      fontWeight: 700,
      letterSpacing: "0.08em",
      textTransform: "uppercase",
      color: "rgba(255,255,255,0.4)",
      marginBottom: "6px",
    };
    const FRAG_PILL = (active: boolean, color: string): React.CSSProperties => ({
      padding: "7px 14px",
      borderRadius: "999px",
      fontSize: "12px",
      fontWeight: active ? 700 : 500,
      letterSpacing: "0.02em",
      color: active ? color : "rgba(255,255,255,0.55)",
      background: active ? `${color}1A` : "rgba(255,255,255,0.05)",
      border: active ? `1px solid ${color}40` : "1px solid rgba(255,255,255,0.06)",
      lineHeight: "1.4",
      whiteSpace: "nowrap",
    });

    // ─────────────────────────────────────────────────────────────────
    //  COMPOSANT PRINCIPAL
    // ─────────────────────────────────────────────────────────────────

    export default function ExplorePanel({
      fragments,
      historicalCount,
      wikiEvents,
      onClose,
      onFlyTo,
      onFilter,
      onQuizStart,
      onQuizEnd,
      onViewHistory,
      onRequestWorldFetch,
      onTabChange,
      onLaunchGame,
    }: ExplorePanelProps) {
      const { t } = useLang();
      // ── Onglet actif ────────────────────────────────────────────────
      const [activeTab, setActiveTab] = useState<ActiveTab>("fragments");

      // Notifie le parent à chaque changement d'onglet
      const switchTab = useCallback((tab: ActiveTab) => {
        setActiveTab(tab);
        onTabChange?.(tab);
      }, [onTabChange]);

      // Synchronise le parent au montage
      useEffect(() => { onTabChange?.(activeTab); }, []); // eslint-disable-line react-hooks/exhaustive-deps

      // ══════════════════════════════════════════════════════════════
      //  ONGLET FRAGMENTS — état existant
      // ══════════════════════════════════════════════════════════════
      const [year, setYear] = useState<number | null>(null);
      const [country, setCountry] = useState<string | null>(null);
      const [mood, setMood] = useState<string | null>(null);
      const [historyCategory, setHistoryCategory] = useState<string | null>(null);
      const [showResults, setShowResults] = useState(false);
      const [appliedFilters, setAppliedFilters] = useState<{
        year: number | null;
        country: string | null;
        mood: string | null;
        historyCategory: string | null;
      }>({ year: null, country: null, mood: null, historyCategory: null });
      const [searchKey, setSearchKey] = useState(0);

      // ══════════════════════════════════════════════════════════════
      //  ONGLET QUIZ — « Devinez l'Histoire »
      // ══════════════════════════════════════════════════════════════
      const [gameStatus, setGameStatus] = useState<GameStatus>("idle");
      const [quizDifficulty, setQuizDifficulty] = useState<"easy" | "hard">("easy");
      const [quizCatFilter, setQuizCatFilter] = useState<string | null>(null);
      const [currentQuestion, setCurrentQuestion] = useState<QuizQuestion | null>(null);
      const [hintsRevealed, setHintsRevealed] = useState(0);
      const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
      const [freeTextAnswer, setFreeTextAnswer] = useState("");
      const [quizResult, setQuizResult] = useState<QuizResult | null>(null);
      const [totalScore, setTotalScore] = useState(0);
      const [questionsPlayed, setQuestionsPlayed] = useState(0);
      const [showAutocomplete, setShowAutocomplete] = useState(false);
      const freeInputRef = useRef<HTMLInputElement>(null);

      // ── Filtres avancés Quiz ────────────────────────────────────────
      const [quizEpoch, setQuizEpoch] = useState<QuizEpoch>("all");
      const [quizZone, setQuizZone] = useState<QuizZone>("local");
      const [isWorldLoading, setIsWorldLoading] = useState(false);
      const [worldEvents, setWorldEvents] = useState<WikiEvent[]>([]);
      const worldFetchedRef = useRef(false);

      // ── Collection & Toast ──────────────────────────────────────────
      const [discoveries, setDiscoveries] = useState<Set<string>>(() => loadDiscoveries());
      const [showSuccessToast, setShowSuccessToast] = useState(false);
      // ── Défis réussis — persisté localStorage ─────────────────────
      const [challengesWon, setChallengesWon] = useState<number>(() => loadChallengesWon());
      const [currentQuizEvent, setCurrentQuizEvent] = useState<WikiEvent | null>(null);

      // ── Auto-dismiss du toast de succès ─────────────────────────────
      useEffect(() => {
        if (!showSuccessToast) return;
        const timer = setTimeout(() => setShowSuccessToast(false), 3000);
        return () => clearTimeout(timer);
      }, [showSuccessToast]);

      // ── Re-synchroniser challengesWon au montage (GamePanel peut l'avoir modifié) ──
      useEffect(() => {
        setChallengesWon(loadChallengesWon());
      }, []);

      // ── Smart Loading Continental — fetch 5 continents si "Monde Entier" ──
      useEffect(() => {
        if (quizZone !== "world") return;
        if (worldFetchedRef.current) return; // déjà fait
        if (!onRequestWorldFetch) return;

        worldFetchedRef.current = true;
        setIsWorldLoading(true);

        onRequestWorldFetch()
          .then((events) => {
            setWorldEvents(events);
            setIsWorldLoading(false);
          })
          .catch(() => {
            setIsWorldLoading(false);
          });
      }, [quizZone, onRequestWorldFetch]);

      // ── Données dérivées — Fragments ──────────────────────────────
      const availableYears = useMemo(() => {
        const years = [...new Set(fragments.map((f) => f.year))];
        years.sort((a, b) => b - a);
        return years;
      }, [fragments]);

      const availableCountries = useMemo(() => {
        const countries = [
          ...new Set(
            fragments
              .map((f) => f.country?.trim())
              .filter((c): c is string => !!c && c.length > 0)
          ),
        ];
        countries.sort((a, b) => a.localeCompare(b));
        return countries;
      }, [fragments]);

      const filtered = useMemo(() => {
        const { year: y, country: c, mood: m } = appliedFilters;
        return fragments.filter((f) => {
          if (y !== null && f.year !== y) return false;
          if (c && (f.country ?? "").trim() !== c) return false;
          if (m && f.mood !== m) return false;
          return true;
        });
      }, [fragments, appliedFilters]);

      const summaryText = useMemo(() => {
        if (filtered.length === 0) return null;
        const n = filtered.length;
        const s = n > 1 ? "s" : "";
        const years = filtered.map((f) => f.year);
        const minY = Math.min(...years);
        const maxY = Math.max(...years);
        const geo = appliedFilters.country ? ` en ${appliedFilters.country}` : "";
        if (minY === maxY) {
          return `${n} souvenir${s} trouvé${s}${geo} en ${minY}`;
        }
        return `${n} souvenir${s} trouvé${s}${geo} de ${minY} à ${maxY}`;
      }, [filtered, appliedFilters.country]);

      // ── Données dérivées — Quiz ──────────────────────────────────
      // Source = local (carte visible) ou monde entier (local + continents)
      const quizSource = useMemo(() => {
        if (quizZone === "world" && worldEvents.length > 0) {
          // Fusionner local + world, dédupliquer par id
          const map = new Map<number, WikiEvent>();
          for (const e of wikiEvents) map.set(e.id, e);
          for (const e of worldEvents) map.set(e.id, e);
          return [...map.values()];
        }
        return wikiEvents;
      }, [wikiEvents, worldEvents, quizZone]);

      const quizPool = useMemo(() => {
        return quizSource.filter((e) => {
          if (quizCatFilter && e.category !== quizCatFilter) return false;
          if (!matchEpoch(e.year, quizEpoch)) return false;
          return true;
        });
      }, [quizSource, quizCatFilter, quizEpoch]);

      const autocompleteSuggestions = useMemo(() => {
        if (!freeTextAnswer || freeTextAnswer.length < 2) return [];
        const q = freeTextAnswer.toLowerCase();
        return wikiEvents
          .map((e) => {
            const clean = e.title
              .replace(/^\(\d{1,4}(?:\s*av\.?\s*J\.?-?C\.?)?\)\s*/, "")
              .replace(/^\([IVXLCDM]+e(?:\s*av\.?\s*J\.?-?C\.?)?\)\s*/, "")
              .trim();
            return clean;
          })
          .filter((t, i, arr) => arr.indexOf(t) === i) // unique
          .filter((t) => t.toLowerCase().includes(q))
          .slice(0, 6);
      }, [freeTextAnswer, wikiEvents]);

      // ── Actions — Fragments ────────────────────────────────────────
      const handleSearch = useCallback(() => {
        setAppliedFilters({ year, country, mood, historyCategory });
        setSearchKey((k) => k + 1);
        setShowResults(true);
        onFilter({ year, search: "", mood, historyCategory });
      }, [year, country, mood, historyCategory, onFilter]);

      const handleBack = useCallback(() => {
        setShowResults(false);
      }, []);

      const handleRandomize = useCallback(() => {
        const pool = filtered.length > 0 ? filtered : fragments;
        if (pool.length === 0) return;
        const pick = pool[Math.floor(Math.random() * pool.length)];
        onFlyTo(pick);
      }, [filtered, fragments, onFlyTo]);

      const handleClose = () => {
        // ── Anti-Fermeture : sanctuariser le jeu en cours ──
        if (gameStatus === "playing") return; // on ne quitte PAS pendant une question

        onFilter({ year: null, search: "", mood: null, historyCategory: null });
        setShowResults(false);
        if (gameStatus === "result") {
          setGameStatus("idle");
          setCurrentQuestion(null);
          onQuizEnd?.();
        }
        onClose();
      };

      // ── Actions — Quiz ────────────────────────────────────────────
      const handleStartQuiz = useCallback(() => {
        if (quizPool.length === 0) return;
        const pick = quizPool[Math.floor(Math.random() * quizPool.length)];
        const question = prepareQuizQuestion(pick, wikiEvents, quizDifficulty);
        if (!question) return;

        // ── Lancement via GamePanel externe ──
        if (onLaunchGame) {
          onLaunchGame({ question, event: pick, difficulty: quizDifficulty });
          // Fermer l'ExplorePanel (le parent gère l'ouverture du GamePanel)
          onFilter({ year: null, search: "", mood: null, historyCategory: null });
          setShowResults(false);
          onClose();
          return;
        }

        // Fallback interne (ne devrait plus être utilisé)
        setCurrentQuestion(question);
        setCurrentQuizEvent(pick);
        setHintsRevealed(0);
        setSelectedAnswer(null);
        setFreeTextAnswer("");
        setQuizResult(null);
        setShowSuccessToast(false);
        setGameStatus("playing");
        switchTab("quiz");
        onQuizStart?.({ lng: pick.lng, lat: pick.lat });
      }, [quizPool, wikiEvents, quizDifficulty, onQuizStart, switchTab, onLaunchGame, onFilter, onClose]);

      const handleRevealHint = useCallback(() => {
        setHintsRevealed((h) => Math.min(h + 1, 3));
      }, []);

      const handleSubmitAnswer = useCallback((answer: string) => {
        if (!currentQuestion) return;
        const isCorrect = answer.toLowerCase().trim() === currentQuestion.correctTitle.toLowerCase().trim();
        const result = calculatePoints(isCorrect, hintsRevealed, quizDifficulty === "easy");
        setQuizResult(result);
        setSelectedAnswer(answer);
        setQuestionsPlayed((q) => q + 1);
        if (result.correct) {
          setTotalScore((s) => s + result.points);
          const updated = saveDiscovery(currentQuestion.eventId);
          setDiscoveries(new Set(updated));
          // Incrémenter les défis réussis (persisté)
          setChallengesWon((prev) => {
            const next = prev + 1;
            saveChallengesWon(next);
            return next;
          });
          setShowSuccessToast(true);
        }
        setGameStatus("result");
        // Résultat affiché → on lève l'isolation visuelle
        onQuizEnd?.();
      }, [currentQuestion, hintsRevealed, quizDifficulty, onQuizEnd]);

      const handleNextQuestion = useCallback(() => {
        setGameStatus("idle");
        setCurrentQuestion(null);
        setCurrentQuizEvent(null);
        setQuizResult(null);
        setShowSuccessToast(false);
        onQuizEnd?.();
      }, [onQuizEnd]);

      // ═══════════════════════════════════════════════════════════════
      //  RENDU
      // ═══════════════════════════════════════════════════════════════
      return (
        <div className="fixed inset-0 z-[200] flex items-center justify-end pointer-events-none">
          <div
            className="absolute inset-0 pointer-events-auto"
            onClick={handleClose}
          />

          {/* Panneau — centré verticalement, 90vh */}
          <div
            className="relative pointer-events-auto w-full max-w-[340px] rounded-3xl flex flex-col"
            style={{
              fontFamily: "'Montserrat', 'Inter', system-ui, sans-serif",
              background: "rgba(0, 0, 0, 0.82)",
              backdropFilter: "blur(24px) saturate(1.4)",
              WebkitBackdropFilter: "blur(24px) saturate(1.4)",
              border: "1px solid rgba(255, 255, 255, 0.07)",
              boxShadow:
                "0 16px 64px rgba(0,0,0,0.7), 0 0 32px rgba(255,215,0,0.03)",
              height: "90vh",
              maxHeight: "90vh",
              marginRight: "24px",
              overflow: "hidden",
            }}
          >
            {/* ── Croix de fermeture — absolute, indépendante du flux ── */}
            <button
              onClick={handleClose}
              className="absolute z-10 flex items-center justify-center rounded-full transition-all duration-200 hover:scale-110 hover:bg-white/[0.08]"
              style={{
                top: "1.2rem",
                right: "1.2rem",
                width: "32px",
                height: "32px",
                color: "rgba(255,255,255,0.35)",
                fontSize: "18px",
                lineHeight: 1,
                border: "none",
                background: "transparent",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.8)")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.35)")}
            >
              &#x2715;
            </button>

            {/* ── Header avec onglets ────────────────────────────────── */}
            <div className="flex-shrink-0 px-4 pt-8 pb-0">
              <div className="flex items-center gap-1 mb-3 px-2 pr-10">
                {/* Onglet Fragments */}
                <button
                  onClick={() => switchTab("fragments")}
                  className="transition-all duration-200"
                  style={{
                    padding: "7px 14px",
                    borderRadius: "12px",
                    fontSize: "12px",
                    fontWeight: activeTab === "fragments" ? 600 : 400,
                    letterSpacing: "0.03em",
                    color: activeTab === "fragments" ? "#FFD700" : "rgba(255,255,255,0.45)",
                    background: activeTab === "fragments" ? "rgba(255,215,0,0.1)" : "transparent",
                    border: activeTab === "fragments" ? "1px solid rgba(255,215,0,0.2)" : "1px solid transparent",
                  }}
                >
                  ✨ {t.tab_fragments}
                </button>
                {/* Onglet Quiz */}
                <button
                  onClick={() => switchTab("quiz")}
                  className="transition-all duration-200"
                  style={{
                    padding: "7px 14px",
                    borderRadius: "12px",
                    fontSize: "12px",
                    fontWeight: activeTab === "quiz" ? 600 : 400,
                    letterSpacing: "0.03em",
                    color: activeTab === "quiz" ? "#BB86FC" : "rgba(255,255,255,0.45)",
                    background: activeTab === "quiz" ? "rgba(187,134,252,0.1)" : "transparent",
                    border: activeTab === "quiz" ? "1px solid rgba(187,134,252,0.2)" : "1px solid transparent",
                  }}
                >
                  🏛️ {t.tab_history}
                </button>
              </div>
              {/* Séparateur sous onglets */}
              <div
                style={{
                  height: "1px",
                  background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.06), transparent)",
                }}
              />
            </div>

            {/* ══════════════════════════════════════════════════════════
                CONTENEUR DE VUES
              ══════════════════════════════════════════════════════════ */}
            <div className="flex-1 min-h-0 overflow-hidden">

              {/* ═══════════════════════════════════════════════════════
                  ONGLET 1 : FRAGMENTS
                ═══════════════════════════════════════════════════════ */}
              {activeTab === "fragments" && (
                <>
                  {/* Sub-header retour pour résultats */}
                  {showResults && (
                    <div className="flex-shrink-0 px-6 pt-3 pb-1">
                      <button
                        onClick={handleBack}
                        className="flex items-center gap-2 text-white/50 hover:text-white/90 transition-colors"
                        style={{
                          fontSize: "13px",
                          fontWeight: 500,
                          letterSpacing: "0.03em",
                          background: "none",
                          border: "none",
                          cursor: "pointer",
                        }}
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M19 12H5" />
                          <path d="M12 19l-7-7 7-7" />
                        </svg>
                        {t.frag_back}
                      </button>
                    </div>
                  )}

              {/* VUE A : Filtres Fragments — agrandis, zéro scroll */}
              {!showResults && (
                <div className="h-full flex flex-col justify-between px-5 pt-4 pb-5 explore-view-in overflow-hidden">
                  {/* Bloc haut : Randomize + Filtres — gap agrandi */}
                  <div className="flex flex-col gap-5">
                    {/* Randomize — imposant */}
                    <button
                      onClick={handleRandomize}
                      disabled={fragments.length === 0}
                      className="w-full py-3 rounded-2xl text-black transition-all duration-200 active:scale-[0.97] disabled:opacity-30 disabled:cursor-not-allowed"
                      style={{
                        fontSize: "13px",
                        fontWeight: 800,
                        letterSpacing: "0.05em",
                        textTransform: "uppercase",
                        background: "linear-gradient(135deg, #FFD700 0%, #FFA500 100%)",
                        boxShadow: "0 4px 20px rgba(255,215,0,0.25)",
                      }}
                    >
                      ✦ {t.frag_random}
                    </button>

                    {/* Filtre Année */}
                    <div>
                      <label style={FRAG_LABEL}>{t.frag_year}</label>
                      {availableYears.length <= 12 ? (
                        <div className="flex flex-wrap gap-1.5">
                          <button onClick={() => setYear(null)} className="transition-all duration-150" style={FRAG_PILL(year === null, "#FFD700")}>{t.frag_all}</button>
                          {availableYears.map((y) => (
                            <button key={y} onClick={() => setYear(y)} className="transition-all duration-150" style={FRAG_PILL(year === y, "#FFD700")}>{y}</button>
                          ))}
                        </div>
                      ) : (
                        <select
                          value={year ?? ""}
                          onChange={(e) => setYear(e.target.value ? parseInt(e.target.value, 10) : null)}
                          className="w-full px-4 py-2.5 rounded-full bg-white/[0.04] border outline-none appearance-none cursor-pointer"
                          style={{
                            fontFamily: "'Montserrat', 'Inter', system-ui, sans-serif",
                            fontSize: "12px",
                            fontWeight: 500,
                            color: year !== null ? "#FFD700" : "rgba(255,255,255,0.55)",
                            borderColor: year !== null ? "rgba(255,215,0,0.25)" : "rgba(255,255,255,0.08)",
                            background: year !== null ? "rgba(255,215,0,0.12)" : "rgba(255,255,255,0.04)",
                            backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='rgba(255,215,0,0.4)' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E")`,
                            backgroundRepeat: "no-repeat",
                            backgroundPosition: "right 14px center",
                          }}
                        >
                          <option value="" style={{ background: "#111" }}>{t.frag_all}</option>
                          {availableYears.map((y) => (<option key={y} value={y} style={{ background: "#111" }}>{y}</option>))}
                        </select>
                      )}
                    </div>

                    {/* Filtre Pays */}
                    {availableCountries.length > 0 && (
                      <div>
                        <label style={FRAG_LABEL}>{t.frag_country}</label>
                        {availableCountries.length <= 10 ? (
                          <div className="flex flex-wrap gap-1.5">
                            <button onClick={() => setCountry(null)} className="transition-all duration-150" style={FRAG_PILL(country === null, "#FFD700")}>{t.frag_all}</button>
                            {availableCountries.map((c) => (
                              <button key={c} onClick={() => setCountry(c)} className="transition-all duration-150" style={FRAG_PILL(country === c, "#FFD700")}>{c}</button>
                            ))}
                          </div>
                        ) : (
                          <select
                            value={country ?? ""}
                            onChange={(e) => setCountry(e.target.value || null)}
                            className="w-full px-4 py-2.5 rounded-full bg-white/[0.04] border outline-none appearance-none cursor-pointer"
                            style={{
                              fontFamily: "'Montserrat', 'Inter', system-ui, sans-serif",
                              fontSize: "12px",
                              fontWeight: 500,
                              color: country !== null ? "#FFD700" : "rgba(255,255,255,0.55)",
                              borderColor: country !== null ? "rgba(255,215,0,0.25)" : "rgba(255,255,255,0.08)",
                              background: country !== null ? "rgba(255,215,0,0.12)" : "rgba(255,255,255,0.04)",
                              backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='rgba(255,215,0,0.4)' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E")`,
                              backgroundRepeat: "no-repeat",
                              backgroundPosition: "right 14px center",
                            }}
                          >
                            <option value="" style={{ background: "#111" }}>{t.frag_all}</option>
                            {availableCountries.map((c) => (<option key={c} value={c} style={{ background: "#111" }}>{c}</option>))}
                          </select>
                        )}
                      </div>
                    )}

                    {/* Filtre Thème — pills agrandies */}
                    <div>
                      <label style={FRAG_LABEL}>{t.frag_theme}</label>
                      <div className="flex flex-wrap gap-1.5">
                        {THEME_TAGS.map((t) => {
                          const active = t.key === "all" ? mood === null : mood === t.key;
                          return (
                            <button key={t.key} onClick={() => setMood(t.key === "all" ? null : t.key)} className="transition-all duration-150" style={FRAG_PILL(active, "#FFD700")}>
                              {t.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                  </div>

                  {/* Bloc bas : Bouton Rechercher — imposant, collé en bas */}
                  <div className="pt-4">
                    <button
                      onClick={handleSearch}
                      disabled={fragments.length === 0}
                      className="w-full py-3.5 rounded-2xl transition-all duration-200 active:scale-[0.97] disabled:opacity-30 disabled:cursor-not-allowed hover:bg-amber-400/10"
                      style={{
                        fontSize: "13px",
                        fontWeight: 700,
                        letterSpacing: "0.06em",
                        textTransform: "uppercase",
                        color: "#FFFFFF",
                        background: "transparent",
                        border: "1.5px solid #FFD700",
                      }}
                    >
                      {t.frag_search}
                    </button>

                    {fragments.length === 0 && historicalCount === 0 && (
                      <div style={{ textAlign: "center", fontSize: "11px", color: "rgba(255,255,255,0.2)", padding: "8px 0 0" }}>
                        {t.frag_waiting}
                      </div>
                    )}
                  </div>
                </div>
              )}

                  {/* VUE B : Résultats */}
                  {showResults && (
                    <div className="h-full explore-results-scroll overflow-y-auto story-scroll-gold px-6 pb-5 explore-view-in">
                      <div className="pt-1 pb-3">
                        <h3 style={{ fontSize: "12px", fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase", color: "rgba(255,255,255,0.5)", marginBottom: "6px" }}>
                          {t.frag_results}
                        </h3>
                        {summaryText && (
                          <p style={{ fontSize: "12px", fontWeight: 500, color: "#FFD700", lineHeight: 1.5 }}>{summaryText}</p>
                        )}
                        <div style={{ marginTop: "12px", height: "1px", background: "linear-gradient(90deg, transparent 5%, rgba(255,215,0,0.15) 50%, transparent 95%)" }} />
                      </div>
                      {filtered.length > 0 && (
                        <div key={searchKey} className="flex flex-col gap-2">
                          {filtered.map((f, i) => {
                            const emoji = MOOD_EMOJI[f.mood] || "💫";
                            const titleStr = f.title || "Sans titre";
                            const location = [f.city, f.country].filter((s) => s && s.trim()).join(", ");
                            return (
                              <button
                                key={f.id}
                                onClick={() => onFlyTo(f)}
                                className="explore-card w-full text-left px-4 py-3 rounded-xl transition-all duration-150 hover:bg-white/[0.07]"
                                style={{ background: "rgba(255,255,255,0.03)", animationDelay: `${i * 50}ms` }}
                              >
                                <div style={{ fontSize: "12px", fontWeight: 600, color: "#FFD700", lineHeight: 1.4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                  {emoji} {titleStr}
                                </div>
                                <div style={{ fontSize: "10px", fontWeight: 400, color: "rgba(255,255,255,0.35)", marginTop: "3px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                  {location && <span>{location} · </span>}
                                  <span>{f.year}</span>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      )}
                      {filtered.length === 0 && (
                        <div style={{ textAlign: "center", fontSize: "12px", color: "rgba(255,255,255,0.25)", padding: "32px 0", lineHeight: 1.7 }}>
                          {t.frag_empty}
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}

              {/* ═══════════════════════════════════════════════════════
                  ONGLET 2 : QUIZ — « Devinez l'Histoire »
                ═══════════════════════════════════════════════════════ */}
              {activeTab === "quiz" && (
                <div className="h-full flex flex-col min-h-0">

                  {/* ── Sticky header : Score + Titre ─────────────────── */}
                  <div className="flex-shrink-0 px-6">
                    {/* Défis Réussis — progress bar persistée */}
                    <div className="mt-3 mb-3 px-3 py-2.5 rounded-xl" style={{ background: "rgba(74,222,128,0.06)", border: "1px solid rgba(74,222,128,0.12)" }}>
                      <div className="flex items-center justify-between mb-2">
                        <span style={{ fontSize: "10px", fontWeight: 600, letterSpacing: "0.06em", color: "rgba(255,255,255,0.5)" }}>
                          ✅ {t.quiz_challenges}
                        </span>
                        <span style={{ fontSize: "12px", fontWeight: 700, color: "#4ADE80" }}>
                          {challengesWon}
                          <span style={{ fontWeight: 400, color: "rgba(255,255,255,0.25)", margin: "0 3px" }}>/</span>
                          <span style={{ fontWeight: 500, color: "rgba(255,255,255,0.5)" }}>{wikiEvents.length}</span>
                        </span>
                      </div>
                      {/* Progress bar */}
                      <div style={{ width: "100%", height: "4px", borderRadius: "999px", background: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
                        <div
                          style={{
                            width: `${wikiEvents.length > 0 ? Math.min((challengesWon / wikiEvents.length) * 100, 100) : 0}%`,
                            height: "100%",
                            borderRadius: "999px",
                            background: "linear-gradient(90deg, #4ADE80, #22C55E)",
                            transition: "width 0.6s ease-out",
                          }}
                        />
                      </div>
                    </div>

                {/* Titre — compact, sans description */}
                {gameStatus === "idle" && (
                  <div className="flex items-center justify-center gap-2" style={{ padding: "6px 0 2px" }}>
                    <span style={{ fontSize: "15px" }}>🏛️</span>
                    <h3 style={{ fontSize: "13px", fontWeight: 700, color: "rgba(255,255,255,0.9)", letterSpacing: "0.02em" }}>
                      {t.quiz_title}
                    </h3>
                  </div>
                )}
                  </div>

                  {/* ── Corps — remplir tout l'espace ─────────────────── */}
                  <div className="flex-1 min-h-0 overflow-hidden px-6">

              {/* ─────────────────────────────────────────────────
                  MODE IDLE — Menu de paramétrage (compact, justify-between)
                 ───────────────────────────────────────────────── */}
              {gameStatus === "idle" && (
                <div className="h-full flex flex-col justify-between pt-2 pb-4">

                  {/* Difficulté — deux boutons avec sous-titres */}
                  <div>
                    <label style={LABEL_STYLE}>{t.quiz_difficulty}</label>
                    <div className="flex gap-2">
                      {(["easy", "hard"] as const).map((d) => {
                        const active = quizDifficulty === d;
                        const isEasy = d === "easy";
                        return (
                          <button
                            key={d}
                            onClick={() => setQuizDifficulty(d)}
                            className="flex-1 py-2 rounded-lg transition-all duration-200 text-center"
                            style={{
                              fontSize: "11px",
                              fontWeight: active ? 700 : 400,
                              color: active ? (isEasy ? "#4FC3F7" : "#FF4444") : "rgba(255,255,255,0.4)",
                              background: active
                                ? (isEasy ? "rgba(79,195,247,0.1)" : "rgba(255,68,68,0.1)")
                                : "rgba(255,255,255,0.03)",
                              border: active
                                ? `1px solid ${isEasy ? "rgba(79,195,247,0.25)" : "rgba(255,68,68,0.25)"}`
                                : "1px solid rgba(255,255,255,0.06)",
                            }}
                          >
                            <div>{isEasy ? `🎯 ${t.quiz_easy}` : `🔥 ${t.quiz_expert}`}</div>
                            <div style={{ fontSize: "8px", fontWeight: 400, color: "rgba(255,255,255,0.25)", marginTop: "2px", lineHeight: 1.3 }}>
                              {isEasy ? t.quiz_easy_desc : t.quiz_expert_desc}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Zone de jeu */}
                  <div>
                    <label style={LABEL_STYLE}>{t.quiz_zone}</label>
                    <div className="flex gap-2">
                      {(["local", "world"] as const).map((z) => {
                        const active = quizZone === z;
                        const isWorld = z === "world";
                        return (
                          <button
                            key={z}
                            onClick={() => setQuizZone(z)}
                            className="flex-1 py-1.5 rounded-lg transition-all duration-200"
                            style={{
                              fontSize: "10px",
                              fontWeight: active ? 600 : 400,
                              color: active ? (isWorld ? "#BB86FC" : "#4FC3F7") : "rgba(255,255,255,0.4)",
                              background: active
                                ? (isWorld ? "rgba(187,134,252,0.1)" : "rgba(79,195,247,0.1)")
                                : "rgba(255,255,255,0.03)",
                              border: active
                                ? `1px solid ${isWorld ? "rgba(187,134,252,0.25)" : "rgba(79,195,247,0.25)"}`
                                : "1px solid rgba(255,255,255,0.06)",
                            }}
                          >
                            {isWorld ? `🌍 ${t.quiz_world}` : `📍 ${t.quiz_local}`}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Bloc haut : Filtres */}
                  <div className="flex flex-col gap-3">
                    {/* Filtre catégorie — pills compactes */}
                    <div>
                      <label style={LABEL_STYLE}>{t.quiz_category}</label>
                      <div className="flex flex-wrap gap-1">
                        {QUIZ_CAT_TAGS.map((t) => {
                          const active = t.key === "all" ? quizCatFilter === null : quizCatFilter === t.key;
                          return (
                            <button key={t.key} onClick={() => setQuizCatFilter(t.key === "all" ? null : t.key)} className="transition-all duration-150" style={PILL_COMPACT(active, t.color)}>
                              {t.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Filtre Époque — pills compactes */}
                    <div>
                      <label style={LABEL_STYLE}>{t.quiz_epoch}</label>
                      <div className="flex flex-wrap gap-1">
                        {EPOCH_TAGS.map((t) => {
                          const active = t.key === "all" ? quizEpoch === "all" : quizEpoch === t.key;
                          return (
                            <button key={t.key} onClick={() => setQuizEpoch(t.key)} className="transition-all duration-150" style={PILL_COMPACT(active, t.color)}>
                              {t.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Messages d'aide contextuels */}
                    {quizPool.length < 2 && !isWorldLoading && quizSource.length > 0 && (
                      <p style={{ textAlign: "center", fontSize: "10px", color: "rgba(255,183,77,0.6)", lineHeight: 1.4 }}>
                        {t.quiz_no_events}
                      </p>
                    )}
                    {quizSource.length === 0 && !isWorldLoading && (
                      <p style={{ textAlign: "center", fontSize: "10px", color: "rgba(255,255,255,0.25)", lineHeight: 1.4 }}>
                        {quizZone === "world"
                          ? t.quiz_check_connection
                          : t.quiz_move_globe}
                      </p>
                    )}
                  </div>

                  {/* Bloc bas : Bouton Lancer + Collection — collés en bas */}
                  <div className="flex flex-col gap-2 pt-2">
                    {/* Smart Loading spinner */}
                    {isWorldLoading && (
                      <div className="flex items-center justify-center gap-2 py-1" style={{ animation: "quizToastIn 0.3s ease-out" }}>
                        <div className="rounded-full" style={{ width: "12px", height: "12px", border: "2px solid rgba(187,134,252,0.15)", borderTopColor: "#BB86FC", animation: "spin 0.8s linear infinite" }} />
                        <span style={{ fontSize: "10px", color: "rgba(187,134,252,0.6)", fontWeight: 500 }}>{t.quiz_loading}</span>
                      </div>
                    )}

                    {/* Bouton Lancer + compteur inline */}
                    <div className="flex items-center gap-3">
                      <button
                        onClick={handleStartQuiz}
                        disabled={quizPool.length < 2 || isWorldLoading}
                        className="flex-1 py-2.5 rounded-xl transition-all duration-200 active:scale-[0.97] disabled:opacity-30 disabled:cursor-not-allowed"
                        style={{
                          fontSize: "11px",
                          fontWeight: 700,
                          letterSpacing: "0.05em",
                          textTransform: "uppercase",
                          color: "#000",
                          background: "linear-gradient(135deg, #BB86FC 0%, #9C27B0 100%)",
                          boxShadow: "0 2px 16px rgba(187,134,252,0.25)",
                        }}
                      >
                        {isWorldLoading ? t.quiz_loading : t.quiz_launch}
                      </button>
                      <span style={{ fontSize: "9px", color: "rgba(255,255,255,0.2)", whiteSpace: "nowrap", flexShrink: 0 }}>
                        {quizPool.length} {t.quiz_available}
                      </span>
                    </div>

                  </div>
                </div>
              )}

                  {/* ─────────────────────────────────────────────────
                      MODE PLAYING — Question active
                    ───────────────────────────────────────────────── */}
                  {gameStatus === "playing" && currentQuestion && (
                    <div className="flex flex-col gap-4 pt-3">
                      {/* Description masquée */}
                      <div
                        className="rounded-xl px-4 py-4"
                        style={{
                          background: "rgba(187,134,252,0.06)",
                          border: "1px solid rgba(187,134,252,0.12)",
                          fontSize: "12px",
                          fontWeight: 300,
                          color: "rgba(255,255,255,0.8)",
                          lineHeight: 1.6,
                          letterSpacing: "0.01em",
                        }}
                      >
                        <div style={{ fontSize: "10px", fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: "#BB86FC", marginBottom: "8px" }}>
                          {t.game_question}
                        </div>
                        {currentQuestion.maskedDescription || "Description non disponible."}
                      </div>

                      {/* Indices révélés */}
                      <div className="flex flex-col gap-2">
                        {/* Indice 1 : Catégorie */}
                        {hintsRevealed >= 1 && (
                          <div className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
                            <span style={{ fontSize: "10px", fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: CAT_COLOR[currentQuestion.hints.category] || "#BB86FC" }}>
                              {t.game_category_hint}
                            </span>
                            <span style={{ fontSize: "12px", color: "rgba(255,255,255,0.7)" }}>
                              {CAT_LABEL[currentQuestion.hints.category] || currentQuestion.hints.category}
                            </span>
                          </div>
                        )}
                        {/* Indice 2 : Année */}
                        {hintsRevealed >= 2 && currentQuestion.hints.year && (
                          <div className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
                            <span style={{ fontSize: "10px", fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "#FFD700" }}>
                              {t.game_year_hint}
                            </span>
                            <span style={{ fontSize: "12px", color: "rgba(255,255,255,0.7)" }}>
                              {currentQuestion.hints.year < 0
                                ? `${Math.abs(currentQuestion.hints.year)} av. J.-C.`
                                : currentQuestion.hints.year}
                            </span>
                          </div>
                        )}
                        {/* Indice 3 : Verbes d'action */}
                        {hintsRevealed >= 3 && currentQuestion.hints.actions.length > 0 && (
                          <div className="flex items-center gap-2 px-3 py-2 rounded-lg flex-wrap" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
                            <span style={{ fontSize: "10px", fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "#FFB74D" }}>
                              {t.game_actions_hint}
                            </span>
                            {currentQuestion.hints.actions.map((v) => (
                              <span key={v} style={{ fontSize: "11px", color: "rgba(255,255,255,0.6)", padding: "2px 8px", borderRadius: "999px", background: "rgba(255,183,77,0.1)", border: "1px solid rgba(255,183,77,0.15)" }}>
                                {v}
                              </span>
                            ))}
                          </div>
                        )}

                        {/* Bouton Révéler */}
                        {hintsRevealed < 3 && (
                          <button
                            onClick={handleRevealHint}
                            className="self-start transition-all duration-150 hover:bg-white/[0.06]"
                            style={{
                              padding: "6px 14px",
                              borderRadius: "999px",
                              fontSize: "11px",
                              fontWeight: 500,
                              color: "rgba(255,255,255,0.4)",
                              background: "rgba(255,255,255,0.03)",
                              border: "1px solid rgba(255,255,255,0.08)",
                            }}
                          >
                            💡 {t.game_hint} {hintsRevealed + 1}/3
                            <span style={{ fontSize: "9px", color: "rgba(255,255,255,0.25)", marginLeft: "6px" }}>
                              {t.game_hint_pts}
                            </span>
                          </button>
                        )}
                      </div>

                      {/* Séparateur */}
                      <div style={{ height: "1px", background: "linear-gradient(90deg, transparent, rgba(187,134,252,0.15), transparent)" }} />

                      {/* ── Réponse : QCM (facile) ─────────────────── */}
                      {currentQuestion.difficulty === "easy" && (
                        <div className="flex flex-col gap-2">
                          <label style={{ ...LABEL_STYLE, color: "rgba(187,134,252,0.5)" }}>{t.game_choose}</label>
                          {currentQuestion.options.map((opt) => (
                            <button
                              key={opt}
                              onClick={() => handleSubmitAnswer(opt)}
                              className="w-full text-left px-4 py-3 rounded-xl transition-all duration-150 hover:bg-white/[0.07] active:scale-[0.98]"
                              style={{
                                background: "rgba(255,255,255,0.03)",
                                border: "1px solid rgba(255,255,255,0.06)",
                                fontSize: "12px",
                                fontWeight: 500,
                                color: "rgba(255,255,255,0.8)",
                                lineHeight: 1.4,
                              }}
                            >
                              {opt}
                            </button>
                          ))}
                        </div>
                      )}

                      {/* ── Réponse : Saisie libre (difficile) ─────── */}
                      {currentQuestion.difficulty === "hard" && (
                        <div className="flex flex-col gap-2 relative">
                          <label style={{ ...LABEL_STYLE, color: "rgba(187,134,252,0.5)" }}>{t.game_type_answer}</label>
                          <div className="relative">
                            <input
                              ref={freeInputRef}
                              type="text"
                              value={freeTextAnswer}
                              onChange={(e) => {
                                setFreeTextAnswer(e.target.value);
                                setShowAutocomplete(true);
                              }}
                              onFocus={() => setShowAutocomplete(true)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" && freeTextAnswer.trim()) {
                                  handleSubmitAnswer(freeTextAnswer.trim());
                                }
                              }}
                              placeholder={t.game_placeholder}
                              className="w-full px-4 py-3 rounded-xl text-sm outline-none transition-colors"
                              style={{
                                background: "rgba(255,255,255,0.04)",
                                border: "1px solid rgba(187,134,252,0.2)",
                                color: "rgba(255,255,255,0.9)",
                                fontFamily: "'Montserrat', 'Inter', system-ui, sans-serif",
                              }}
                            />

                            {/* Autocomplétion */}
                            {showAutocomplete && autocompleteSuggestions.length > 0 && (
                              <div
                                className="absolute left-0 right-0 rounded-xl overflow-hidden"
                                style={{
                                  top: "calc(100% + 4px)",
                                  background: "rgba(15,15,20,0.95)",
                                  backdropFilter: "blur(16px)",
                                  border: "1px solid rgba(187,134,252,0.15)",
                                  zIndex: 10,
                                  maxHeight: "180px",
                                  overflowY: "auto",
                                }}
                              >
                                {autocompleteSuggestions.map((s) => (
                                  <button
                                    key={s}
                                    onClick={() => {
                                      setFreeTextAnswer(s);
                                      setShowAutocomplete(false);
                                      freeInputRef.current?.focus();
                                    }}
                                    className="w-full text-left px-4 py-2.5 transition-colors hover:bg-white/[0.06]"
                                    style={{
                                      fontSize: "12px",
                                      color: "rgba(255,255,255,0.7)",
                                      borderBottom: "1px solid rgba(255,255,255,0.04)",
                                    }}
                                  >
                                    {s}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                          <button
                            onClick={() => {
                              if (freeTextAnswer.trim()) handleSubmitAnswer(freeTextAnswer.trim());
                            }}
                            disabled={!freeTextAnswer.trim()}
                            className="w-full py-3 rounded-xl transition-all duration-200 active:scale-[0.97] disabled:opacity-30 disabled:cursor-not-allowed"
                            style={{
                              fontSize: "13px",
                              fontWeight: 600,
                              letterSpacing: "0.05em",
                              textTransform: "uppercase",
                              color: "#FFF",
                              background: "transparent",
                              border: "1px solid #BB86FC",
                            }}
                          >
                            Valider
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {/* ─────────────────────────────────────────────────
                      MODE RESULT — Résultat de la question
                    ───────────────────────────────────────────────── */}
                  {gameStatus === "result" && currentQuestion && quizResult && (
                    <div className="flex flex-col gap-4 pt-3 items-center">

                      {/* Particules dorées si victoire */}
                      {quizResult.correct && (
                        <div className="relative w-full flex justify-center" style={{ height: "0px", overflow: "visible" }}>
                          {[...Array(12)].map((_, i) => (
                            <span
                              key={i}
                              style={{
                                position: "absolute",
                                fontSize: `${10 + Math.random() * 8}px`,
                                left: `${10 + Math.random() * 80}%`,
                                top: `${-10 - Math.random() * 30}px`,
                                opacity: 0,
                                animation: `quizConfetti 1.5s ease-out ${i * 0.08}s forwards`,
                                pointerEvents: "none",
                              }}
                            >
                              {["✦", "✧", "⭐", "💫", "🌟"][i % 5]}
                            </span>
                          ))}
                        </div>
                      )}

                      {/* Icône résultat */}
                      <div style={{ fontSize: "48px", marginTop: "8px", animation: "quizResultPop 0.5s cubic-bezier(0.34,1.56,0.64,1)" }}>
                        {quizResult.correct ? "🎉" : "😔"}
                      </div>
                      <h3 style={{
                        fontSize: "15px",
                        fontWeight: 700,
                        color: quizResult.correct ? "#FFD700" : "#FF4444",
                        textAlign: "center",
                        lineHeight: 1.4,
                      }}>
                        {quizResult.correct ? "Félicitations !" : "Ce n'est pas la bonne réponse…"}
                      </h3>
                      {quizResult.correct && (
                        <p style={{ fontSize: "11px", color: "rgba(255,255,255,0.45)", textAlign: "center", marginTop: "-8px", lineHeight: 1.5 }}>
                          Événement ajouté à votre collection !
                        </p>
                      )}
                      {!quizResult.correct && (
                        <p style={{ fontSize: "11px", color: "rgba(255,255,255,0.4)", textAlign: "center", marginTop: "-8px", lineHeight: 1.5 }}>
                          Découvrez l'histoire pour mieux connaître cet événement.
                        </p>
                      )}

                      {/* Points gagnés */}
                      <div
                        className="px-5 py-3 rounded-xl w-full"
                        style={{
                          background: quizResult.correct ? "rgba(255,215,0,0.06)" : "rgba(255,68,68,0.06)",
                          border: `1px solid ${quizResult.correct ? "rgba(255,215,0,0.2)" : "rgba(255,68,68,0.15)"}`,
                          textAlign: "center",
                        }}
                      >
                        <div style={{ fontSize: "30px", fontWeight: 700, color: quizResult.correct ? "#FFD700" : "#FF4444" }}>
                          {quizResult.correct ? `+${quizResult.points}` : "0"}
                        </div>
                        <div style={{ fontSize: "10px", color: "rgba(255,255,255,0.35)", marginTop: "2px" }}>
                          {quizResult.correct ? "points gagnés" : "points"}
                          {quizResult.hintsUsed > 0 && ` · ${quizResult.hintsUsed} indice${quizResult.hintsUsed > 1 ? "s" : ""}`}
                          {quizResult.wasQCM && " · QCM (×0.5)"}
                        </div>
                      </div>

                      {/* Bonne réponse */}
                      <div
                        className="w-full px-4 py-3 rounded-xl"
                        style={{
                          background: "rgba(187,134,252,0.06)",
                          border: "1px solid rgba(187,134,252,0.12)",
                        }}
                      >
                        <div style={{ fontSize: "10px", fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "#BB86FC", marginBottom: "4px" }}>
                          {quizResult.correct ? "Vous avez trouvé" : "La réponse était"}
                        </div>
                        <div style={{ fontSize: "14px", fontWeight: 600, color: "rgba(255,255,255,0.9)" }}>
                          {currentQuestion.correctTitle}
                        </div>
                        {currentQuestion.hints.year && (
                          <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.4)", marginTop: "2px" }}>
                            {currentQuestion.hints.year < 0
                              ? `${Math.abs(currentQuestion.hints.year)} av. J.-C.`
                              : currentQuestion.hints.year}
                            {" · "}
                            {CAT_LABEL[currentQuestion.hints.category] || currentQuestion.hints.category}
                          </div>
                        )}
                      </div>

                      {/* Bouton « Voir l'histoire complète » */}
                      {currentQuizEvent && (
                        <button
                          onClick={() => {
                            onQuizEnd?.();
                            onViewHistory?.(currentQuizEvent);
                          }}
                          className="w-full py-3 rounded-xl transition-all duration-200 hover:bg-white/[0.08] active:scale-[0.97]"
                          style={{
                            fontSize: "12px",
                            fontWeight: 600,
                            letterSpacing: "0.04em",
                            color: "#BB86FC",
                            background: "rgba(187,134,252,0.06)",
                            border: "1px solid rgba(187,134,252,0.2)",
                          }}
                        >
                          📖 Voir l'histoire complète
                        </button>
                      )}

                      {/* Boutons d'action */}
                      <div className="flex gap-2 w-full">
                        <button
                          onClick={handleStartQuiz}
                          className="flex-1 py-3 rounded-xl transition-all duration-200 active:scale-[0.97]"
                          style={{
                            fontSize: "12px",
                            fontWeight: 600,
                            letterSpacing: "0.05em",
                            textTransform: "uppercase",
                            color: "#000",
                            background: "linear-gradient(135deg, #BB86FC 0%, #9C27B0 100%)",
                          }}
                        >
                          Question suivante
                        </button>
                        {!quizResult.correct && (
                          <button
                            onClick={handleStartQuiz}
                            className="py-3 px-4 rounded-xl transition-all duration-200 hover:bg-white/[0.06]"
                            style={{
                              fontSize: "12px",
                              fontWeight: 500,
                              color: "#FFB74D",
                              background: "rgba(255,183,77,0.06)",
                              border: "1px solid rgba(255,183,77,0.2)",
                            }}
                          >
                            Retenter
                          </button>
                        )}
                        <button
                          onClick={handleNextQuestion}
                          className="py-3 px-4 rounded-xl transition-all duration-200 hover:bg-white/[0.06]"
                          style={{
                            fontSize: "12px",
                            fontWeight: 500,
                            color: "rgba(255,255,255,0.5)",
                            background: "rgba(255,255,255,0.03)",
                            border: "1px solid rgba(255,255,255,0.08)",
                          }}
                        >
                          Menu
                        </button>
                      </div>
                    </div>
                  )}
                  </div>
                </div>
              )}
            </div>

            {/* ── Toast de succès (superposé en haut) ───────────────── */}
            {showSuccessToast && (
              <div
                className="absolute left-4 right-4 flex items-center gap-3 px-4 py-3 rounded-xl"
                style={{
                  top: "12px",
                  zIndex: 50,
                  background: "rgba(255,215,0,0.12)",
                  border: "1px solid rgba(255,215,0,0.25)",
                  backdropFilter: "blur(16px)",
                  animation: "quizToastIn 0.4s ease-out",
                }}
              >
                <span style={{ fontSize: "22px" }}>🏆</span>
                <div>
                  <div style={{ fontSize: "13px", fontWeight: 700, color: "#FFD700" }}>
                    Événement découvert !
                  </div>
                  <div style={{ fontSize: "10px", color: "rgba(255,255,255,0.5)", marginTop: "1px" }}>
                    Ajouté à votre collection ({discoveries.size} au total)
                  </div>
                </div>
              </div>
            )}

            {/* ── Footer persistant ─────────────────────────────────── */}
            <div
              className="flex-shrink-0 px-5 py-2 flex items-center justify-center gap-1"
              style={{
                fontSize: "10px",
                fontWeight: 400,
                letterSpacing: "0.03em",
                color: "rgba(255,255,255,0.3)",
                borderTop: "1px solid rgba(255,255,255,0.04)",
              }}
            >
              <span style={{ color: "#FFD700", fontWeight: 600 }}>✨ {fragments.length}</span>
              <span style={{ color: "rgba(255,255,255,0.4)" }}>Fragment{fragments.length !== 1 ? "s" : ""}</span>
              <span style={{ color: "rgba(255,255,255,0.1)", margin: "0 4px" }}>|</span>
              <span style={{ color: "#BB86FC", fontWeight: 600 }}>📜 {historicalCount}</span>
              <span style={{ color: "rgba(255,255,255,0.4)" }}>Histoire{historicalCount !== 1 ? "s" : ""}</span>
              {/* Info tooltip */}
              <span
                className="relative group"
                style={{ marginLeft: "4px", cursor: "help" }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 16v-4" />
                  <path d="M12 8h.01" />
                </svg>
                <span
                  className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 rounded-lg text-center opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity duration-200"
                  style={{
                    width: "200px",
                    fontSize: "10px",
                    lineHeight: 1.5,
                    fontWeight: 400,
                    color: "rgba(255,255,255,0.7)",
                    background: "rgba(0,0,0,0.9)",
                    border: "1px solid rgba(255,255,255,0.1)",
                    whiteSpace: "normal",
                  }}
                >
                  <strong style={{ color: "#FFD700" }}>Fragments</strong> : vos souvenirs enregistrés
                  <br />
                  <strong style={{ color: "#BB86FC" }}>Histoires</strong> : points Wikipedia chargés
                </span>
              </span>
            </div>
          </div>
        </div>
      );
    }
