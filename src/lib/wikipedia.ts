// ═══════════════════════════════════════════════════════════════════
//  WIKIPEDIA GEOSEARCH v5 — « Sorcellerie technique »
//  Shadow Fetching 150 → top 30 · Titre Royal ·  Grotte-Killer
//  API française · Grille 5 points (50km) · Notoriété (langlinks)
//  Classification 4 piliers · Dates -3000 → 2025 · Anti-église
//  Boost Mémoriel · Blacklist sportive · Recherche "Incontournables"
// ═══════════════════════════════════════════════════════════════════

const WIKI_API = "https://fr.wikipedia.org/w/api.php";
const MAX_RESULTS = 30;
const SHADOW_LIMIT = 150; // on fetche beaucoup plus, on ne garde que le top

// ─────────────────────────────────────────────────────────────────
//  CLASSIFICATION — 4 piliers
// ─────────────────────────────────────────────────────────────────

export type WikiCategory = "shock" | "civilization" | "struggle" | "origins";

const SHOCK_KW = [
  "massacre", "exécution", "pogrom", "rafle", "génocide", "attentat",
  "assassinat", "torture", "déportation", "persécution", "esclavage",
  "bombardement", "extermination", "fusillade", "noyade",
];

const SHOCK_VERBS = [
  "assassin", "exécut", "massacr", "fusill", "pendu", "noyé",
  "brûlé", "tortur", "déport", "extermin",
];

// ── Boost Mémoriel — force shock × 10 ───────────────────────────
const MEMORIAL_KW = [
  "camp de concentration", "camp d'extermination", "camp de la mort",
  "déportation", "extermination", "goulag", "charnier",
  "chambre à gaz", "shoah", "holocauste", "solution finale",
];

const CIVILIZATION_KW = [
  "empire", "traité", "dynastie", "fondation", "couronnement",
  "proclamation", "constitution", "cathédrale", "palais", "forteresse",
  "antiquité", "romain", "pharaon", "civilisation", "royaume",
  "signature", "alliance", "armistice", "capitulation",
];

const STRUGGLE_KW = [
  "grève", "manifestation", "résistance", "insurrection", "révolte",
  "révolution", "barricade", "soulèvement", "droits civiques",
  "émancipation", "libération", "indépendance", "répression",
  "censure", "ségrégation", "occulté", "bavure", "colonisation",
];

const ORIGINS_KW = [
  "archéologie", "préhistoire", "néolithique", "paléolithique",
  "migration", "mégalithe", "grotte", "fossile", "sépulture",
  "dolmen", "menhir", "cité antique", "ruines", "vestige",
  "âge du bronze", "âge du fer",
];

const IMPACT_KW = [
  "victimes", "morts", "tués", "blessés", "disparus", "fusillés",
  "pendus", "noyés", "brûlés", "détenus", "prisonniers",
];

const ALL_VERBS = [
  "assassin", "proclam", "envahi", "sign", "découvr", "soulev",
  "conqui", "détru", "incendi", "bombard", "libér", "occup",
  "exécut", "massacr", "fusill", "déport", "resist", "revolt",
  "fond", "constru", "érig", "bâti",
];

const GEO_PENALTIES = [
  "commune de", "code postal", "montagne", "sommet", "fleuve",
  "altitude", "km²", "rivière", "affluent", "bassin versant",
  "département", "arrondissement", "canton de", "intercommunalité",
];

const CHURCH_WORDS = ["église", "paroisse", "édifice", "chapelle"];

// ── Blacklist sportive ──────────────────────────────────────────
const SPORT_BLACKLIST = [
  "football", "stade", "match", "olympique", "club sportif",
  "championnat", "ligue", "coupe du monde", "rugby", "tennis",
  "natation", "athlétisme", "gymnase",
];

// Mots "sauveurs" : un stade peut être un lieu de mémoire
const SPORT_EXCEPTIONS = [
  "exécution", "prisonnier", "détenu", "massacre", "internement",
  "déportation", "camp", "fusillade", "mémorial",
];

// ── Recherche par mot-clé — Incontournables des grandes villes ──
const KEYWORD_SEARCHES = [
  "massacre", "pogrom", "révolte", "insurrection",
  "bombardement", "libération", "traité", "camp de concentration",
];

