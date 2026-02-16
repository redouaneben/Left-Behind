"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import mapboxgl from "mapbox-gl";
import { supabase } from "@/lib/supabaseClient";
import { fetchWikiEvents } from "@/lib/wikipedia";
import type { WikiEvent } from "@/lib/wikipedia";
import ExplorePanel from "./ExplorePanel";
import type { ExploreFilters } from "./ExplorePanel";
import GamePanel from "./GamePanel";
import type { GamePanelProps } from "./GamePanel";
import type { QuizQuestion } from "@/lib/gameEngine";

// ═══════════════════════════════════════════════════════════════════
//  TYPES
// ═══════════════════════════════════════════════════════════════════
export interface FragmentData {
  id: string;
  lat: number;
  lng: number;
  year: number;
  title: string;     // colonne "title" dans Supabase
  content: string;   // colonne "content" dans Supabase
  mood: string;
  country?: string;  // colonne "country" dans Supabase (optionnelle)
  city?: string;     // colonne "city" dans Supabase (optionnelle)
  isNew?: boolean;   // UI optimiste — flash de naissance
}

/** Point sélectionné sur la carte — peut être un fragment humain ou un event historique */
export interface SelectedPoint {
  kind: "fragment" | "history";
  id: string;
  title: string;       // title pour history, début du content pour fragment
  year: number | null;
  content: string;     // content pour fragment, description pour history
  category: string;    // category pour history, mood pour fragment
  lat: number;
  lng: number;
}

interface MapGlobeProps {
  onFirstInteraction?: () => void;
  /** Appelé quand l'utilisateur clique sur le globe en mode viseur */
  onRequestFragment?: (coords: { lng: number; lat: number }) => void;
  /** Coordonnées du spot temporaire (doré scintillant) — null = aucun */
  pendingSpotCoords?: { lng: number; lat: number } | null;
  /** Fragments confirmés à afficher en permanence */
  fragments?: FragmentData[];
  /** Callback quand les fragments sont chargés depuis Supabase */
  onLoadFragments?: (frags: FragmentData[]) => void;
  /** Callback quand l'utilisateur clique sur un point (fragment ou historique) */
  onSelectPoint?: (point: SelectedPoint | null) => void;
  /** Afficher la Tab Bar (false pendant la landing page) */
  showTabBar?: boolean;
  /** Coordonnées du point sélectionné pour afficher la couronne */
  highlightCoords?: { lng: number; lat: number } | null;
  /** Type du point sélectionné — adapte la couleur de la couronne */
  highlightKind?: "fragment" | "history" | null;
  /** Coordonnées vers lesquelles voler (deep link) — déclenche un flyTo quand défini */
  flyToCoords?: { lng: number; lat: number; zoom?: number } | null;
}

// ═══════════════════════════════════════════════════════════════════
//  CONSTANTES — Toute la physique est ici
// ═══════════════════════════════════════════════════════════════════
const EARTH_R = 6_371; // km
const ROTATION_SPEED = 0.006; // °/frame (≈ 0.36 °/s à 60fps)

// ── Filtre zoom progressif pour les points historiques ──────────
// Incontournables toujours visibles. Sinon :
//   zoom 0-4 : notoriété ≥ 50 langues (que les piliers)
//   zoom 5-7 : notoriété ≥ 15
//   zoom 8+  : tout visible
const ZOOM_NOTORIETY_FILTER: any = [
  "any",
  ["==", ["get", "isIncontournable"], 1],
  [">=",
    ["coalesce", ["get", "notorietyScore"], 0],
    ["step", ["zoom"],
      50,     // zoom 0-4
      5, 15,  // zoom 5-7
      8, 0,   // zoom 8+
    ],
  ],
];
const DRIFT_FRICTION = 0.987; // décélération par frame (1 = pas de friction)
const DRIFT_THRESHOLD = 0.0003; // en dessous → drift terminé
const SHOCKWAVE_DURATION = 600; // ms — goutte d'or rapide
const SHOCKWAVE_MAX_OUTER = 350; // km — rayon max anneau doré
const SHOCKWAVE_MAX_INNER = 120; // km — rayon max cœur doré

/** Clamp une valeur entre 0 et 1 — Mapbox CRASHE si opacity > 1 ou < 0 */
function safeOp(v: number): number {
  return Math.min(1, Math.max(0, v));
}

/**
 * Expression Mapbox `match` — couleur par catégorie historique.
 * 💀 shock: #FF4444 | 🏛️ civilization: #4FC3F7 | ✊ struggle: #FFB74D | 🌍 origins: #E0E0E0
 * Fallback: #BB86FC (violet par défaut si catégorie absente)
 */
const HIST_CAT_COLOR_EXPR: mapboxgl.Expression = [
  "match", ["get", "category"],
  "shock",        "#FF4444",
  "civilization",  "#4FC3F7",
  "struggle",     "#FFB74D",
  "origins",      "#E0E0E0",
  "#BB86FC", // fallback
];
/** Version Light Mode — rouge par défaut, couleurs légèrement ajustées */
const HIST_CAT_COLOR_LIGHT: mapboxgl.Expression = [
  "match", ["get", "category"],
  "shock",        "#C62828",
  "civilization",  "#0277BD",
  "struggle",     "#EF6C00",
  "origins",      "#616161",
  "#E53935", // fallback
];

// ═══════════════════════════════════════════════════════════════════
//  HELPERS — Cercle géodésique (Vincenty sphérique)
//  Projette un vrai cercle sur la sphère terrestre.
// ═══════════════════════════════════════════════════════════════════
function buildGeoCircle(
  center: [number, number],
  radiusKm: number,
  steps = 72
): GeoJSON.Feature<GeoJSON.Polygon> {
  const [lngDeg, latDeg] = center;
  const lat0 = (latDeg * Math.PI) / 180;
  const lng0 = (lngDeg * Math.PI) / 180;
  const d = radiusKm / EARTH_R;

  const coords: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const brng = ((2 * Math.PI) / steps) * i;
    const lat = Math.asin(
      Math.sin(lat0) * Math.cos(d) +
        Math.cos(lat0) * Math.sin(d) * Math.cos(brng)
    );
    const lng =
      lng0 +
      Math.atan2(
        Math.sin(brng) * Math.sin(d) * Math.cos(lat0),
        Math.cos(d) - Math.sin(lat0) * Math.sin(lat)
      );
    coords.push([(lng * 180) / Math.PI, (lat * 180) / Math.PI]);
  }

  return {
    type: "Feature",
    properties: {},
    geometry: { type: "Polygon", coordinates: [coords] },
  };
}

/** GeoJSON vides (placeholders) */
const EMPTY_FC: GeoJSON.FeatureCollection = {
  type: "FeatureCollection",
  features: [],
};

const EMPTY_POLY: GeoJSON.Feature<GeoJSON.Polygon> = {
  type: "Feature",
  properties: {},
  geometry: { type: "Polygon", coordinates: [[]] },
};

// ═══════════════════════════════════════════════════════════════════
//  SUPABASE — lecture des données (fragments dorés + histoire dorée)
// ═══════════════════════════════════════════════════════════════════

/** Récupère tous les fragments humains depuis Supabase.
 *  Utilise select("*") pour éviter tout problème de colonne manquante. */
export async function fetchFragmentsFromDB(): Promise<FragmentData[]> {
  const { data, error } = await supabase
    .from("fragments")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[Supabase:fragments] ERREUR COMPLÈTE:", JSON.stringify(error, null, 2));
    return [];
  }
  return (data ?? []).map((r: any) => ({
    id: String(r.id),
    lat: r.lat,
    lng: r.lng,
    year: r.year,
    title: r.title ?? "",
    content: r.content ?? "",
    mood: r.mood ?? "",
    country: r.country ?? "",
    city: r.city ?? "",
  }));
}

/** Reverse Geocoding via l'API Mapbox — renvoie { city, country }
 *  Utilise le endpoint Geocoding v5 (gratuit avec le token). */