// ─────────────────────────────────────────────────────────────────
//  TYPES
// ─────────────────────────────────────────────────────────────────

export interface WikiEvent {
  id: number;
  title: string;
  description: string;
  lat: number;
  lng: number;
  year: number | null;
  category: WikiCategory;
  score: number;
  notorietyScore: number;
  /** true si trouvé par srsearch (mot-clé) — affiché quel que soit le zoom */
  isIncontournable: boolean;
}

interface GeoSearchResult {
  pageid: number;
  title: string;
  lat: number;
  lon: number;
  dist: number;
}

interface PageExtract {
  pageid: number;
  title: string;
  extract?: string;
}

// ─────────────────────────────────────────────────────────────────
//  CACHE global
// ─────────────────────────────────────────────────────────────────

const articleCache = new Map<number, WikiEvent | null>();
const gridCache = new Set<string>();

function gridKey(lat: number, lon: number): string {
  return `${lat.toFixed(2)}|${lon.toFixed(2)}`;
}

// ─────────────────────────────────────────────────────────────────
//  DATES — -3000 → 2025 + siècles romains
// ─────────────────────────────────────────────────────────────────

const ROMAN_TO_NUM: Record<string, number> = {
  "I": 1, "II": 2, "III": 3, "IV": 4, "V": 5,
  "VI": 6, "VII": 7, "VIII": 8, "IX": 9, "X": 10,
  "XI": 11, "XII": 12, "XIII": 13, "XIV": 14, "XV": 15,
  "XVI": 16, "XVII": 17, "XVIII": 18, "XIX": 19, "XX": 20, "XXI": 21,
};

function extractYear(text: string): number | null {
  const bcMatch = text.match(/(\d{1,4})\s*av(?:ant)?\.?\s*J\.?-?C\.?/i);
  if (bcMatch) return -parseInt(bcMatch[1], 10);

  const numMatches = text.match(/\b(\d{3,4})\b/g);
  if (numMatches) {
    const years = numMatches.map(Number).filter((y) => y >= 100 && y <= 2025);
    if (years.length > 0) return Math.min(...years);
  }

  const centuryYear = extractCenturyYear(text);
  if (centuryYear !== null) return centuryYear;

  return null;
}

function extractCenturyYear(text: string): number | null {
  const bcRomanMatch = text.match(/\b(X{0,3}(?:IX|IV|V?I{0,3}))e\s*siècle\s*av/i);
  if (bcRomanMatch) {
    const n = ROMAN_TO_NUM[bcRomanMatch[1].toUpperCase()];
    if (n) return -(n * 100 - 50);
  }

  const romanMatch = text.match(/\b(X{0,3}(?:IX|IV|V?I{0,3}))e\s*siècle/i);
  if (romanMatch) {
    const n = ROMAN_TO_NUM[romanMatch[1].toUpperCase()];
    if (n) return n * 100 - 50;
  }

  const numMatch = text.match(/\b(\d{1,2})(?:e|ème)\s*siècle/i);
  if (numMatch) {
    const n = parseInt(numMatch[1], 10);
    if (n >= 1 && n <= 21) return n * 100 - 50;
  }

  return null;
}

function formatCenturyLabel(text: string): string | null {
  const bcRomanMatch = text.match(/\b(X{0,3}(?:IX|IV|V?I{0,3}))e\s*siècle\s*av/i);
  if (bcRomanMatch) return `${bcRomanMatch[1]}e av. J.-C.`;

  const romanMatch = text.match(/\b(X{0,3}(?:IX|IV|V?I{0,3}))e\s*siècle/i);
  if (romanMatch) return `${romanMatch[1]}e`;

  const numMatch = text.match(/\b(\d{1,2})(?:e|ème)\s*siècle/i);
  if (numMatch) {
    const n = parseInt(numMatch[1], 10);
    const roman = Object.entries(ROMAN_TO_NUM).find(([, v]) => v === n);
    return roman ? `${roman[0]}e` : `${n}e`;
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────
//  SCORING & CLASSIFICATION
// ─────────────────────────────────────────────────────────────────

function hasVerb(text: string): boolean {
  const tl = text.toLowerCase();
  return ALL_VERBS.some((v) => tl.includes(v));
}

function countOccurrences(text: string, words: string[]): number {
  const tl = text.toLowerCase();
  let count = 0;
  for (const w of words) {
    let idx = 0;
    while ((idx = tl.indexOf(w, idx)) !== -1) { count++; idx += w.length; }
  }
  return count;
}

function classify(full: string): { cat: WikiCategory; catScore: number } {
  const shockHits = SHOCK_KW.filter((k) => full.includes(k)).length;
  const shockVerbHits = SHOCK_VERBS.filter((v) => full.includes(v)).length;
  const civHits = CIVILIZATION_KW.filter((k) => full.includes(k)).length;
  const struggleHits = STRUGGLE_KW.filter((k) => full.includes(k)).length;
  const originsHits = ORIGINS_KW.filter((k) => full.includes(k)).length;

  // Shock & Struggle dominent, Origins très bas pour ne pas polluer
  const scores: { cat: WikiCategory; s: number }[] = [
    { cat: "shock", s: (shockHits * 25) + (shockVerbHits * 20) },
    { cat: "civilization", s: civHits * 12 },
    { cat: "struggle", s: struggleHits * 20 },
    { cat: "origins", s: originsHits * 5 },  // ← baissé de 15 à 5
  ];

  scores.sort((a, b) => b.s - a.s);
  if (scores[0].s === 0) return { cat: "civilization", catScore: 0 };
  return { cat: scores[0].cat, catScore: scores[0].s };
}

interface ScoreResult {
  score: number;
  rejected: boolean;
  reason: string;
  cat: WikiCategory;
}

function computeScore(title: string, extract: string, langs: number): ScoreResult {
  const full = `${title} ${extract}`.toLowerCase();

  // ── Boost Mémoriel — détection prioritaire ────────────────────
  const isMemorial = MEMORIAL_KW.some((k) => full.includes(k));
  if (isMemorial) {
    const impactHits = IMPACT_KW.filter((k) => full.includes(k)).length;
    const base = 100 + (impactHits * 15);
    return {
      score: base * 10,
      rejected: false,
      reason: `BOOST MÉMORIEL ×10 (impact: ${impactHits * 15})`,
      cat: "shock",
    };
  }

  // ── Anti-église : >3 occurrences sans verbe d'action ni conflit ──
  const churchCount = countOccurrences(full, CHURCH_WORDS);
  const hasAction = hasVerb(full);
  const hasConflict = [...SHOCK_KW, ...STRUGGLE_KW].some((k) => full.includes(k));
  if (churchCount > 3 && !hasAction && !hasConflict) {
    return { score: 0, rejected: true, reason: `Anti-église: ${churchCount} occ., zéro action`, cat: "civilization" };
  }

  // ── Blacklist sportive ────────────────────────────────────────
  const isSport = SPORT_BLACKLIST.some((k) => full.includes(k));
  const hasSportException = SPORT_EXCEPTIONS.some((k) => full.includes(k));
  if (isSport && !hasSportException) {
    if (langs < 20) {
      return { score: -100, rejected: true, reason: `Sport (${langs} langues < 20, pas d'exception mémorielle)`, cat: "civilization" };
    }
    // Sport mais très notable (>20 langues) — on garde avec malus
  }

  // ── Classification ────────────────────────────────────────────
  const { cat, catScore } = classify(full);
  const hasAnyKeyword = catScore > 0;

  // ── Malus géographie — rejet si zéro contenu historique ───────
  for (const kw of GEO_PENALTIES) {
    if (full.includes(kw) && !hasAnyKeyword) {
      return { score: -15, rejected: true, reason: `Malus Géo: "${kw}"`, cat };
    }
  }

  let score = 10 + catScore;

  // ── Titre Royal — le titre pèse TRÈS lourd ─────────────────
  const titleLower = title.toLowerCase();
  const titleHasShock = SHOCK_KW.some((k) => titleLower.includes(k));
  const titleHasCiv = CIVILIZATION_KW.some((k) => titleLower.includes(k));
  const titleHasStruggle = STRUGGLE_KW.some((k) => titleLower.includes(k));
  if (titleHasShock || titleHasCiv || titleHasStruggle) {
    score += 500;
  }

  // Sport notable mais pas mémoriel → malus
  if (isSport && !hasSportException) score -= 50;

  // Malus géo atténué si mot-clé historique
  for (const kw of GEO_PENALTIES) {
    if (full.includes(kw)) { score -= 10; break; }
  }

  // Impact humain
  const impactHits = IMPACT_KW.filter((k) => full.includes(k)).length;
  score += impactHits * 15;

  // Verbes d'action
  if (hasAction) score += 10;

  // Année
  const year = extractYear(extract);
  if (!year && !hasAnyKeyword) {
    return { score: 0, rejected: true, reason: "Pas de date, pas de mot-clé", cat };
  }

  // Longueur
  if (extract.length > 200) score += 5;
  if (extract.length > 500) score += 5;

  // ── Grotte-Killer — origins mineur → score /5 ──────────────
  if (cat === "origins" && langs < 30) {
    score = Math.round(score / 5);
  }

  return { score, rejected: false, reason: `${cat} (catScore:${catScore} impact:${impactHits * 15}${titleHasShock || titleHasCiv || titleHasStruggle ? " TITRE_ROYAL+500" : ""}${cat === "origins" && langs < 30 ? " GROTTE÷5" : ""})`, cat };
}

// ─────────────────────────────────────────────────────────────────
//  TITRE & EXTRAIT
// ─────────────────────────────────────────────────────────────────

function formatTitle(rawTitle: string, year: number | null, extract: string): string {
  if (year !== null && year > 0) return `(${year}) ${rawTitle}`;
  if (year !== null && year < 0) return `(${Math.abs(year)} av. J.-C.) ${rawTitle}`;
  const label = formatCenturyLabel(`${rawTitle} ${extract}`);
  if (label) return `(${label}) ${rawTitle}`;
  return rawTitle;
}

function trimExtract(extract: string, year: number | null): string {
  const sentences = extract.split(/(?<=[.!?])\s+/);
  const allKW = [...SHOCK_KW, ...CIVILIZATION_KW, ...STRUGGLE_KW, ...ORIGINS_KW, ...IMPACT_KW];

  for (let i = 0; i < sentences.length; i++) {
    const sl = sentences[i].toLowerCase();
    const hasDate = /\b\d{3,4}\b/.test(sentences[i]) || /siècle/i.test(sentences[i]);
    const hasKw = allKW.some((k) => sl.includes(k)) || hasVerb(sl);
    if (hasDate && hasKw) return sentences.slice(i).join(" ").slice(0, 500);
  }

  if (year && year > 0) {
    const ys = String(year);
    const idx = sentences.findIndex((s) => s.includes(ys));
    if (idx >= 0) return sentences.slice(idx).join(" ").slice(0, 500);
  }

  for (const kw of allKW) {
    const idx = sentences.findIndex((s) => s.toLowerCase().includes(kw));
    if (idx >= 0) return sentences.slice(idx).join(" ").slice(0, 500);
  }

  return extract.slice(0, 500);
}

// ─────────────────────────────────────────────────────────────────
//  API CALLS (parallélisées)
// ─────────────────────────────────────────────────────────────────

async function geosearch(
  lat: number, lon: number, radius: number, limit = SHADOW_LIMIT
): Promise<GeoSearchResult[]> {
  const r = Math.min(10000, Math.max(10, radius));
  const params = new URLSearchParams({
    action: "query", list: "geosearch",
    gscoord: `${lat}|${lon}`, gsradius: String(r),
    gslimit: String(Math.min(limit, 500)),
    format: "json", origin: "*",
  });
  try {
    const res = await fetch(`${WIKI_API}?${params}`);
    if (!res.ok) return [];
    const json = await res.json();
    return json?.query?.geosearch ?? [];
  } catch { return []; }
}

/**
 * Recherche par mot-clé (srsearch) — pour trouver les Incontournables
 * que geosearch rate (ex: "Massacre du 17 octobre 1961" à Paris).
 * Retourne des articles avec coordonnées.
 */
async function keywordSearch(query: string, lat: number, lon: number): Promise<GeoSearchResult[]> {
  const params = new URLSearchParams({
    action: "query",
    list: "search",
    srsearch: `${query} ${lat.toFixed(1)} ${lon.toFixed(1)}`,
    srlimit: "5",
    format: "json",
    origin: "*",
  });

  try {
    const res = await fetch(`${WIKI_API}?${params}`);
    if (!res.ok) return [];
    const json = await res.json();
    const results = json?.query?.search ?? [];
    if (results.length === 0) return [];

    // Récupérer les coordonnées des articles trouvés
    const pids = results.map((r: any) => r.pageid);
    const coordParams = new URLSearchParams({
      action: "query",
      pageids: pids.join("|"),
      prop: "coordinates",
      format: "json",
      origin: "*",
    });

    const coordRes = await fetch(`${WIKI_API}?${coordParams}`);
    if (!coordRes.ok) return [];
    const coordJson = await coordRes.json();
    const pages = coordJson?.query?.pages ?? {};

    const geoResults: GeoSearchResult[] = [];
    for (const [pid, page] of Object.entries(pages)) {
      const p = page as any;
      const coords = p.coordinates?.[0];
      if (coords) {
        geoResults.push({
          pageid: Number(pid),
          title: p.title ?? "",
          lat: coords.lat,
          lon: coords.lon,
          dist: 0,
        });
      }
    }
    return geoResults;
  } catch { return []; }
}

async function fetchExtracts(pageids: number[]): Promise<Map<number, PageExtract>> {
  const result = new Map<number, PageExtract>();
  if (pageids.length === 0) return result;

  const chunks: number[][] = [];
  for (let i = 0; i < pageids.length; i += 50) chunks.push(pageids.slice(i, i + 50));

  await Promise.all(chunks.map(async (chunk) => {
    const params = new URLSearchParams({
      action: "query", pageids: chunk.join("|"),
      prop: "extracts", exintro: "true", explaintext: "true",
      exlimit: String(chunk.length),
      format: "json", origin: "*",
    });
    try {
      const res = await fetch(`${WIKI_API}?${params}`);
      if (!res.ok) return;
      const json = await res.json();
      const pages = json?.query?.pages ?? {};
      for (const [pid, page] of Object.entries(pages)) {
        const p = page as any;
        result.set(Number(pid), { pageid: Number(pid), title: p.title ?? "", extract: p.extract ?? "" });
      }
    } catch { /* */ }
  }));

  return result;
}

async function fetchLangCounts(pageids: number[]): Promise<Map<number, number>> {
  const result = new Map<number, number>();
  if (pageids.length === 0) return result;

  const chunks: number[][] = [];
  for (let i = 0; i < pageids.length; i += 50) chunks.push(pageids.slice(i, i + 50));

  await Promise.all(chunks.map(async (chunk) => {
    const params = new URLSearchParams({
      action: "query", pageids: chunk.join("|"),
      prop: "langlinks", lllimit: "500",
      format: "json", origin: "*",
    });
    try {
      const res = await fetch(`${WIKI_API}?${params}`);
      if (!res.ok) return;
      const json = await res.json();
      const pages = json?.query?.pages ?? {};
      for (const [pid, page] of Object.entries(pages)) {
        const p = page as any;
        result.set(Number(pid), (p.langlinks ?? []).length);
      }
    } catch { /* */ }
  }));

  return result;
}

// ─────────────────────────────────────────────────────────────────
//  GRILLE 5 POINTS — couverture ~50km
// ─────────────────────────────────────────────────────────────────

function buildGrid(lat: number, lon: number): Array<{ lat: number; lon: number }> {
  const offsetDeg = 0.18;
  return [
    { lat, lon },
    { lat: lat + offsetDeg, lon },
    { lat: lat - offsetDeg, lon },
    { lat, lon: lon + offsetDeg },
    { lat, lon: lon - offsetDeg },
  ];
}

// ─────────────────────────────────────────────────────────────────
//  MAIN
// ─────────────────────────────────────────────────────────────────

export async function fetchWikiEvents(
  lat: number,
  lon: number,
  radius: number = 10000
): Promise<WikiEvent[]> {
  const grid = buildGrid(lat, lon);

  const newPoints = grid.filter((p) => !gridCache.has(gridKey(p.lat, p.lon)));
  if (newPoints.length === 0) {
    console.log("[Wiki] Grille déjà scannée, skip");
    return [];
  }

  for (const p of newPoints) gridCache.add(gridKey(p.lat, p.lon));

  // 1. Shadow Fetching — geosearch 150/point + keyword search EN PARALLÈLE
  const geoPromises = newPoints.map((p) => geosearch(p.lat, p.lon, Math.min(radius, 10000), SHADOW_LIMIT));
  const kwPromises = KEYWORD_SEARCHES.map((kw) => keywordSearch(kw, lat, lon));

  const [allGeoResults, allKwResults] = await Promise.all([
    Promise.all(geoPromises),
    Promise.all(kwPromises),
  ]);

  // Dédupliquer — tracer les pageids issus de keyword search
  const kwPageIds = new Set<number>();
  for (const batch of allKwResults) {
    for (const g of batch) kwPageIds.add(g.pageid);
  }

  const uniqueMap = new Map<number, GeoSearchResult>();
  for (const batch of [...allGeoResults, ...allKwResults]) {
    for (const g of batch) {
      if (!uniqueMap.has(g.pageid) && !articleCache.has(g.pageid)) {
        uniqueMap.set(g.pageid, g);
      }
    }
  }

  const geoResults = Array.from(uniqueMap.values());
  if (geoResults.length === 0) return [];

  console.log(`[Wiki] Shadow Fetch: ${geoResults.length} articles bruts (limit ${SHADOW_LIMIT}/point)`);

  const pageids = geoResults.map((g) => g.pageid);

  // 2. Extraits + Langlinks en parallèle
  const [extracts, langCounts] = await Promise.all([
    fetchExtracts(pageids),
    fetchLangCounts(pageids),
  ]);

  // 3. Scorer, classifier, filtrer — ultra-sévère
  const scored: WikiEvent[] = [];

  for (const g of geoResults) {
    const ext = extracts.get(g.pageid);
    const rawExtract = ext?.extract ?? "";
    const rawTitle = ext?.title ?? g.title;
    const langs = langCounts.get(g.pageid) ?? 0;
    const fromKw = kwPageIds.has(g.pageid);

    const { score: baseScore, rejected, reason, cat } = computeScore(rawTitle, rawExtract, langs);

    if (rejected) {
      articleCache.set(g.pageid, null);
      console.log(`[Wiki] ✗ "${rawTitle}" — ${reason}`);
      continue;
    }

    // Multiplicateur de notoriété (sauf articles mémoriels déjà boostés ×10)
    const isAlreadyBoosted = baseScore >= 1000;
    const notorietyMult = isAlreadyBoosted ? 1 : 1 + Math.log2(Math.max(1, langs)) * 0.3;
    const finalScore = Math.round(baseScore * notorietyMult);

    // Élimination Origins mineurs (notoriété < 15 langues)
    if (cat === "origins" && langs < 15 && !fromKw) {
      articleCache.set(g.pageid, null);
      console.log(`[Wiki] ✗ "${rawTitle}" — Origins mineur (${langs} langues < 15)`);
      continue;
    }

    const year = extractYear(rawExtract);
    const description = trimExtract(rawExtract, year);
    const title = formatTitle(rawTitle, year, rawExtract);

    const event: WikiEvent = {
      id: g.pageid,
      title,
      description,
      lat: g.lat,
      lng: g.lon,
      year,
      category: cat,
      score: finalScore,
      notorietyScore: langs,
      isIncontournable: fromKw,
    };

    articleCache.set(g.pageid, event);
    scored.push(event);

    console.log(`[Wiki] ✓ "${title}" — ${cat} — score ${finalScore} (base:${baseScore}${isAlreadyBoosted ? " MÉMORIEL" : ` ×${notorietyMult.toFixed(2)}`}, ${langs} langues${fromKw ? " 🔑INCONTOURNABLE" : ""})`);
  }

  // 4. Tri ultra-sévère et top — seuls les meilleurs survivent
  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, MAX_RESULTS);

  console.log(`[Wiki] Shadow: ${geoResults.length} bruts → ${scored.length} retenus → top ${top.length} affichés`);

  return top;
}