export async function reverseGeocode(
  lat: number,
  lng: number
): Promise<{ city: string; country: string }> {
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || "";
  if (!token) return { city: "", country: "" };

  try {
    const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?types=place,country&language=fr&access_token=${token}`;
    const resp = await fetch(url);
    if (!resp.ok) {
      console.warn("[reverseGeocode] HTTP", resp.status);
      return { city: "", country: "" };
    }
    const json = await resp.json();
    const features: any[] = json.features ?? [];

    let city = "";
    let country = "";
    for (const f of features) {
      const type: string = f.place_type?.[0] ?? "";
      if (type === "place" && !city) city = f.text ?? "";
      if (type === "country" && !country) country = f.text ?? "";
    }
    // Fallback : contexte du premier résultat
    if (!country && features.length > 0) {
      const ctx = features[0].context ?? [];
      for (const c of ctx) {
        if (String(c.id ?? "").startsWith("country") && !country) {
          country = c.text ?? "";
        }
      }
    }
    if (!city && features.length > 0) {
      const ctx = features[0].context ?? [];
      for (const c of ctx) {
        if (String(c.id ?? "").startsWith("place") && !city) {
          city = c.text ?? "";
        }
      }
    }

    console.log(`[reverseGeocode] ${lat},${lng} → city: "${city}", country: "${country}"`);
    return { city, country };
  } catch (err) {
    console.error("[reverseGeocode] Erreur:", err);
    return { city: "", country: "" };
  }
}

/** Insère un nouveau fragment dans Supabase et renvoie l'objet inséré.
 *  Inclut title, city et country. */
export async function addFragmentToDB(
  lat: number,
  lng: number,
  year: number,
  title: string,
  content: string,
  mood: string,
  city: string = "",
  country: string = ""
): Promise<FragmentData | null> {
  const payload: Record<string, any> = { lat, lng, year, content, mood };
  if (title.trim()) payload.title = title.trim();
  if (city.trim()) payload.city = city.trim();
  if (country.trim()) payload.country = country.trim();

  const res = await supabase
    .from("fragments")
    .insert([payload])
    .select("*")
    .single();

  if (res.error) {
    console.error("[Supabase:addFragment] ÉCHEC:", JSON.stringify(res.error, null, 2));
    return null;
  }

  const d = res.data;
  return {
    id: String(d.id),
    lat: d.lat,
    lng: d.lng,
    year: d.year,
    title: d.title ?? title,
    content: d.content ?? "",
    mood: d.mood ?? "",
    country: d.country ?? country,
    city: d.city ?? city,
  };
}

/** Récupère les événements historiques depuis Supabase */
export interface HistoricalEventDB {
  id: number;
  title: string;        // colonne "title" dans Supabase
  category: string;     // colonne "category" dans Supabase
  lat: number;
  lng: number;
  year?: number | null;
  description?: string | null;
  notorietyScore?: number;    // nombre de langues Wikipedia (0 pour Supabase)
  isIncontournable?: boolean; // true si trouvé par srsearch — bypass zoom filter
}

export async function fetchHistoricalFromDB(): Promise<HistoricalEventDB[]> {
  const { data, error } = await supabase
    .from("historical_events")
    .select("id, year, title, description, lat, lng, category");
  if (error) {
    console.warn("[Supabase:historical]", error.message);
    return [];
  }
  return (data ?? []).map((r: any) => ({
    id: r.id,
    title: r.title ?? "",
    category: r.category ?? "",
    lat: r.lat,
    lng: r.lng,
    year: r.year ?? null,
    description: r.description ?? "",
  }));
}

/** Convertit les événements historiques en GeoJSON */
function historicalToGeoJSON(
  events: HistoricalEventDB[]
): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: events.map((e) => ({
      type: "Feature" as const,
      properties: {
        id: e.id,
        title: e.title,
        category: e.category,
        year: e.year ?? null,
        description: e.description ?? "",
        notorietyScore: e.notorietyScore ?? 0,
        isIncontournable: e.isIncontournable ? 1 : 0, // Mapbox ne gère pas les booleans natifs dans les expressions
      },
      geometry: {
        type: "Point" as const,
        coordinates: [e.lng, e.lat],
      },
    })),
  };
}

/** Convertit les fragments en GeoJSON */
function fragmentsToGeoJSON(
  frags: FragmentData[]
): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: frags.map((f) => ({
      type: "Feature" as const,
      properties: {
        id: f.id,
        year: f.year,
        title: f.title ?? "",
        content: f.content,
        mood: f.mood,
      },
      geometry: {
        type: "Point" as const,
        coordinates: [f.lng, f.lat],
      },
    })),
  };
}

// ═══════════════════════════════════════════════════════════════════
//  COMPOSANT PRINCIPAL
// ═══════════════════════════════════════════════════════════════════
export default function MapGlobe({
  onFirstInteraction,
  onRequestFragment,
  pendingSpotCoords,
  fragments,
  onLoadFragments,
  onSelectPoint,
  showTabBar = true,
  highlightCoords,
  highlightKind,
  flyToCoords,
}: MapGlobeProps) {
  // ── Refs stables (jamais de re-render côté animation) ─────────
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);

  // Refs miroir pour capturer les callbacks dans la closure du useEffect([])
  const onSelectPointRef = useRef(onSelectPoint);
  onSelectPointRef.current = onSelectPoint;
  const onLoadFragmentsRef = useRef(onLoadFragments);
  onLoadFragmentsRef.current = onLoadFragments;
  const onRequestFragmentRef = useRef(onRequestFragment);
  onRequestFragmentRef.current = onRequestFragment;

  // Animation core
  const hasInteractedRef = useRef(false);
  const isAutoRotatingRef = useRef(true);
  const isUserTouchingRef = useRef(false);
  const isDriftingRef = useRef(false);
  const rotAngleRef = useRef(0);
  const rafRef = useRef(0);

  // Orbital drift
  const velocityRef = useRef({ lng: 0, lat: 0 });
  const lastCenterRef = useRef<{ lng: number; lat: number } | null>(null);

  // Shockwave
  const shockRafRef = useRef(0);

  // Birth flash
  const birthStartRef = useRef(0);

  // Historical events
  // histDebounceRef supprimé — chargement unique au démarrage via Supabase

  // Targeting mode ref (pas un state pour ne pas recréer les listeners)
  const isTargetingRef = useRef(false);
  // Ref miroir pour pendingSpotCoords (réinjection après setStyle)
  const pendingSpotCoordsRef = useRef<{ lng: number; lat: number } | null>(null);
  pendingSpotCoordsRef.current = pendingSpotCoords ?? null;

  // Crown marker — couronne tournante autour du point sélectionné
  const crownMarkerRef = useRef<mapboxgl.Marker | null>(null);

  // ── État UI ───────────────────────────────────────────────────
  type ViewMode = "night" | "light" | "map" | "satellite";
  const [viewMode, setViewMode] = useState<ViewMode>("night");
  const [isTargeting, setIsTargeting] = useState(false);
  // Ref miroir pour lire dataMode dans un callback async (style.load)
  const dataModeRef = useRef<"all" | "fragments" | "history">("all");
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);
  const [showViewMenu, setShowViewMenu] = useState(false);
  const [showExplore, setShowExplore] = useState(false);
  const [historicalCount, setHistoricalCount] = useState(0);
  const [wikiEventsForQuiz, setWikiEventsForQuiz] = useState<WikiEvent[]>([]);

  // ── Quiz Game Mode ──────────────────────────────────────────
  const [isGaming, setIsGaming] = useState(false);
  const [quizCoords, setQuizCoords] = useState<{ lng: number; lat: number } | null>(null);
  // ── GamePanel (fenêtre quiz externe draggable) ──────────────
  const [gamePanelData, setGamePanelData] = useState<{
    question: QuizQuestion;
    event: WikiEvent;
    difficulty: "easy" | "hard";
  } | null>(null);
  const [quizCategory, setQuizCategory] = useState<string>(""); // pour couleur du marqueur
  const isGamingRef = useRef(false);
  type DataMode = "all" | "fragments" | "history";
  const [dataMode, setDataMode] = useState<DataMode>("all");
  // Synchronise le ref miroir quand dataMode change
  useEffect(() => { dataModeRef.current = dataMode; }, [dataMode]);

  // Ref miroir pour lire viewMode dans style.load (closure du useEffect [])
  const viewModeRef = useRef<ViewMode>("night");
  useEffect(() => { viewModeRef.current = viewMode; }, [viewMode]);

  // Suivi du style Mapbox actuellement chargé (pour détecter satellite ↔ standard)
  const currentStyleRef = useRef("mapbox://styles/mapbox/standard");

  // Cache Supabase + Wikipedia — réinjection instantanée après setStyle()
  const historicalCacheRef = useRef<HistoricalEventDB[]>([]);
  const wikiCacheRef = useRef<Map<number, HistoricalEventDB>>(new Map());
  const fragmentsRef = useRef<FragmentData[]>([]);
  // Mirror fragments prop → ref (toujours à jour pour réinjection)
  fragmentsRef.current = fragments ?? [];
  const [exploreFilters, setExploreFilters] = useState<ExploreFilters>({
    year: null,
    search: "",
    mood: null,
    historyCategory: null,
  });

  // ═════════════════════════════════════════════════════════════════
  //  VIEW MODE — gère les transitions Night / Light / Map / Satellite
  //  IMPORTANT : passer en mode Satellite nécessite setStyle() qui
  //  détruit toutes les sources et layers. Le handler style.load les
  //  recrée et réinjecte le cache Supabase automatiquement.
  // ═════════════════════════════════════════════════════════════════
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // ── Détection changement de style URL ─────────────────────────
    const needsSat = viewMode === "satellite";
    const currentIsSat = currentStyleRef.current.includes("satellite-v9");

    if (needsSat && !currentIsSat) {
      // Standard → Satellite-v9 : setStyle() obligatoire
      currentStyleRef.current = "mapbox://styles/mapbox/satellite-v9";
      map.setStyle(currentStyleRef.current);
      return; // style.load fera le reste (sources, layers, fog, data)
    }
    if (!needsSat && currentIsSat) {
      // Satellite → Standard : setStyle() obligatoire
      currentStyleRef.current = "mapbox://styles/mapbox/standard";
      map.setStyle(currentStyleRef.current);
      return; // style.load fera le reste
    }

    // ── Même base de style — on change les config / paint ─────────
    if (!map.isStyleLoaded()) return;

    const isMap = viewMode === "map";
    const isLight = viewMode === "light";
    const isSat = currentStyleRef.current.includes("satellite-v9");

    // 1. Config properties (Standard uniquement)
    if (!isSat) {
      try {
        const m = map as any;
        m.setConfigProperty("basemap", "lightPreset", isLight ? "dawn" : "night");
        m.setConfigProperty("basemap", "showPlaceLabels", isMap);
        m.setConfigProperty("basemap", "showBoundaries", isMap);
        m.setConfigProperty("basemap", "showRoadLabels", false);
        m.setConfigProperty("basemap", "showPointOfInterestLabels", false);
        m.setConfigProperty("basemap", "showTransitLabels", false);
      } catch { /* style pas prêt */ }
    }

    // 2. Contournement visuel radical (Standard uniquement)
    if (!isSat) {
      try {
        map.getStyle()?.layers?.forEach((layer) => {
          const id = layer.id;
          const isBorder =
            id.includes("admin") || id.includes("boundary") || id.includes("border");
          if (isBorder) {
            try { map.setPaintProperty(id, "line-opacity", isMap ? 1 : 0); } catch { /* */ }
            try { map.setPaintProperty(id, "line-width", isMap ? 1 : 0); } catch { /* */ }
          }
          const isOurLayer =
            id.startsWith("city-glow") || id.startsWith("historical") ||
            id.startsWith("fragments") || id.startsWith("temp-spot") ||
            id.startsWith("shock");
          if (layer.type === "symbol" && !isOurLayer) {
            const isPlaceLabel =
              id.includes("label") || id.includes("place") || id.includes("country") ||
              id.includes("state") || id.includes("settlement");
            const showSymbol = isMap && isPlaceLabel;
            try { map.setPaintProperty(id, "text-opacity", showSymbol ? 1 : 0); } catch { /* */ }
            try { map.setPaintProperty(id, "icon-opacity", showSymbol ? 1 : 0); } catch { /* */ }
          }
          if (isLight && layer.type === "sky") {
            try { map.setPaintProperty(id, "sky-atmosphere-sun-intensity", 0); } catch { /* */ }
          }
        });
      } catch { /* */ }
    }

    // 3. Fog adapté au mode
    try {
      if (isSat) {
        map.setFog({
          color: "rgba(0, 0, 0, 1)",
          "high-color": "#242b4b",
          "horizon-blend": 0.02,
          "space-color": "#000000",
          "star-intensity": 0.6,
        });
      } else if (isLight) {
        map.setFog({
          color: "rgba(180, 200, 220, 0.6)",
          "high-color": "rgb(30, 60, 120)",
          "horizon-blend": 0.03,
          "space-color": "rgb(8, 14, 30)",
          "star-intensity": 0.05,
        });
      } else {
        map.setFog({
          color: "rgba(0, 0, 0, 1)",
          "high-color": "rgb(10, 20, 40)",
          "horizon-blend": 0.02,
          "space-color": "rgb(0, 0, 0)",
          "star-intensity": 0.8,
        });
      }
    } catch { /* */ }

    // 4. City glow — visible Night/Map, éteint en Light/Satellite
    try {
      const glowOpFactor = (isLight || isSat) ? 0 : 1;
      if (map.getLayer("city-glow-outer")) {
        map.setPaintProperty("city-glow-outer", "circle-opacity", [
          "interpolate", ["linear"], ["zoom"],
          0, 0.08 * glowOpFactor, 4, 0.12 * glowOpFactor, 8, 0.06 * glowOpFactor,
        ]);
      }
      if (map.getLayer("city-glow-core")) {
        map.setPaintProperty("city-glow-core", "circle-opacity", [
          "interpolate", ["linear"], ["zoom"],
          0, 0.25 * glowOpFactor, 4, 0.4 * glowOpFactor, 8, 0.2 * glowOpFactor,
        ]);
      }
    } catch { /* */ }

    // 5. Couleurs FULL — fragments or/bleu, historiques selon dataMode
    try {
      const fragColor = isLight ? "#1A237E" : "#FFD700";
      const setC = (l: string, p: string, v: any) => {
        try { if (map.getLayer(l)) (map as any).setPaintProperty(l, p, v); } catch { /* */ }
      };
      setC("fragments-dot", "circle-color", fragColor);
      setC("fragments-glow", "circle-color", fragColor);
      // Historiques : par catégorie si mode history, sinon uniforme
      if (dataModeRef.current === "history") {
        const histExpr = isLight ? HIST_CAT_COLOR_LIGHT : HIST_CAT_COLOR_EXPR;
        setC("historical-dot", "circle-color", histExpr);
        setC("historical-glow", "circle-color", histExpr);
      } else {
        const uniformColor = isLight ? "#E53935" : "#8b5cf6";
        setC("historical-dot", "circle-color", uniformColor);
        setC("historical-glow", "circle-color", uniformColor);
      }
    } catch { /* */ }
  }, [viewMode]);

  // ═════════════════════════════════════════════════════════════════
  //  COURONNE — marker HTML tournant autour du point sélectionné
  //  Couleur adaptative : or (#FFD700) en Dark/Political/Satellite,
  //  bleu nuit (#1A237E) en Light Mode. Dépend de highlightCoords
  //  ET viewMode pour se recréer si le mode change.
  // ═════════════════════════════════════════════════════════════════
  useEffect(() => {
    const map = mapRef.current;
    // Nettoyer l'ancien marker
    if (crownMarkerRef.current) {
      crownMarkerRef.current.remove();
      crownMarkerRef.current = null;
    }
    if (!map || !highlightCoords) return;

    // Couleurs selon le mode ET le type de point
    const isLight = viewMode === "light";
    const isHistory = highlightKind === "history";

    let crownColor: string;
    let pulseGlow: string;
    if (isHistory) {
      // Historique : violet en dark, rouge en light
      crownColor = isLight ? "#E53935" : "#BB86FC";
      pulseGlow = isLight
        ? "radial-gradient(circle, rgba(229,57,53,0.35) 0%, transparent 70%)"
        : "radial-gradient(circle, rgba(187,134,252,0.35) 0%, transparent 70%)";
    } else {
      // Fragment : or en dark, bleu nuit en light
      crownColor = isLight ? "#1A237E" : "#FFD700";
      pulseGlow = isLight
        ? "radial-gradient(circle, rgba(26,35,126,0.35) 0%, transparent 70%)"
        : "radial-gradient(circle, rgba(255,215,0,0.35) 0%, transparent 70%)";
    }

    // Créer le HTML de la couronne (couleurs inline)
    const el = document.createElement("div");
    el.style.cssText = "position:relative;width:0;height:0;pointer-events:none;";
    el.innerHTML = `
      <div class="highlight-pulse" style="background:${pulseGlow}"></div>
      <div class="highlight-crown" style="border-color:${crownColor}"></div>
    `;

    const marker = new mapboxgl.Marker({ element: el, anchor: "center" })
      .setLngLat([highlightCoords.lng, highlightCoords.lat])
      .addTo(map);

    crownMarkerRef.current = marker;

    return () => {
      marker.remove();
      crownMarkerRef.current = null;
    };
  }, [highlightCoords, viewMode, highlightKind]);

  // ═════════════════════════════════════════════════════════════════
  //  FLY TO — déclenché par le parent (deep link, etc.)
  // ═════════════════════════════════════════════════════════════════
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !flyToCoords) return;
    map.flyTo({
      center: [flyToCoords.lng, flyToCoords.lat],
      zoom: flyToCoords.zoom ?? 12,
      duration: 2500,
      essential: true,
    });
  }, [flyToCoords]);

  // ═════════════════════════════════════════════════════════════════
  //  DATA MODE — bascule Tous / Fragments / History
  //  Utilise setLayoutProperty('visibility') = GPU instantané.
  //  Le temp-spot reste TOUJOURS visible (il sert à la création).
  // ═════════════════════════════════════════════════════════════════
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;

    const fragVis = dataMode === "history" ? "none" : "visible";
    const histVis = dataMode === "fragments" ? "none" : "visible";

    try {
      // Fragments — visibilité
      if (map.getLayer("fragments-dot")) map.setLayoutProperty("fragments-dot", "visibility", fragVis);
      if (map.getLayer("fragments-glow")) map.setLayoutProperty("fragments-glow", "visibility", fragVis);
      if (map.getLayer("fragments-hitbox")) map.setLayoutProperty("fragments-hitbox", "visibility", fragVis);
      // Historical — visibilité
      if (map.getLayer("historical-dot")) map.setLayoutProperty("historical-dot", "visibility", histVis);
      if (map.getLayer("historical-glow")) map.setLayoutProperty("historical-glow", "visibility", histVis);
      if (map.getLayer("historical-hitbox")) map.setLayoutProperty("historical-hitbox", "visibility", histVis);
    } catch { /* couches pas encore prêtes */ }

    // ── Couleurs historiques conditionnelles ──
    // Mode "history" → couleurs par catégorie (match expression)
    // Mode "all" ou "fragments" → couleur uniforme (violet dark / rouge light)
    try {
      const isLight = viewModeRef.current === "light";
      if (dataMode === "history") {
        // Couleurs par catégorie
        const expr = isLight ? HIST_CAT_COLOR_LIGHT : HIST_CAT_COLOR_EXPR;
        if (map.getLayer("historical-dot")) (map as any).setPaintProperty("historical-dot", "circle-color", expr);
        if (map.getLayer("historical-glow")) (map as any).setPaintProperty("historical-glow", "circle-color", expr);
      } else {
        // Couleur uniforme : violet (#8b5cf6) ou rouge (#E53935)
        const uniformColor = isLight ? "#E53935" : "#8b5cf6";
        if (map.getLayer("historical-dot")) (map as any).setPaintProperty("historical-dot", "circle-color", uniformColor);
        if (map.getLayer("historical-glow")) (map as any).setPaintProperty("historical-glow", "circle-color", uniformColor);
      }
    } catch { /* */ }
  }, [dataMode]);

  // ═════════════════════════════════════════════════════════════════
  //  QUIZ GAME MODE — isolation visuelle + marqueur mystère + flyTo
  // ═════════════════════════════════════════════════════════════════
  useEffect(() => {
    isGamingRef.current = isGaming;
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;

    // Couleur dynamique par catégorie (jamais jaune)
    const QUIZ_CAT_COLORS: Record<string, string> = {
      shock: "#FF4444", civilization: "#4FC3F7", struggle: "#FFB74D", origins: "#E0E0E0",
    };
    const qColor = QUIZ_CAT_COLORS[quizCategory] || "#BB86FC";

    if (isGaming && quizCoords) {
      // ── 1. Isolation visuelle — masquer les hitbox/tooltips historiques ──
      try {
        if (map.getLayer("historical-hitbox"))
          map.setLayoutProperty("historical-hitbox", "visibility", "none");
        if (map.getLayer("historical-dot"))
          map.setPaintProperty("historical-dot", "circle-opacity", 0.15);
        if (map.getLayer("historical-glow"))
          map.setPaintProperty("historical-glow", "circle-opacity", 0.08);
      } catch { /* layers pas prêtes */ }

      // ── 1b. Isolation totale — masquer TOUS les fragments (points jaunes) ──
      try {
        if (map.getLayer("fragments-glow"))
          map.setLayoutProperty("fragments-glow", "visibility", "none");
        if (map.getLayer("fragments-dot"))
          map.setLayoutProperty("fragments-dot", "visibility", "none");
        if (map.getLayer("fragments-labels"))
          map.setLayoutProperty("fragments-labels", "visibility", "none");
        if (map.getLayer("fragments-hitbox"))
          map.setLayoutProperty("fragments-hitbox", "visibility", "none");
      } catch { /* */ }

      // ── 2. Marqueur Mystère '?' coloré par catégorie + pulsation ─────
      try {
        const quizFC: GeoJSON.FeatureCollection = {
          type: "FeatureCollection",
          features: [{
            type: "Feature",
            properties: {},
            geometry: { type: "Point", coordinates: [quizCoords.lng, quizCoords.lat] },
          }],
        };

        // Retirer les anciennes couches pour recréer avec la bonne couleur
        const layerIds = ["quiz-target-label", "quiz-target-dot", "quiz-target-glow", "quiz-target-ping"];
        for (const lid of layerIds) {
          if (map.getLayer(lid)) map.removeLayer(lid);
        }
        if (map.getSource("quiz-target")) {
          map.removeSource("quiz-target");
        }

        map.addSource("quiz-target", { type: "geojson", data: quizFC });

        // Halo pulsant (couleur catégorie)
        map.addLayer({
          id: "quiz-target-glow",
          type: "circle",
          source: "quiz-target",
          paint: {
            "circle-radius": 30,
            "circle-color": qColor,
            "circle-opacity": 0.25,
            "circle-blur": 3,
            "circle-emissive-strength": 0.8,
          },
        } as any);

        // Point central (couleur catégorie)
        map.addLayer({
          id: "quiz-target-dot",
          type: "circle",
          source: "quiz-target",
          paint: {
            "circle-radius": 10,
            "circle-color": qColor,
            "circle-opacity": 0.9,
            "circle-emissive-strength": 1.0,
            "circle-stroke-width": 2,
            "circle-stroke-color": `${qColor}80`,
          },
        } as any);

        // Ping pulsation (cercle qui s'agrandit et disparaît)
        map.addLayer({
          id: "quiz-target-ping",
          type: "circle",
          source: "quiz-target",
          paint: {
            "circle-radius": 18,
            "circle-color": qColor,
            "circle-opacity": 0.4,
            "circle-blur": 2,
          },
        } as any);

        // Symbole '?'
        map.addLayer({
          id: "quiz-target-label",
          type: "symbol",
          source: "quiz-target",
          layout: {
            "text-field": "?",
            "text-size": 18,
            "text-font": ["DIN Pro Bold", "Arial Unicode MS Bold"],
            "text-allow-overlap": true,
          },
          paint: {
            "text-color": "#000000",
            "text-halo-color": qColor,
            "text-halo-width": 1,
            "text-emissive-strength": 1.0,
          },
        } as any);

        // Animation pulse via JS (agrandir/rétrécir le cercle ping)
        let frame = 0;
        const animatePing = () => {
          if (!map.getLayer("quiz-target-ping")) return;
          frame++;
          const t = (Math.sin(frame * 0.06) + 1) / 2; // 0→1
          const r = 18 + t * 22;
          const o = 0.4 - t * 0.35;
          try {
            map.setPaintProperty("quiz-target-ping", "circle-radius", r);
            map.setPaintProperty("quiz-target-ping", "circle-opacity", Math.max(o, 0.05));
          } catch { /* */ }
          requestAnimationFrame(animatePing);
        };
        requestAnimationFrame(animatePing);
      } catch (err) { console.warn("[Quiz] Marqueur mystère erreur:", err); }

      // ── 3. Caméra cinématique — flyTo zoom 6 ──────────────────
      map.flyTo({
        center: [quizCoords.lng, quizCoords.lat],
        zoom: 6,
        duration: 2500,
        curve: 1.42,
      });
    } else {
      // ── RÉINITIALISATION — restaurer tout ───────────────────────
      try {
        if (map.getLayer("historical-hitbox"))
          map.setLayoutProperty("historical-hitbox", "visibility", "visible");
        if (map.getLayer("historical-dot"))
          map.setPaintProperty("historical-dot", "circle-opacity", 1);
        if (map.getLayer("historical-glow"))
          map.setPaintProperty("historical-glow", "circle-opacity", 0.4);
      } catch { /* */ }

      // Restaurer les fragments
      try {
        if (map.getLayer("fragments-glow"))
          map.setLayoutProperty("fragments-glow", "visibility", "visible");
        if (map.getLayer("fragments-dot"))
          map.setLayoutProperty("fragments-dot", "visibility", "visible");
        if (map.getLayer("fragments-labels"))
          map.setLayoutProperty("fragments-labels", "visibility", "visible");
        if (map.getLayer("fragments-hitbox"))
          map.setLayoutProperty("fragments-hitbox", "visibility", "visible");
      } catch { /* */ }

      // Retirer le marqueur mystère
      try {
        const layerIds = ["quiz-target-label", "quiz-target-dot", "quiz-target-glow", "quiz-target-ping"];
        for (const lid of layerIds) {
          if (map.getLayer(lid)) map.removeLayer(lid);
        }
        if (map.getSource("quiz-target")) {
          map.removeSource("quiz-target");
        }
      } catch { /* */ }
    }
  }, [isGaming, quizCoords, quizCategory]);

  // ═════════════════════════════════════════════════════════════════
  //  MODE VISEUR — active le crosshair pour choisir un lieu
  // ═════════════════════════════════════════════════════════════════
  const enterTargetingMode = useCallback(() => {
    setIsTargeting(true);
    isTargetingRef.current = true;
    // Stopper la rotation pour que l'utilisateur vise tranquillement
    isAutoRotatingRef.current = false;
    isDriftingRef.current = false;
  }, []);

  const exitTargetingMode = useCallback(() => {
    setIsTargeting(false);
    isTargetingRef.current = false;
    setTooltipPos(null);
    // Reset du curseur — identique au nettoyage après un clic globe
    const map = mapRef.current;
    if (map) map.getCanvas().style.cursor = "";
    // La rotation reste arrêtée — contrôle total à l'utilisateur
  }, []);

  // Synchroniser le pending spot sur la carte
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    const src = map.getSource("temp-spot") as mapboxgl.GeoJSONSource;
    if (!src) return;

    if (pendingSpotCoords) {
      src.setData({
        type: "FeatureCollection",
        features: [{
          type: "Feature",
          properties: {},
          geometry: {
            type: "Point",
            coordinates: [pendingSpotCoords.lng, pendingSpotCoords.lat],
          },
        }],
      });
    } else {
      src.setData(EMPTY_FC);
    }
  }, [pendingSpotCoords]);

  // Synchroniser les fragments confirmés sur la carte + flash de naissance
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    try {
      const src = map.getSource("user-fragments") as mapboxgl.GeoJSONSource | undefined;
      if (!src) return;
      if (fragments && fragments.length > 0) {
        src.setData(fragmentsToGeoJSON(fragments));

        // ── Détection de naissance (isNew) → flash blanc ────────
        const newFrag = fragments.find((f) => f.isNew);
        if (newFrag) {
          const birthSrc = map.getSource("fragment-birth") as mapboxgl.GeoJSONSource | undefined;
          if (birthSrc) {
            birthSrc.setData({
              type: "FeatureCollection",
              features: [{
                type: "Feature",
                properties: {},
                geometry: { type: "Point", coordinates: [newFrag.lng, newFrag.lat] },
              }],
            });
            birthStartRef.current = performance.now();
          }
        }
      } else {
        src.setData(EMPTY_FC);
      }
    } catch { /* source pas prête */ }
  }, [fragments]);

  // ═════════════════════════════════════════════════════════════════
  //  EXPLORE — filtrage dynamique des couches fragments ET historiques
  //  Utilise setFilter() sur les layers pour ne montrer que les
  //  points correspondants. Source intacte → reset instantané.
  // ═════════════════════════════════════════════════════════════════
  // ── Mapping catégorie → couleur pour le mode "Full History" ──
  const FULL_HIST_COLORS: Record<string, string> = {
    shock: "#FF4444",
    civilization: "#4FC3F7",
    struggle: "#FFB74D",
    origins: "#E0E0E0",
  };

  // Helper : reset les couleurs historiques selon viewMode + dataMode
  const resetHistoricalColors = useCallback((m: mapboxgl.Map) => {
    const isLight = viewModeRef.current === "light";
    try {
      if (dataModeRef.current === "history") {
        // Mode Explore History → couleurs par catégorie
        const expr = isLight ? HIST_CAT_COLOR_LIGHT : HIST_CAT_COLOR_EXPR;
        if (m.getLayer("historical-dot")) (m as any).setPaintProperty("historical-dot", "circle-color", expr);
        if (m.getLayer("historical-glow")) (m as any).setPaintProperty("historical-glow", "circle-color", expr);
      } else {
        // Mode Tous / Fragments → couleur uniforme
        const uniformColor = isLight ? "#E53935" : "#8b5cf6";
        if (m.getLayer("historical-dot")) (m as any).setPaintProperty("historical-dot", "circle-color", uniformColor);
        if (m.getLayer("historical-glow")) (m as any).setPaintProperty("historical-glow", "circle-color", uniformColor);
      }
    } catch { /* */ }
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;

    const { year, search, mood, historyCategory } = exploreFilters;
    const hasFilter = year !== null || search.trim() !== "" || mood !== null || historyCategory !== null;

    // Helper pour appliquer un filtre aux 3 layers d'un groupe
    const applyFilter = (prefix: string, f: mapboxgl.FilterSpecification | null) => {
      try {
        if (map.getLayer(`${prefix}-dot`)) map.setFilter(`${prefix}-dot`, f);
        if (map.getLayer(`${prefix}-glow`)) map.setFilter(`${prefix}-glow`, f);
        if (map.getLayer(`${prefix}-hitbox`)) map.setFilter(`${prefix}-hitbox`, f);
      } catch { /* */ }
    };

    // ── Couleurs par catégorie — toujours via l'expression match ──
    const applyHistoryColors = () => {
      try {
        resetHistoricalColors(map); // toujours utiliser l'expression match par catégorie
      } catch { /* */ }
    };

    if (!hasFilter) {
      applyFilter("fragments", null);
      // Remettre le filtre zoom progressif par défaut (pas null)
      applyFilter("historical", ZOOM_NOTORIETY_FILTER);
      resetHistoricalColors(map);
      return;
    }

    // ── Filtre pour les historiques (zoom + year + historyCategory) ─
    // On combine TOUJOURS avec le filtre zoom pour garder la hiérarchie
    const histConditions: any[] = [ZOOM_NOTORIETY_FILTER];
    if (year !== null) {
      histConditions.push(["==", ["get", "year"], year]);
    }
    if (historyCategory) {
      histConditions.push(["==", ["get", "category"], historyCategory]);
    }

    if (histConditions.length > 1) {
      applyFilter("historical", ["all", ...histConditions] as any);
    } else {
      applyFilter("historical", ZOOM_NOTORIETY_FILTER);
    }

    // Appliquer la coloration par catégorie
    applyHistoryColors();

    // ── Filtre pour les fragments ─────────────────────────────────
    const fragConditions: mapboxgl.FilterSpecification[] = [];

    if (year !== null) {
      fragConditions.push(["==", ["get", "year"], year]);
    }
    if (mood) {
      fragConditions.push(["==", ["get", "mood"], mood]);
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      try {
        const src = map.getSource("user-fragments") as mapboxgl.GeoJSONSource | undefined;
        if (src && fragments) {
          const matchedFrags = fragments.filter((f) => {
            if (year !== null && f.year !== year) return false;
            if (mood && f.mood !== mood) return false;
            return (
              f.content.toLowerCase().includes(q) ||
              (f.title ?? "").toLowerCase().includes(q) ||
              String(f.year).includes(q)
            );
          });
          src.setData(fragmentsToGeoJSON(matchedFrags));
          applyFilter("fragments", null);
        }
      } catch { /* source pas prête */ }

      // Aussi filtrer les historiques par recherche texte côté source
      try {
        const histSrc = map.getSource("historical-events") as mapboxgl.GeoJSONSource | undefined;
        if (histSrc) {
          const supaHist = historicalCacheRef.current;
          const wikiHist = Array.from(wikiCacheRef.current.values());
          const allHist = [...supaHist, ...wikiHist];
          const matchedHist = allHist.filter((h) => {
            if (year !== null && h.year !== year) return false;
            if (historyCategory && (h.category ?? "").toLowerCase() !== historyCategory) return false;
            return (
              h.title.toLowerCase().includes(q) ||
              (h.description ?? "").toLowerCase().includes(q) ||
              (h.category ?? "").toLowerCase().includes(q) ||
              String(h.year ?? "").includes(q)
            );
          });
          histSrc.setData(historicalToGeoJSON(matchedHist));
          applyFilter("historical", ZOOM_NOTORIETY_FILTER); // source déjà filtrée, garder le zoom filter
        }
      } catch { /* */ }
      return;
    }

    // Filtre purement Mapbox (année et/ou mood, pas de search)
    const fragFilter: mapboxgl.FilterSpecification =
      fragConditions.length === 1 ? fragConditions[0] : fragConditions.length > 1 ? ["all", ...fragConditions] : (true as any);

    applyFilter("fragments", fragConditions.length > 0 ? fragFilter : null);
  }, [exploreFilters, fragments]);

  // ── FlyTo un fragment + ouvre automatiquement la StoryCard ──
  const flyToFragment = useCallback((f: FragmentData) => {
    const map = mapRef.current;
    if (!map) return;
    map.flyTo({
      center: [f.lng, f.lat],
      zoom: 12,
      duration: 2000,
      essential: true,
    });
    // Ouvrir la StoryCard pour ce fragment (déclenche aussi la couronne via highlightCoords)
    onSelectPointRef.current?.({
      kind: "fragment",
      id: f.id,
      title: f.title ?? "",
      year: f.year,
      content: f.content ?? "",
      category: f.mood ?? "",
      lat: f.lat,
      lng: f.lng,
    });
  }, []);

  // ── Smart Loading Continental — fetch 5 points sur 5 continents ──
  const handleWorldFetch = useCallback(async (): Promise<WikiEvent[]> => {
    // Coordonnées représentatives des 5 continents (zones denses en histoire)
    const CONTINENTAL_COORDS: { lat: number; lng: number; label: string }[] = [
      { lat: 48.86, lng: 2.35, label: "Europe (Paris)" },
      { lat: 30.04, lng: 31.24, label: "Afrique (Le Caire)" },
      { lat: 35.68, lng: 139.69, label: "Asie (Tokyo)" },
      { lat: 40.71, lng: -74.01, label: "Amérique (New York)" },
      { lat: -33.87, lng: 151.21, label: "Océanie (Sydney)" },
    ];

    console.log("[WorldFetch] Lancement du chargement continental…");

    const results = await Promise.all(
      CONTINENTAL_COORDS.map(async (c) => {
        try {
          const events = await fetchWikiEvents(c.lat, c.lng, 10000);
          console.log(`[WorldFetch] ${c.label}: ${events.length} événements`);
          return events;
        } catch (err) {
          console.warn(`[WorldFetch] Erreur ${c.label}:`, err);
          return [] as WikiEvent[];
        }
      })
    );

    // Fusionner et dédupliquer
    const allMap = new Map<number, WikiEvent>();
    for (const batch of results) {
      for (const e of batch) allMap.set(e.id, e);
    }

    const merged = [...allMap.values()];
    console.log(`[WorldFetch] Total mondial: ${merged.length} événements uniques`);
    return merged;
  }, []);

  // ── Fermeture de l'Explorer (reset filtres + sources) ────────
  const handleCloseExplore = useCallback(() => {
    setShowExplore(false);
    setExploreFilters({ year: null, search: "", mood: null, historyCategory: null });
    // Reset quiz si en cours
    setIsGaming(false);
    setQuizCoords(null);
    // Restaurer tous les points (plus d'isolation)
    setDataMode("all");
    const map = mapRef.current;
    if (map && map.isStyleLoaded()) {
      // Restaurer les fragments complets
      if (fragments) {
        try {
          const src = map.getSource("user-fragments") as mapboxgl.GeoJSONSource | undefined;
          if (src) src.setData(fragmentsToGeoJSON(fragments));
        } catch { /* */ }
      }
      // Restaurer les historiques complets (Supabase + Wikipedia)
      try {
        const supaHist = historicalCacheRef.current;
        const wikiHist = Array.from(wikiCacheRef.current.values());
        const merged = [...supaHist, ...wikiHist];
        const histSrc = map.getSource("historical-events") as mapboxgl.GeoJSONSource | undefined;
        if (histSrc) histSrc.setData(historicalToGeoJSON(merged));
      } catch { /* */ }
      // Reset tous les filtres (fragments → null, historical → zoom filter)
      const resetFilter = (prefix: string, defaultFilter: any = null) => {
        try {
          if (map.getLayer(`${prefix}-dot`)) map.setFilter(`${prefix}-dot`, defaultFilter);
          if (map.getLayer(`${prefix}-glow`)) map.setFilter(`${prefix}-glow`, defaultFilter);
          if (map.getLayer(`${prefix}-hitbox`)) map.setFilter(`${prefix}-hitbox`, defaultFilter);
        } catch { /* */ }
      };
      resetFilter("fragments");
      resetFilter("historical", ZOOM_NOTORIETY_FILTER);
    }
  }, [fragments]);

  // ═════════════════════════════════════════════════════════════════
  //  INITIALISATION UNIQUE ([] → jamais recréée)
  // ═════════════════════════════════════════════════════════════════
  useEffect(() => {
    if (!containerRef.current) return;
    mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || "";

    // ── Création de la carte ────────────────────────────────────
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: "mapbox://styles/mapbox/standard",
      projection: "globe",
      center: [2.35, 48.85],
      zoom: 1.8,
      pitch: 0,
      bearing: 0,
      // Force l'activation de TOUTES les interactions
      scrollZoom: true,
      dragPan: true,
      dragRotate: true,
      touchZoomRotate: true,
      doubleClickZoom: false, // ← jump
      keyboard: false, // ← saut brusque
    });

    mapRef.current = map;

    // ═════════════════════════════════════════════════════════════
    //  KILL BOUNDARIES — fonction réutilisée dans 2 événements
    //  Appelée à la fois par style.load ET style.importload pour
    //  être SÛR que rien ne passe.
    // ═════════════════════════════════════════════════════════════
    function killBoundariesAndLabels() {
      const m = map as any;

      // 1. Config officielles du style Standard — tout éteint
      try {
        m.setConfigProperty("basemap", "lightPreset", "night");
        m.setConfigProperty("basemap", "showPlaceLabels", false);
        m.setConfigProperty("basemap", "showRoadLabels", false);
        m.setConfigProperty("basemap", "showPointOfInterestLabels", false);
        m.setConfigProperty("basemap", "showTransitLabels", false);
        m.setConfigProperty("basemap", "showBoundaries", false);
      } catch {
        /* config pas encore dispo */
      }

      // 2. CONTOURNEMENT VISUEL RADICAL — éteint TOUS les symboles,
      //    POIs, labels et frontières du basemap natif Mapbox.
      //    Zéro statue, zéro musée, zéro bar, zéro restaurant.
      try {
        map.getStyle()?.layers?.forEach((layer) => {
          const id = layer.id;

          // ── Frontières ──────────────────────────────────────
          const isBorder =
            id.includes("admin") ||
            id.includes("boundary") ||
            id.includes("border");

          if (isBorder) {
            try { map.setPaintProperty(id, "line-opacity", 0); } catch { /* */ }
            try { map.setPaintProperty(id, "line-width", 0); } catch { /* */ }
          }

          // ── TOUS les symboles natifs (labels + POI + icônes) ─
          //    On ne se limite plus à certains mots-clés : on éteint
          //    TOUT symbol layer qui n'est pas l'un de nos layers custom.
          const isOurLayer =
            id.startsWith("city-glow") ||
            id.startsWith("historical") ||
            id.startsWith("fragments") ||
            id.startsWith("temp-spot") ||
            id.startsWith("shock");

          if (layer.type === "symbol" && !isOurLayer) {
            try { map.setPaintProperty(id, "text-opacity", 0); } catch { /* */ }
            try { map.setPaintProperty(id, "icon-opacity", 0); } catch { /* */ }
          }
        });
      } catch {
        /* ignore */
      }
    }

    // ═════════════════════════════════════════════════════════════
    //  CHARGEMENT SUPABASE — appelé depuis style.load quand le
    //  cache est vide. Fetch → injecte → cache pour les prochains
    //  style.load (changements de mode).
    // ═════════════════════════════════════════════════════════════
    let supabaseFetching = false;
    function injectSupabaseData() {
      if (supabaseFetching) return; // éviter les fetches concurrents
      supabaseFetching = true;
      (async () => {
        try {
          const histEvents = await fetchHistoricalFromDB();
          historicalCacheRef.current = histEvents;
          // Fusionner Supabase + Wikipedia cache
          const wikiData = Array.from(wikiCacheRef.current.values());
          const merged = [...histEvents, ...wikiData];
          const histSrc = map.getSource("historical-events") as mapboxgl.GeoJSONSource | undefined;
          if (histSrc) {
            histSrc.setData(historicalToGeoJSON(merged));
            setHistoricalCount(merged.length);
            console.log(`[Supabase] ${histEvents.length} historical + ${wikiData.length} wiki = ${merged.length} total`);
          }
        } catch (err) { console.warn("[Supabase:historical]", err); }

        try {
          const dbFragments = await fetchFragmentsFromDB();
          console.log("[Supabase] Fragments reçus:", dbFragments.length);
          // Mettre en cache
          fragmentsRef.current = dbFragments;
          const fragSrc = map.getSource("user-fragments") as mapboxgl.GeoJSONSource | undefined;
          if (fragSrc) {
            fragSrc.setData(fragmentsToGeoJSON(dbFragments));
            console.log("[Supabase] GeoJSON injecté:", dbFragments.length, "features");
          }
          if (dbFragments.length > 0) {
            onLoadFragmentsRef.current?.(dbFragments);
          }
        } catch (err) { console.error("[Supabase:fragments] ERREUR:", err); }

        // Force la visibilité — dataMode
        try {
          const dm = dataModeRef.current;
          const fragVis = dm === "history" ? "none" : "visible";
          const histVis = dm === "fragments" ? "none" : "visible";
          const vis = (id: string, v: string) => {
            if (map.getLayer(id)) (map as any).setLayoutProperty(id, "visibility", v);
          };
          vis("fragments-dot", fragVis);
          vis("fragments-glow", fragVis);
          vis("fragments-hitbox", fragVis);
          vis("historical-dot", histVis);
          vis("historical-glow", histVis);
          vis("historical-hitbox", histVis);
        } catch { /* */ }

        supabaseFetching = false;
      })();
    }

    // ═════════════════════════════════════════════════════════════
    //  COULEURS ADAPTATIVES — FULL OR ou FULL BLEU NUIT
    //  Dark/Political/Satellite : dot + glow = #FFD700 (or pur)
    //  Light : dot + glow = #1A237E (bleu nuit profond)
    // ═════════════════════════════════════════════════════════════
    function applyModeColors(m: mapboxgl.Map, mode: string) {
      const isLight = mode === "light";
      const fragColor = isLight ? "#1A237E" : "#FFD700";

      const setC = (layer: string, prop: string, val: any) => {
        try { if (m.getLayer(layer)) (m as any).setPaintProperty(layer, prop, val); } catch { /* */ }
      };
      // Fragments — or / bleu nuit
      setC("fragments-dot", "circle-color", fragColor);
      setC("fragments-glow", "circle-color", fragColor);
      // Historical — par catégorie si mode "history", sinon uniforme
      if (dataModeRef.current === "history") {
        const histExpr = isLight ? HIST_CAT_COLOR_LIGHT : HIST_CAT_COLOR_EXPR;
        setC("historical-dot", "circle-color", histExpr);
        setC("historical-glow", "circle-color", histExpr);
      } else {
        const uniformColor = isLight ? "#E53935" : "#8b5cf6";
        setC("historical-dot", "circle-color", uniformColor);
        setC("historical-glow", "circle-color", uniformColor);
      }
      // Temp spot — toujours or
      setC("temp-spot-core", "circle-color", "#FFD700");
      setC("temp-spot-glow", "circle-color", "#FFD700");
      // Shockwave — toujours or
      setC("shock-outer-ring", "line-color", "#FFD700");
      setC("shock-inner-ring", "line-color", "#FFD700");
      setC("shock-outer-fill", "fill-color", "#FFD700");
      setC("shock-inner-fill", "fill-color", "#FFD700");
    }

    // ═════════════════════════════════════════════════════════════
    //  style.importload — spécifique au style Standard (imports)
    //  Se déclenche QUAND les imports du basemap sont chargés,
    //  AVANT que les couches ne soient rendues.
    // ═════════════════════════════════════════════════════════════
    (map as any).on("style.importload", () => {
      // Standard uniquement — satellite-v9 n'a pas de basemap config
      if (!currentStyleRef.current.includes("satellite-v9")) {
        killBoundariesAndLabels();
      }
    });

    // ═════════════════════════════════════════════════════════════
    //  style.load — PERSISTANT : se déclenche à CHAQUE changement
    //  de style (initial + setStyle()). Recrée TOUTES les sources,
    //  layers et réinjecte les données Supabase depuis le cache.
    // ═════════════════════════════════════════════════════════════
    map.on("style.load", () => {
      const isSat = currentStyleRef.current.includes("satellite-v9");
      const vm = viewModeRef.current;
      console.log(`[MapGlobe:style.load] Style chargé — mode: ${vm}, satellite: ${isSat}`);

      // ─── 1. Kill boundaries (Standard uniquement) ─────────────
      if (!isSat) {
        killBoundariesAndLabels();
      }

      // ─── 2. Fog adapté au mode actuel ──────────────────────────
      try {
        if (vm === "satellite") {
          map.setFog({
            color: "rgba(0, 0, 0, 1)",
            "high-color": "#242b4b",
            "horizon-blend": 0.02,
            "space-color": "#000000",
            "star-intensity": 0.6,
          });
        } else if (vm === "light") {
          map.setFog({
            color: "rgba(180, 200, 220, 0.6)",
            "high-color": "rgb(30, 60, 120)",
            "horizon-blend": 0.03,
            "space-color": "rgb(8, 14, 30)",
            "star-intensity": 0.05,
          });
        } else {
          // night / map — deep space cinematic
          map.setFog({
            color: "rgba(0, 0, 0, 1)",
            "high-color": "rgb(10, 20, 40)",
            "horizon-blend": 0.02,
            "space-color": "rgb(0, 0, 0)",
            "star-intensity": 0.8,
          });
        }
      } catch { /* */ }

      // ─── 3. Config properties du basemap (Standard uniquement) ──
      if (!isSat) {
        try {
          const m = map as any;
          m.setConfigProperty("basemap", "lightPreset", vm === "light" ? "dawn" : "night");
          m.setConfigProperty("basemap", "showPlaceLabels", vm === "map");
          m.setConfigProperty("basemap", "showBoundaries", vm === "map");
          m.setConfigProperty("basemap", "showRoadLabels", false);
          m.setConfigProperty("basemap", "showPointOfInterestLabels", false);
          m.setConfigProperty("basemap", "showTransitLabels", false);
        } catch { /* */ }

        // Contournement visuel radical — borders/symbols
        try {
          map.getStyle()?.layers?.forEach((layer) => {
            const id = layer.id;
            const isBorder = id.includes("admin") || id.includes("boundary") || id.includes("border");
            if (isBorder) {
              try { map.setPaintProperty(id, "line-opacity", vm === "map" ? 1 : 0); } catch { /* */ }
              try { map.setPaintProperty(id, "line-width", vm === "map" ? 1 : 0); } catch { /* */ }
            }
            const isOurLayer =
              id.startsWith("city-glow") || id.startsWith("historical") ||
              id.startsWith("fragments") || id.startsWith("temp-spot") || id.startsWith("shock");
            if (layer.type === "symbol" && !isOurLayer) {
              const isPlaceLabel =
                id.includes("label") || id.includes("place") || id.includes("country") ||
                id.includes("state") || id.includes("settlement");
              const show = vm === "map" && isPlaceLabel;
              try { map.setPaintProperty(id, "text-opacity", show ? 1 : 0); } catch { /* */ }
              try { map.setPaintProperty(id, "icon-opacity", show ? 1 : 0); } catch { /* */ }
            }
            if (vm === "light" && layer.type === "sky") {
              try { map.setPaintProperty(id, "sky-atmosphere-sun-intensity", 0); } catch { /* */ }
            }
          });
        } catch { /* */ }
      }

      // ─── 4. City Lights Golden Glow (Standard uniquement) ───────
      if (!isSat) {
        try {
          map.addSource("streets-v8", { type: "vector", url: "mapbox://mapbox.mapbox-streets-v8" });
          map.addLayer({
            id: "city-glow-outer", type: "circle", source: "streets-v8", "source-layer": "place_label",
            filter: ["in", ["get", "class"], ["literal", ["city", "town", "village", "hamlet"]]],
            paint: {
              "circle-radius": ["interpolate", ["linear"], ["zoom"], 0, 2, 3, 5, 6, 10, 10, 18],
              "circle-color": "#FFD700",
              "circle-opacity": ["interpolate", ["linear"], ["zoom"], 0, 0.08, 4, 0.12, 8, 0.06],
              "circle-blur": 1.8,
            },
          });
          map.addLayer({
            id: "city-glow-core", type: "circle", source: "streets-v8", "source-layer": "place_label",
            filter: ["in", ["get", "class"], ["literal", ["city", "town"]]],
            paint: {
              "circle-radius": ["interpolate", ["linear"], ["zoom"], 0, 0.8, 3, 1.5, 6, 3, 10, 5],
              "circle-color": "#FFEEBB",
              "circle-opacity": ["interpolate", ["linear"], ["zoom"], 0, 0.25, 4, 0.4, 8, 0.2],
              "circle-blur": 0.5,
            },
          });
          // City glow OFF en Light View
          if (vm === "light") {
            map.setPaintProperty("city-glow-outer", "circle-opacity", 0);
            map.setPaintProperty("city-glow-core", "circle-opacity", 0);
          }
        } catch (err) { console.warn("[MapGlobe] City glow skip:", err); }
      }

      // ─── 5. Onde de Choc 3D — sources ──────────────────────────
      map.addSource("shock-inner", { type: "geojson", data: EMPTY_POLY });
      map.addSource("shock-outer", { type: "geojson", data: EMPTY_POLY });

      // ─── 6. Points historiques — Violet vibrant #BB86FC ────────────
      //
      //  FILTRE ZOOM PROGRESSIF :
      //    zoom < 5  → notorietyScore ≥ 50  OU  isIncontournable
      //    zoom 5-8  → notorietyScore ≥ 15  OU  isIncontournable
      //    zoom ≥ 8  → tout visible
      //
      //  Mapbox expression : on utilise "any" + "step" sur ["zoom"]
      //  Le seuil de notoriété diminue quand le zoom augmente.
      //
      map.addSource("historical-events", { type: "geojson", data: EMPTY_FC });
      map.addLayer({
        id: "historical-glow", type: "circle", source: "historical-events", minzoom: 0,
        filter: ZOOM_NOTORIETY_FILTER,
        layout: { visibility: "visible" },
        paint: {
          "circle-radius": [
            "interpolate", ["linear"], ["coalesce", ["get", "notorietyScore"], 0],
            0, 14,
            50, 20,
            200, 26,
            1000, 32,
          ],
          "circle-color": "#8b5cf6", "circle-emissive-strength": 0.8,
          "circle-opacity": 0.4, "circle-blur": 4.0,
          "circle-sort-key": ["coalesce", ["get", "notorietyScore"], 0],
        },
      } as any);
      map.addLayer({
        id: "historical-dot", type: "circle", source: "historical-events", minzoom: 0,
        filter: ZOOM_NOTORIETY_FILTER,
        layout: { visibility: "visible" },
        paint: {
          "circle-radius": [
            "interpolate", ["linear"], ["coalesce", ["get", "notorietyScore"], 0],
            0, 3,
            50, 5,
            200, 7,
            1000, 8,
          ],
          "circle-color": "#8b5cf6", "circle-emissive-strength": 1.0,
          "circle-opacity": 1, "circle-stroke-width": 0,
          "circle-sort-key": ["coalesce", ["get", "notorietyScore"], 0],
        },
      } as any);
      // Hitbox invisible — zone de survol étendue (24px)
      map.addLayer({
        id: "historical-hitbox", type: "circle", source: "historical-events", minzoom: 0,
        filter: ZOOM_NOTORIETY_FILTER,
        layout: { visibility: "visible" },
        paint: { "circle-radius": 24, "circle-color": "#000000", "circle-opacity": 0 },
      } as any);

      // ─── 7. Spots permanents (fragments confirmés) — FULL OR ─────
      map.addSource("user-fragments", { type: "geojson", data: EMPTY_FC });
      map.addLayer({
        id: "fragments-glow", type: "circle", source: "user-fragments", minzoom: 0,
        layout: { visibility: "visible" },
        paint: {
          "circle-radius": 22, "circle-color": "#FFD700", "circle-emissive-strength": 0.8,
          "circle-opacity": 0.4, "circle-blur": 4.0,
        },
      } as any);
      map.addLayer({
        id: "fragments-dot", type: "circle", source: "user-fragments", minzoom: 0,
        layout: { visibility: "visible" },
        paint: {
          "circle-radius": 5, "circle-color": "#FFD700", "circle-emissive-strength": 1.0,
          "circle-opacity": 1, "circle-stroke-width": 0,
        },
      } as any);
      // Hitbox invisible — zone de survol étendue (24px)
      map.addLayer({
        id: "fragments-hitbox", type: "circle", source: "user-fragments", minzoom: 0,
        layout: { visibility: "visible" },
        paint: { "circle-radius": 24, "circle-color": "#000000", "circle-opacity": 0 },
      } as any);

      // ─── 8. Spot temporaire (doré scintillant) ─────────────────
      map.addSource("temp-spot", { type: "geojson", data: EMPTY_FC });
      map.addLayer({
        id: "temp-spot-glow", type: "circle", source: "temp-spot",
        paint: {
          "circle-radius": 22, "circle-color": "#FFD700", "circle-emissive-strength": 1.0,
          "circle-opacity": 0.4, "circle-blur": 4.0,
        },
      } as any);
      map.addLayer({
        id: "temp-spot-core", type: "circle", source: "temp-spot",
        paint: {
          "circle-radius": 5, "circle-color": "#FFD700", "circle-emissive-strength": 1.0,
          "circle-opacity": 1, "circle-stroke-width": 0,
        },
      } as any);

      // ─── 8b. Source « naissance » ──────────────────────────────
      map.addSource("fragment-birth", { type: "geojson", data: EMPTY_FC });
      map.addLayer({
        id: "fragment-birth-glow", type: "circle", source: "fragment-birth",
        paint: { "circle-radius": 0, "circle-color": "#FFD700", "circle-emissive-strength": 1.0, "circle-opacity": 0, "circle-blur": 4.0 },
      } as any);
      map.addLayer({
        id: "fragment-birth-core", type: "circle", source: "fragment-birth",
        paint: { "circle-radius": 0, "circle-color": "#FFD700", "circle-emissive-strength": 1.0, "circle-opacity": 0, "circle-stroke-width": 0 },
      } as any);

      // ─── 9. Onde de Choc Sonar — émissif, 8px, or pur ──────────
      map.addLayer({
        id: "shock-outer-fill", type: "fill", source: "shock-outer",
        paint: { "fill-color": "#FFD700", "fill-emissive-strength": 1.0, "fill-opacity": 0 },
      } as any);
      map.addLayer({
        id: "shock-outer-ring", type: "line", source: "shock-outer",
        paint: { "line-color": "#FFD700", "line-emissive-strength": 1.0, "line-width": 8, "line-blur": 14, "line-opacity": 0 },
      } as any);
      map.addLayer({
        id: "shock-inner-fill", type: "fill", source: "shock-inner",
        paint: { "fill-color": "#FFD700", "fill-emissive-strength": 1.0, "fill-opacity": 0 },
      } as any);
      map.addLayer({
        id: "shock-inner-ring", type: "line", source: "shock-inner",
        paint: { "line-color": "#FFD700", "line-emissive-strength": 1.0, "line-width": 8, "line-blur": 5, "line-opacity": 0 },
      } as any);

      // ─── 10. Réinjection IMMÉDIATE des données ─────────────────
      //  Cache d'abord (instantané). Si cache vide → fetch Supabase.
      //  C'est LE fix critique : style.load peut se déclencher
      //  plusieurs fois (imports Standard). Chaque fois, les sources
      //  sont vidées. On DOIT repeupler à chaque fois.
      const cachedFrags = fragmentsRef.current;
      const cachedHist = historicalCacheRef.current;
      try {
        if (cachedFrags.length > 0) {
          const fragSrc = map.getSource("user-fragments") as mapboxgl.GeoJSONSource | undefined;
          if (fragSrc) {
            fragSrc.setData(fragmentsToGeoJSON(cachedFrags));
            console.log(`[style.load] ${cachedFrags.length} fragments réinjectés (cache)`);
          }
        }
        // Fusionner Supabase cache + Wikipedia cache
        const wikiData = Array.from(wikiCacheRef.current.values());
        const mergedHist = [...cachedHist, ...wikiData];
        if (mergedHist.length > 0) {
          const histSrc = map.getSource("historical-events") as mapboxgl.GeoJSONSource | undefined;
          if (histSrc) {
            histSrc.setData(historicalToGeoJSON(mergedHist));
            console.log(`[style.load] ${cachedHist.length} supabase + ${wikiData.length} wiki réinjectés`);
          }
        }
      } catch { /* */ }

      // Si le cache est vide (premier chargement), fetch Supabase
      if (cachedFrags.length === 0 || cachedHist.length === 0) {
        console.log("[style.load] Cache vide → fetch Supabase…");
        injectSupabaseData();
      }

      // ─── 11. Réappliquer la visibilité dataMode ────────────────
      try {
        const dm = dataModeRef.current;
        const fragVis = dm === "history" ? "none" : "visible";
        const histVis = dm === "fragments" ? "none" : "visible";
        if (map.getLayer("fragments-dot")) map.setLayoutProperty("fragments-dot", "visibility", fragVis);
        if (map.getLayer("fragments-glow")) map.setLayoutProperty("fragments-glow", "visibility", fragVis);
        if (map.getLayer("fragments-hitbox")) map.setLayoutProperty("fragments-hitbox", "visibility", fragVis);
        if (map.getLayer("historical-dot")) map.setLayoutProperty("historical-dot", "visibility", histVis);
        if (map.getLayer("historical-glow")) map.setLayoutProperty("historical-glow", "visibility", histVis);
        if (map.getLayer("historical-hitbox")) map.setLayoutProperty("historical-hitbox", "visibility", histVis);
      } catch { /* */ }

      // ─── 11b. Remonter tous les custom layers au sommet ─────────
      try {
        const layerOrder = [
          "historical-glow", "historical-dot", "historical-hitbox",
          "fragments-glow", "fragments-dot", "fragments-hitbox",
          "temp-spot-glow", "temp-spot-core",
          "fragment-birth-glow", "fragment-birth-core",
        ];
        for (const id of layerOrder) {
          if (map.getLayer(id)) map.moveLayer(id);
        }
      } catch { /* */ }

      // ─── 12. Réappliquer le temp-spot si présent ───────────────
      if (pendingSpotCoordsRef.current) {
        try {
          const ts = map.getSource("temp-spot") as mapboxgl.GeoJSONSource | undefined;
          if (ts) {
            ts.setData({
              type: "FeatureCollection",
              features: [{
                type: "Feature",
                properties: {},
                geometry: { type: "Point", coordinates: [pendingSpotCoordsRef.current.lng, pendingSpotCoordsRef.current.lat] },
              }],
            });
          }
        } catch { /* */ }
      }

      // ─── 13. Appliquer les couleurs adaptatives au mode ────────
      applyModeColors(map, vm);

      console.log("[MapGlobe:style.load] Sources et layers recréés. Satellite:", isSat);
    }); // fin style.load

    // ═════════════════════════════════════════════════════════════
    //  WIKIPEDIA LIVE — Fetch sur moveend
    //  Récupère les articles Wikipedia proches du centre de la vue.
    //  Fusionne avec le cache Supabase (dédupliqué par ID négatif).
    //  Debounce de 1.5s pour ne pas spammer l'API.
    // ═════════════════════════════════════════════════════════════
    let wikiTimeout: ReturnType<typeof setTimeout> | null = null;
    let wikiFetching = false;

    function mergeAndInjectHistorical(m: mapboxgl.Map) {
      const supabaseData = historicalCacheRef.current;
      const wikiData = Array.from(wikiCacheRef.current.values());
      const merged = [...supabaseData, ...wikiData];
      const histSrc = m.getSource("historical-events") as mapboxgl.GeoJSONSource | undefined;
      if (!histSrc) {
        console.warn("[mergeHistorical] source 'historical-events' introuvable");
        return;
      }

      const geoJSON = historicalToGeoJSON(merged);
      histSrc.setData(geoJSON);
      setHistoricalCount(merged.length);
      console.log(`[mergeHistorical] ${supabaseData.length} supabase + ${wikiData.length} wiki = ${merged.length} features injectées`);

      // ── 1. Forcer la visibilité selon le dataMode courant ────────
      const dm = dataModeRef.current;
      const histVis = dm === "fragments" ? "none" : "visible";
      try {
        if (m.getLayer("historical-dot")) (m as any).setLayoutProperty("historical-dot", "visibility", histVis);
        if (m.getLayer("historical-glow")) (m as any).setLayoutProperty("historical-glow", "visibility", histVis);
        if (m.getLayer("historical-hitbox")) (m as any).setLayoutProperty("historical-hitbox", "visibility", histVis);
      } catch { /* */ }

      // ── 2. Forcer les couleurs adaptatives ───────────────────────
      applyModeColors(m, viewModeRef.current);

      // ── 3. Forcer l'opacité à 1 (anti-invisibilité) ─────────────
      try {
        if (m.getLayer("historical-dot")) (m as any).setPaintProperty("historical-dot", "circle-opacity", 1);
        if (m.getLayer("historical-glow")) (m as any).setPaintProperty("historical-glow", "circle-opacity", 0.5);
      } catch { /* */ }

      // ── 4. Remonter les layers au sommet de la pile (Z-Index) ────
      try {
        if (m.getLayer("historical-glow")) m.moveLayer("historical-glow");
        if (m.getLayer("historical-dot")) m.moveLayer("historical-dot");
        if (m.getLayer("historical-hitbox")) m.moveLayer("historical-hitbox");
      } catch { /* */ }

      // ── 5. Réappliquer le filtre zoom progressif (pas null !) ────
      try {
        if (m.getLayer("historical-dot")) m.setFilter("historical-dot", ZOOM_NOTORIETY_FILTER);
        if (m.getLayer("historical-glow")) m.setFilter("historical-glow", ZOOM_NOTORIETY_FILTER);
        if (m.getLayer("historical-hitbox")) m.setFilter("historical-hitbox", ZOOM_NOTORIETY_FILTER);
      } catch { /* */ }

      // ── 6. Log de diagnostic ─────────────────────────────────────
      try {
        const layers = m.getStyle().layers;
        const customLayers = layers?.filter((l: any) =>
          l.id.includes("historical") || l.id.includes("fragments") || l.id.includes("temp-spot")
        ).map((l: any) => `${l.id} [vis:${l.layout?.visibility ?? "?"}]`);
        console.log("[mergeHistorical] Custom layers (ordre):", customLayers);
      } catch { /* */ }
    }

    map.on("moveend", () => {
      if (wikiTimeout) clearTimeout(wikiTimeout);
      wikiTimeout = setTimeout(async () => {
        if (wikiFetching) return;
        wikiFetching = true;
        try {
          const center = map.getCenter();
          const zoom = map.getZoom();
          // Rayon adaptatif : plus on est zoomé, plus le rayon est petit
          const radius = Math.min(10000, Math.max(500, Math.round(10000 / Math.pow(2, Math.max(0, zoom - 3)))));
          const wikiEvents = await fetchWikiEvents(center.lat, center.lng, radius);
          if (wikiEvents.length > 0) {
            // Convertir en HistoricalEventDB (ID négatif pour éviter collision Supabase)
            for (const w of wikiEvents) {
              const negId = -Math.abs(w.id); // ID négatif = Wikipedia
              if (!wikiCacheRef.current.has(negId)) {
                wikiCacheRef.current.set(negId, {
                  id: negId,
                  title: w.title,
                  category: w.category,
                  lat: w.lat,
                  lng: w.lng,
                  year: w.year,
                  description: w.description,
                  notorietyScore: w.notorietyScore,
                  isIncontournable: w.isIncontournable,
                });
              }
            }
            mergeAndInjectHistorical(map);
            // Mettre à jour le pool d'events pour le quiz
            setWikiEventsForQuiz((prev) => {
              const ids = new Set(prev.map((e) => e.id));
              const news = wikiEvents.filter((e) => !ids.has(e.id));
              return news.length > 0 ? [...prev, ...news] : prev;
            });
            console.log(`[Wikipedia] +${wikiEvents.length} articles (cache total: ${wikiCacheRef.current.size})`);
          }
        } catch (err) {
          console.warn("[Wikipedia] moveend error:", err);
        } finally {
          wikiFetching = false;
        }
      }, 1500); // debounce 1.5s
    });

    // ═════════════════════════════════════════════════════════════
    //  CLIC SUR LE GLOBE
    //  - En mode viseur → placer le spot temporaire
    //  - Sinon → onde de choc 3D
    // ═════════════════════════════════════════════════════════════
    map.on("click", (e: mapboxgl.MapMouseEvent) => {
      // ── MODE VISEUR : capturer les coordonnées ────────────────
      if (isTargetingRef.current) {
        const coords = { lng: e.lngLat.lng, lat: e.lngLat.lat };
        // Sortir du mode viseur (ref + state React)
        isTargetingRef.current = false;
        setIsTargeting(false);
        setTooltipPos(null);
        map.getCanvas().style.cursor = "grab";
        // Notifier le parent (qui mettra pendingSpotCoords + ouvrira la modal)
        onRequestFragmentRef.current?.(coords);
        return;
      }

      // ── ONDE DE CHOC 3D — zoom-aware ───────────────────────────
      const innerSrc = map.getSource("shock-inner") as mapboxgl.GeoJSONSource;
      const outerSrc = map.getSource("shock-outer") as mapboxgl.GeoJSONSource;
      if (!innerSrc || !outerSrc) return;

      cancelAnimationFrame(shockRafRef.current);

      const center: [number, number] = [e.lngLat.lng, e.lngLat.lat];
      const t0 = performance.now();

      // Facteur d'échelle selon le zoom :
      // zoom 1 → facteur 1.0 (planétaire), zoom 18 → facteur ~0.02 (local)
      const zoom = map.getZoom();
      const zoomScale = Math.max(0.02, Math.pow(2, -(zoom - 1) * 0.6));

      function animate(now: number) {
        const elapsed = now - t0;
        const p = Math.min(elapsed / SHOCKWAVE_DURATION, 1);
        const ease = 1 - Math.pow(1 - p, 3);

        const outerR = Math.max(SHOCKWAVE_MAX_OUTER * zoomScale * ease, 0.5);
        const innerR = Math.max(SHOCKWAVE_MAX_INNER * zoomScale * ease, 0.5);

        // Opacités — saturées à 1.0 au départ, fade progressif, clampées
        const ringOp  = safeOp(1.0 * (1 - p) * (1 - p));     // 1.0 → 0 quadratique
        const coreOp  = safeOp(1.0 * (1 - p * 1.8));          // 1.0 → 0 à p≈0.55
        const fillOp  = safeOp(0.15 * (1 - p));
        const coreFill = safeOp(coreOp * 0.35);

        outerSrc.setData(buildGeoCircle(center, outerR));
        innerSrc.setData(buildGeoCircle(center, innerR));

        // Anneau doré extérieur — 8px, glow min 5px
        if (map.getLayer("shock-outer-ring")) {
          map.setPaintProperty("shock-outer-ring", "line-opacity", ringOp);
          map.setPaintProperty("shock-outer-ring", "line-blur", Math.max(5, 14 + p * 8));
          map.setPaintProperty("shock-outer-ring", "line-width", 8 + (1 - p) * 4);
        }
        if (map.getLayer("shock-outer-fill")) {
          map.setPaintProperty("shock-outer-fill", "fill-opacity", fillOp);
        }

        // Cœur doré intérieur — glow min 5px
        if (map.getLayer("shock-inner-fill")) {
          map.setPaintProperty("shock-inner-fill", "fill-opacity", coreFill);
        }
        if (map.getLayer("shock-inner-ring")) {
          map.setPaintProperty("shock-inner-ring", "line-opacity", coreOp);
          map.setPaintProperty("shock-inner-ring", "line-width", 8 + (1 - p) * 4);
          map.setPaintProperty("shock-inner-ring", "line-blur", Math.max(5, 10 + p * 6));
        }

        if (p < 1) {
          shockRafRef.current = requestAnimationFrame(animate);
        } else {
          innerSrc.setData(EMPTY_POLY);
          outerSrc.setData(EMPTY_POLY);
        }
      }

      shockRafRef.current = requestAnimationFrame(animate);
    });

    // ═════════════════════════════════════════════════════════════
    //  NOTA : injectSupabaseData est maintenant appelé DEPUIS
    //  le handler style.load (step 10) quand le cache est vide.
    //  Plus de once("idle") → injection GARANTIE à chaque load.
    // ═════════════════════════════════════════════════════════════

    // ═════════════════════════════════════════════════════════════
    //  HOVER — mini tooltip natif (léger) + curseur pointer
    // ═════════════════════════════════════════════════════════════
    const hoverPopup = new mapboxgl.Popup({
      closeButton: false,
      closeOnClick: false,
      className: "hover-popup",
      offset: [0, -14],
      anchor: "bottom",
    });

    // ── Mapping mood → emoji ────────────────────────────────────
    const MOOD_EMOJI: Record<string, string> = {
      "Joie": "✨", "Mélancolie": "💧", "Passion": "🔥",
      "Sérénité": "🌿", "Mystère": "🌌", "Énergie": "⚡",
    };
    // Mapping category historique → emoji + couleur badge
    const CAT_EMOJI: Record<string, string> = {
      "shock": "💀", "civilization": "🏛️", "struggle": "✊", "origins": "🌍",
      "battle": "⚔️", "monument": "🏛️", "event": "📜",
      "culture": "🎭", "science": "🔬", "politics": "🏴",
    };
    const CAT_COLOR: Record<string, string> = {
      "shock": "#FF4444",        // rouge vif
      "civilization": "#4FC3F7", // bleu clair
      "struggle": "#FFB74D",    // orange
      "origins": "#E0E0E0",     // blanc/gris clair
    };
    const CAT_LABEL: Record<string, string> = {
      "shock": "Choc", "civilization": "Civilisation",
      "struggle": "Luttes", "origins": "Origines",
    };
    const tooltipFont = "font-family:'Montserrat','Inter',system-ui,sans-serif";

    // ── Hover historique (via hitbox — zone 24px) ───────────────
    map.on("mouseenter", "historical-hitbox", (e) => {
      if (isGamingRef.current) return; // Anti-triche : pas de tooltip en mode quiz
      map.getCanvas().style.cursor = "pointer";
      const f = e.features?.[0];
      if (!f?.properties) return;
      const coords = (f.geometry as GeoJSON.Point).coordinates.slice() as [number, number];
      const cat = String(f.properties.category ?? "").toLowerCase();
      const emoji = CAT_EMOJI[cat] || "📍";
      const title = f.properties.title ?? "";
      const yearStr = f.properties.year ? String(f.properties.year) : "";
      const histAccent = viewModeRef.current === "light" ? "#E53935" : "#BB86FC";
      const badgeColor = CAT_COLOR[cat] || histAccent;
      const badgeLabel = CAT_LABEL[cat] || "";
      const badgeHtml = badgeLabel
        ? `<span style="display:inline-block;padding:1px 7px;border-radius:99px;font-size:9px;font-weight:600;letter-spacing:0.05em;color:${badgeColor};background:${badgeColor}1A;border:1px solid ${badgeColor}40;margin-left:6px;vertical-align:middle;text-transform:uppercase">${badgeLabel}</span>`
        : "";
      hoverPopup.setLngLat(coords).setHTML(
        `<div style="${tooltipFont};line-height:1.5">` +
        `<div style="font-size:14px;color:${histAccent};font-weight:600">${emoji} ${title}${badgeHtml}</div>` +
        (yearStr ? `<div style="font-size:11px;color:rgba(255,255,255,0.5);margin-top:4px">${yearStr}</div>` : "") +
        `</div>`
      ).addTo(map);
    });
    map.on("mouseleave", "historical-hitbox", () => {
      if (!isTargetingRef.current) map.getCanvas().style.cursor = "";
      hoverPopup.remove();
    });

    // ── Hover fragments (via hitbox — zone 24px) ─────────────
    map.on("mouseenter", "fragments-hitbox", (e) => {
      if (isTargetingRef.current) return;
      map.getCanvas().style.cursor = "pointer";
      const f = e.features?.[0];
      if (!f?.properties) return;
      const coords = (f.geometry as GeoJSON.Point).coordinates.slice() as [number, number];
      const mood = String(f.properties.mood ?? "");
      const emoji = MOOD_EMOJI[mood] || "💫";
      const rawTitle = f.properties.title ? String(f.properties.title).trim() : "";
      const titleStr = rawTitle || (f.properties.content ? String(f.properties.content).slice(0, 50) : "Sans titre");
      const yearStr = f.properties.year ? String(f.properties.year) : "";
      hoverPopup.setLngLat(coords).setHTML(
        `<div style="${tooltipFont};line-height:1.5">` +
        `<div style="font-size:14px;color:#FFD700;font-weight:600">${emoji} ${titleStr}</div>` +
        (yearStr ? `<div style="font-size:11px;color:rgba(255,255,255,0.5);margin-top:4px">${yearStr}</div>` : "") +
        `</div>`
      ).addTo(map);
    });
    map.on("mouseleave", "fragments-hitbox", () => {
      if (!isTargetingRef.current) map.getCanvas().style.cursor = "";
      hoverPopup.remove();
    });

    // ═════════════════════════════════════════════════════════════
    //  CLIC — ouvre la StoryCard via onSelectPoint
    // ═════════════════════════════════════════════════════════════
    map.on("click", "historical-hitbox", (e) => {
      if (isTargetingRef.current || isGamingRef.current) return; // Anti-triche
      e.originalEvent.stopPropagation();
      const f = e.features?.[0];
      if (!f?.properties) return;
      const coords = (f.geometry as GeoJSON.Point).coordinates.slice() as [number, number];
      onSelectPointRef.current?.({
        kind: "history",
        id: String(f.properties.id ?? ""),
        title: f.properties.title ?? "Unknown",
        year: f.properties.year ? Number(f.properties.year) : null,
        content: f.properties.description ?? "",
        category: f.properties.category ?? "",
        lat: coords[1],
        lng: coords[0],
      });
    });

    map.on("click", "fragments-hitbox", (e) => {
      if (isTargetingRef.current) return;
      e.originalEvent.stopPropagation();
      const f = e.features?.[0];
      if (!f?.properties) return;
      const coords = (f.geometry as GeoJSON.Point).coordinates.slice() as [number, number];
      onSelectPointRef.current?.({
        kind: "fragment",
        id: String(f.properties.id ?? ""),
        title: f.properties.title ?? "",
        year: f.properties.year ? Number(f.properties.year) : null,
        content: f.properties.content ?? "",
        category: f.properties.mood ?? "",
        lat: coords[1],
        lng: coords[0],
      });
    });

    // ── Tooltip du mode viseur (suit la souris) ─────────────────
    map.on("mousemove", (e) => {
      if (isTargetingRef.current) {
        map.getCanvas().style.cursor = "crosshair";
        setTooltipPos({ x: e.point.x, y: e.point.y });
      }
    });

    // ═════════════════════════════════════════════════════════════
    //  VELOCITY TRACKING — enregistre le delta lng/lat par frame
    //  pendant l'interaction utilisateur.
    // ═════════════════════════════════════════════════════════════
    map.on("move", () => {
      if (!isUserTouchingRef.current) return;
      const c = map.getCenter();
      const last = lastCenterRef.current;
      if (last) {
        velocityRef.current = {
          lng: c.lng - last.lng,
          lat: c.lat - last.lat,
        };
      }
      lastCenterRef.current = { lng: c.lng, lat: c.lat };
    });

    // ═════════════════════════════════════════════════════════════
    //  INTERACTIONS — arrêt net + dérive orbitale
    // ═════════════════════════════════════════════════════════════
    const onInteractionStart = () => {
      isUserTouchingRef.current = true;
      isDriftingRef.current = false;
      velocityRef.current = { lng: 0, lat: 0 };
      lastCenterRef.current = null;

      // ── Arrêt DÉFINITIF de la rotation automatique ──────────
      // Une fois que l'utilisateur touche le globe, la rotation
      // ne revient jamais. Le globe est sous son contrôle total.
      isAutoRotatingRef.current = false;

      if (!hasInteractedRef.current) {
        hasInteractedRef.current = true;
        onFirstInteraction?.();
      }
    };

    const onInteractionEnd = () => {
      isUserTouchingRef.current = false;
      const v = velocityRef.current;

      // Si la vélocité est suffisante → lancer la dérive orbitale (inertie)
      if (Math.abs(v.lng) > DRIFT_THRESHOLD * 3 || Math.abs(v.lat) > DRIFT_THRESHOLD * 3) {
        isDriftingRef.current = true;
      } else {
        isDriftingRef.current = false;
        // Pas de reprise auto — le globe reste immobile
      }
    };

    map.on("mousedown", onInteractionStart);
    map.on("touchstart", onInteractionStart);
    map.on("mouseup", onInteractionEnd);
    map.on("touchend", onInteractionEnd);
    // dragend/zoomend → dérive orbitale si vélocité suffisante
    map.on("dragend", () => {
      if (!isDriftingRef.current && !isUserTouchingRef.current) {
        const v = velocityRef.current;
        if (Math.abs(v.lng) > DRIFT_THRESHOLD * 3 || Math.abs(v.lat) > DRIFT_THRESHOLD * 3) {
          isDriftingRef.current = true;
        }
        // Pas de resume timer → le globe reste sous contrôle utilisateur
      }
    });
    map.on("zoomend", () => {
      // Rien à faire — pas de reprise automatique
    });

    // ═════════════════════════════════════════════════════════════
    //  BOUCLE PRINCIPALE — rotation + dérive orbitale
    //  UN SEUL requestAnimationFrame pour tout, 100% indépendant
    //  des re-renders React.
    //
    //  RÈGLE CRUCIALE : on ne fait JAMAIS setCenter() si la carte
    //  est en train de bouger (zoom, scroll, drag, easing…).
    //  → m.isMoving() || m.isZooming() = on ne touche à rien.
    // ═════════════════════════════════════════════════════════════
    function spin() {
      const m = mapRef.current;
      if (!m) {
        rafRef.current = requestAnimationFrame(spin);
        return;
      }

      // ── GARDE ABSOLUE ─────────────────────────────────────────
      // On ne touche JAMAIS au centre si la carte est occupée
      // (zoom, scroll, drag, inertie, rotation manuelle…)
      const isMoving = m.isMoving() || m.isZooming() || m.isRotating();

      if (!isMoving && !isUserTouchingRef.current) {
        if (isDriftingRef.current) {
          // ── DÉRIVE ORBITALE ────────────────────────────────────
          velocityRef.current.lng *= DRIFT_FRICTION;
          velocityRef.current.lat *= DRIFT_FRICTION;

          const v = velocityRef.current;
          const c = m.getCenter();
          const newLat = Math.max(-75, Math.min(75, c.lat + v.lat));
          m.setCenter([c.lng + v.lng, newLat]);

          if (
            Math.abs(v.lng) < DRIFT_THRESHOLD &&
            Math.abs(v.lat) < DRIFT_THRESHOLD
          ) {
            isDriftingRef.current = false;
            // Dérive terminée — le globe s'immobilise,
            // pas de reprise de rotation automatique.
          }
        } else if (isAutoRotatingRef.current && !isDriftingRef.current) {
          // ── ROTATION AUTOMATIQUE ──────────────────────────────
          rotAngleRef.current -= ROTATION_SPEED;
          m.setCenter([rotAngleRef.current, 20]);
        }
      }

      // ── SCINTILLEMENT PERMANENT ────────────────────────────
      // Tourne en continu même quand isAutoRotating = false.
      // requestAnimationFrame(spin) est TOUJOURS appelé en fin
      // de boucle, donc ce bloc vit indépendamment de la rotation.
      const now = performance.now();

      // Spot temporaire — oscillation rapide (~0.8s)
      if (m.getLayer("temp-spot-core") && m.getSource("temp-spot")) {
        const tP = now / 800;
        const pulse = 0.5 + 0.5 * Math.sin(tP * Math.PI * 2);
        try {
          m.setPaintProperty("temp-spot-core", "circle-opacity", safeOp(0.5 + pulse * 0.5));
          m.setPaintProperty("temp-spot-glow", "circle-opacity", safeOp(0.15 + pulse * 0.25));
        } catch { /* */ }
      }

      // ── QUIZ MARQUEUR MYSTÈRE — pulsation lente dorée ─────────
      if (isGamingRef.current && m.getLayer("quiz-target-glow")) {
        const qP = now / 1200;
        const qPulse = 0.5 + 0.5 * Math.sin(qP * Math.PI * 2);
        try {
          m.setPaintProperty("quiz-target-glow", "circle-radius", 22 + qPulse * 18);
          m.setPaintProperty("quiz-target-glow", "circle-opacity", safeOp(0.15 + qPulse * 0.2));
          m.setPaintProperty("quiz-target-dot", "circle-radius", 8 + qPulse * 4);
        } catch { /* */ }
      }

      // ── ANIMATION DE NAISSANCE — 800ms organique ──────────────
      // Phase 1 (0–35%) : expansion 0 → 1.5× (explosion douce)
      // Phase 2 (35–100%) : contraction élastique 1.5× → 1×
      // Halo poétique : onde qui s'étend puis disparaît lentement
      if (birthStartRef.current > 0 && m.getLayer("fragment-birth-core")) {
        const elapsed = now - birthStartRef.current;
        const BIRTH_MS = 800;
        const t = Math.min(1, elapsed / BIRTH_MS);

        if (t < 1) {
          const BASE_R = 5; // rayon final du point
          let scale: number;
          if (t < 0.35) {
            // Expansion avec ease-out (décélération)
            const p = t / 0.35;
            scale = p * (2 - p) * 1.5; // ease-out quadratic → 0 → 1.5
          } else {
            // Contraction élastique vers 1.0
            const p = (t - 0.35) / 0.65;
            const overshoot = Math.sin(p * Math.PI) * 0.15; // léger rebond
            scale = 1.5 - (0.5 * p) + overshoot; // 1.5 → ~1.0
          }
          const radius = BASE_R * Math.max(0.01, scale);

          // Opacité du cœur : montée rapide, stable
          const coreOp = t < 0.15 ? t / 0.15 : 1;

          // Halo "onde poétique" : s'étend de 0 à 50px, disparaît lentement
          const haloRadius = t * 50;
          const haloOp = t < 0.2 ? t / 0.2 * 0.7 : 0.7 * Math.max(0, 1 - ((t - 0.2) / 0.8));

          try {
            m.setPaintProperty("fragment-birth-core", "circle-radius", radius);
            m.setPaintProperty("fragment-birth-core", "circle-opacity", safeOp(coreOp));
            m.setPaintProperty("fragment-birth-glow", "circle-radius", haloRadius);
            m.setPaintProperty("fragment-birth-glow", "circle-opacity", safeOp(haloOp));
          } catch { /* */ }
        } else {
          // Animation terminée — nettoyage
          birthStartRef.current = 0;
          try {
            const bSrc = m.getSource("fragment-birth") as mapboxgl.GeoJSONSource | undefined;
            if (bSrc) bSrc.setData(EMPTY_FC);
            m.setPaintProperty("fragment-birth-core", "circle-opacity", 0);
            m.setPaintProperty("fragment-birth-glow", "circle-opacity", 0);
          } catch { /* */ }
        }
      }

      // ── SCINTILLEMENT = RADIUS DU HALO (15 → 30) ──────────
      // Opacité fixe. On anime UNIQUEMENT le radius du glow.
      // Effet "ville qui respire au loin" dans la nuit.

      // Fragments — respiration rapide (~2s), radius 15 → 30
      if (m.getLayer("fragments-glow") && m.getSource("user-fragments")) {
        const breathF = Math.sin(now / 1000 * Math.PI * 2); // -1 → 1
        const glowR = 22.5 + breathF * 7.5; // 15 → 30
        try {
          m.setPaintProperty("fragments-glow", "circle-radius", glowR);
        } catch { /* */ }
      }

      // Historiques — respiration lente (~5s), radius 15 → 30
      if (m.getLayer("historical-glow") && m.getSource("historical-events")) {
        const breathH = Math.sin(now / 2500 * Math.PI * 2);
        const glowRH = 22.5 + breathH * 7.5; // 15 → 30
        try {
          m.setPaintProperty("historical-glow", "circle-radius", glowRH);
        } catch { /* */ }
      }

      rafRef.current = requestAnimationFrame(spin);
    }

    map.on("load", () => {
      rotAngleRef.current = map.getCenter().lng;
      spin();
    });

    // ═════════════════════════════════════════════════════════════
    //  CLEANUP
    // ═════════════════════════════════════════════════════════════
    return () => {
      cancelAnimationFrame(rafRef.current);
      cancelAnimationFrame(shockRafRef.current);
      hoverPopup.remove();
      map.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ═════════════════════════════════════════════════════════════════
  //  RENDU
  // ═════════════════════════════════════════════════════════════════
  return (
    <div className="relative w-full h-full bg-black">
      {/* Canvas Mapbox GL */}
      <div
        ref={containerRef}
        className={`w-full h-full ${isTargeting ? "cursor-crosshair" : "cursor-grab active:cursor-grabbing"}`}
      />

      {/* ── UI contrôle — caché pendant la landing ──────────────── */}
      {showTabBar && <>

      {/* ── Tooltip mode viseur ──────────────────────────────────── */}
      {isTargeting && tooltipPos && (
        <div
          className="absolute z-[110] pointer-events-none px-3 py-1.5 rounded-lg bg-black/70 backdrop-blur-md border border-white/10 text-white/80 text-[11px] tracking-wide whitespace-nowrap"
          style={{
            left: tooltipPos.x + 16,
            top: tooltipPos.y - 12,
          }}
        >
          Cliquez sur la Terre pour choisir un lieu
        </div>
      )}

      {/* ── Bannière mode viseur — 16px sous la Tab Bar, centré ──── */}
      {isTargeting && (
        <div
          className="fixed left-1/2 -translate-x-1/2 z-[110] flex items-center gap-3 px-5 py-2.5 bg-amber-500/10 backdrop-blur-2xl rounded-2xl border border-amber-400/20"
          style={{ top: "96px" }}
        >
          <span className="text-amber-300 text-xs font-semibold uppercase tracking-wider">
            Mode viseur actif
          </span>
          <button
            onClick={exitTargetingMode}
            className="text-white/50 hover:text-white/90 text-xs transition-colors"
          >
            Annuler
          </button>
        </div>
      )}

      {/* ── Barre de contrôle — Style Gotham ──────────────────── */}
      <nav
        className="z-[100] flex items-center gap-2 px-4 py-3 rounded-3xl border border-white/[0.08] select-none tabbar-enter"
        style={{
          position: "fixed",
          top: "24px",
          left: "24px",
          fontFamily: "'Montserrat', 'Inter', system-ui, sans-serif",
          background: "rgba(0, 0, 0, 0.70)",
          backdropFilter: "blur(24px) saturate(1.5)",
          WebkitBackdropFilter: "blur(24px) saturate(1.5)",
        }}
      >
        {/* ── Bouton principal : Leave a fragment ─────────────── */}
        <button
          onClick={enterTargetingMode}
          className={`flex items-center gap-2.5 rounded-2xl transition-all duration-200 active:scale-[0.97] ${
            isTargeting
              ? "bg-amber-400 text-black"
              : "bg-white text-black hover:bg-gray-100"
          }`}
          style={{
            padding: "12px 24px",
            fontSize: "13px",
            fontWeight: 600,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
          }}
        >
          <span className="text-base leading-none">{isTargeting ? "\u271A" : "+"}</span>
          {isTargeting ? "Choisir un lieu…" : "Leave a fragment"}
        </button>

        {/* Séparateur */}
        <div className="w-px bg-white/10 mx-1" style={{ height: "28px" }} />

        {/* ── Bouton Explore ──────────────────────────────────── */}
        <button
          onClick={() => { setShowExplore((v) => !v); setShowViewMenu(false); }}
          className={`rounded-2xl transition-all duration-200 ${
            showExplore
              ? "text-amber-400 bg-amber-400/10"
              : "text-white/70 hover:text-white hover:bg-white/[0.06]"
          }`}
          style={{
            padding: "12px 20px",
            fontSize: "13px",
            fontWeight: 500,
            letterSpacing: "0.05em",
            textTransform: "uppercase",
          }}
        >
          Explore
        </button>

        {/* Séparateur */}
        <div className="w-px bg-white/10 mx-1" style={{ height: "28px" }} />

        {/* ── Segmented Control : Tous / Fragments / Histoire ──── */}
        <div className="flex items-center gap-1" style={{ padding: "4px 6px" }}>
          {(["all", "fragments", "history"] as DataMode[]).map((mode) => {
            const active = dataMode === mode;
            const label = mode === "all" ? "Tous" : mode === "fragments" ? "Fragments" : "Histoire";
            return (
              <button
                key={mode}
                onClick={() => { setDataMode(mode); setShowViewMenu(false); }}
                className="relative transition-all duration-200"
                style={{
                  padding: "8px 14px",
                  fontSize: "12px",
                  fontWeight: active ? 600 : 400,
                  letterSpacing: "0.05em",
                  textTransform: "uppercase",
                  color: active ? "#fff" : "rgba(255,255,255,0.4)",
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                }}
              >
                {label}
                {/* Barre de soulignement animée */}
                <span
                  className="absolute bottom-0 left-1/2 -translate-x-1/2 rounded-full transition-all duration-300"
                  style={{
                    width: active ? "60%" : "0%",
                    height: "2px",
                    background: mode === "history"
                      ? (viewMode === "light" ? "#E53935" : "#BB86FC")
                      : "#FFD700",
                    opacity: active ? 1 : 0,
                  }}
                />
              </button>
            );
          })}
        </div>

        {/* Séparateur */}
        <div className="w-px bg-white/10 mx-1" style={{ height: "28px" }} />

        {/* ── Dropdown Map View ────────────────────────────────── */}
        <div className="relative">
          <button
            onClick={() => setShowViewMenu((v) => !v)}
            className="flex items-center gap-2 rounded-2xl transition-all duration-200 text-white/70 hover:text-white hover:bg-white/[0.06]"
            style={{
              padding: "12px 20px",
              fontSize: "13px",
              fontWeight: 500,
              letterSpacing: "0.05em",
              textTransform: "uppercase",
            }}
          >
            Map View
            {/* Chevron */}
            <svg
              width="10" height="6" viewBox="0 0 10 6" fill="none"
              className={`transition-transform duration-200 ${showViewMenu ? "rotate-180" : ""}`}
            >
              <path d="M1 1L5 5L9 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>

          {/* ── Menu flottant ──────────────────────────────────── */}
          {showViewMenu && (
            <div
              className="absolute top-full mt-3 left-0 min-w-[200px] rounded-2xl overflow-hidden"
              style={{
                fontFamily: "'Montserrat', 'Inter', system-ui, sans-serif",
                background: "rgba(0, 0, 0, 0.80)",
                backdropFilter: "blur(20px) saturate(1.4)",
                WebkitBackdropFilter: "blur(20px) saturate(1.4)",
                border: "1px solid rgba(255, 215, 0, 0.2)",
                boxShadow: "0 16px 48px rgba(0,0,0,0.6), 0 0 24px rgba(255,215,0,0.04)",
              }}
            >
              {(
                [
                  { key: "night" as const, label: "Dark Mode", desc: "Lumières urbaines", icon: "🌙" },
                  { key: "light" as const, label: "Light Mode", desc: "Vue naturelle", icon: "☀️" },
                  { key: "map" as const, label: "Political Mode", desc: "Frontières & noms", icon: "🗺" },
                  { key: "satellite" as const, label: "Satellite Mode", desc: "Deep Space", icon: "🛰" },
                ]
              ).map(({ key, label, desc, icon }, i) => {
                const active = viewMode === key;
                return (
                  <button
                    key={key}
                    onClick={() => { setViewMode(key); setShowViewMenu(false); }}
                    className="w-full text-left transition-all duration-150 flex items-center gap-3 group"
                    style={{
                      padding: "12px 16px",
                      borderTop: i > 0 ? "1px solid rgba(255,255,255,0.06)" : "none",
                      background: active ? "rgba(255, 215, 0, 0.08)" : "transparent",
                    }}
                  >
                    <span style={{ fontSize: "16px", lineHeight: 1 }}>{icon}</span>
                    <div className="flex flex-col">
                      <span
                        style={{
                          fontSize: "13px",
                          fontWeight: active ? 600 : 400,
                          letterSpacing: "0.03em",
                          color: active ? "#FFD700" : "rgba(255,255,255,0.8)",
                        }}
                      >
                        {label}
                      </span>
                      <span
                        style={{
                          fontSize: "10px",
                          fontWeight: 400,
                          letterSpacing: "0.02em",
                          color: "rgba(255,255,255,0.35)",
                          marginTop: "1px",
                        }}
                      >
                        {desc}
                      </span>
                    </div>
                    {active && (
                      <span className="ml-auto" style={{ color: "#FFD700", fontSize: "12px" }}>✓</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </nav>

      {/* Fond transparent pour fermer le dropdown au clic extérieur */}
      {showViewMenu && (
        <div
          className="fixed inset-0 z-[99]"
          onClick={() => setShowViewMenu(false)}
        />
      )}

      </>}
      {/* ── fin showTabBar ── */}

      {/* ── Panneau Explore ───────────────────────────────────── */}
      {showExplore && (
        <ExplorePanel
          fragments={fragments ?? []}
          historicalCount={historicalCount}
          wikiEvents={wikiEventsForQuiz}
          onClose={handleCloseExplore}
          onFlyTo={(f) => {
            flyToFragment(f);
          }}
          onFilter={setExploreFilters}
          onTabChange={(tab) => {
            // Isolation : fragments ↔ history
            setDataMode(tab === "quiz" ? "history" : "fragments");
          }}
          onQuizStart={(coords) => {
            setIsGaming(true);
            setQuizCoords(coords);
            setDataMode("history"); // force isolation pendant le quiz
          }}
          onQuizEnd={() => {
            setIsGaming(false);
            setQuizCoords(null);
          }}
          onViewHistory={(event) => {
            // Lever l'isolation
            setIsGaming(false);
            setQuizCoords(null);
            // FlyTo vers l'événement
            const map = mapRef.current;
            if (map) {
              map.flyTo({ center: [event.lng, event.lat], zoom: 12, duration: 1800 });
            }
            // Ouvrir la StoryCard
            onSelectPointRef.current?.({
              kind: "history",
              id: String(event.id),
              title: event.title,
              year: event.year,
              content: event.description,
              category: event.category,
              lat: event.lat,
              lng: event.lng,
            });
          }}
          onRequestWorldFetch={handleWorldFetch}
          onLaunchGame={(data) => {
            // Fermer l'ExplorePanel, activer le mode jeu, ouvrir le GamePanel
            setShowExplore(false);
            setGamePanelData(data);
            setQuizCategory(data.event.category);
            setIsGaming(true);
            setQuizCoords({ lng: data.event.lng, lat: data.event.lat });
            setDataMode("history"); // isolation : masquer fragments
          }}
        />
      )}

      {/* ── GamePanel — Quiz draggable ──────────────────────────── */}
      {gamePanelData && (
        <GamePanel
          initialQuestion={gamePanelData.question}
          initialEvent={gamePanelData.event}
          wikiEvents={wikiEventsForQuiz}
          difficulty={gamePanelData.difficulty}
          onClose={() => {
            setGamePanelData(null);
            setIsGaming(false);
            setQuizCoords(null);
            setQuizCategory("");
          }}
          onQuizStart={(coords, category) => {
            setIsGaming(true);
            setQuizCoords(coords);
            if (category) setQuizCategory(category);
          }}
          onQuizEnd={() => {
            // Ne pas stopper isGaming ici — le GamePanel reste ouvert entre les questions
          }}
          onViewHistory={(event) => {
            setGamePanelData(null);
            setIsGaming(false);
            setQuizCoords(null);
            setQuizCategory("");
            const map = mapRef.current;
            if (map) {
              map.flyTo({ center: [event.lng, event.lat], zoom: 12, duration: 1800 });
            }
            onSelectPointRef.current?.({
              kind: "history",
              id: String(event.id),
              title: event.title,
              year: event.year,
              content: event.description,
              category: event.category,
              lat: event.lat,
              lng: event.lng,
            });
          }}
        />
      )}
    </div>
  );
}
