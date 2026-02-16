// ═══════════════════════════════════════════════════════════════════
//  GAME ENGINE — Mode Quiz « Devinez l'Histoire »
//  Logique pure, zéro UI.
//  Masquage intelligent · Leurres par catégorie · Scoring dynamique
// ═══════════════════════════════════════════════════════════════════

import type { WikiEvent, WikiCategory } from "./wikipedia";

// ─────────────────────────────────────────────────────────────────
//  TYPES
// ─────────────────────────────────────────────────────────────────

export interface QuizQuestion {
  eventId: string;
  correctTitle: string;
  maskedDescription: string;
  hints: {
    category: WikiCategory;
    year: number | null;
    actions: string[];
  };
  options: string[];
  difficulty: "easy" | "hard";
}

export interface QuizResult {
  points: number;
  hintsUsed: number;
  wasQCM: boolean;
  correct: boolean;
}

// ─────────────────────────────────────────────────────────────────
//  VERBES D'ACTION — extraits de la description pour les indices
//  Mapping radical → infinitif lisible pour l'affichage
// ─────────────────────────────────────────────────────────────────

const VERB_MAP: Record<string, string> = {
  assassin: "assassiner",
  proclam: "proclamer",
  envahi: "envahir",
  sign: "signer",
  découvr: "découvrir",
  soulev: "se soulever",
  conqui: "conquérir",
  détru: "détruire",
  incendi: "incendier",
  bombard: "bombarder",
  libér: "libérer",
  occup: "occuper",
  exécut: "exécuter",
  massacr: "massacrer",
  fusill: "fusiller",
  déport: "déporter",
  resist: "résister",
  revolt: "se révolter",
  fond: "fonder",
  constru: "construire",
  érig: "ériger",
  bâti: "bâtir",
};

const VERB_RADICALS = Object.keys(VERB_MAP);

// ─────────────────────────────────────────────────────────────────
//  MASQUAGE INTELLIGENT
//  Remplace le titre ET ses fragments significatifs par ██████
// ─────────────────────────────────────────────────────────────────

/**
 * Extrait les mots significatifs d'un titre (≥ 4 caractères,
 * sans les mots-outils : de, du, le, la, les, des, au, aux, en, l', d', …)
 */
function extractSignificantWords(title: string): string[] {
  const STOP_WORDS = new Set([
    "de", "du", "des", "le", "la", "les", "un", "une",
    "au", "aux", "en", "et", "ou", "par", "pour", "sur",
    "dans", "avec", "sans", "sous", "entre", "vers",
    "qui", "que", "dont", "son", "ses", "leur", "ce",
    "cette", "ces", "est", "été", "sont", "fut", "ont",
  ]);

  return title
    .replace(/\(\d{1,4}(?:\s*av\.?\s*J\.?-?C\.?)?\)\s*/g, "") // retirer (1789) etc.
    .split(/[\s''`\-–—/,.:;]+/)
    .map((w) => w.replace(/[^a-zA-ZÀ-ÿ]/g, ""))
    .filter((w) => w.length >= 4 && !STOP_WORDS.has(w.toLowerCase()));
}

/**
 * Masque le titre complet + chaque mot significatif dans la description.
 * Retourne la description avec les ██████.
 */
function maskDescription(description: string, rawTitle: string): string {
  // Nettoyer le titre (retirer le préfixe d'année ajouté par formatTitle)
  const cleanTitle = rawTitle
    .replace(/^\(\d{1,4}(?:\s*av\.?\s*J\.?-?C\.?)?\)\s*/, "")
    .replace(/^\([IVXLCDM]+e(?:\s*av\.?\s*J\.?-?C\.?)?\)\s*/, "")
    .trim();

  let masked = description;

  // 1. Masquer le titre complet (insensible à la casse)
  if (cleanTitle.length > 0) {
    const fullTitleRegex = new RegExp(escapeRegex(cleanTitle), "gi");
    masked = masked.replace(fullTitleRegex, "██████");
  }

  // 2. Masquer chaque mot significatif individuellement
  const words = extractSignificantWords(cleanTitle);
  for (const word of words) {
    const wordRegex = new RegExp(`\\b${escapeRegex(word)}\\b`, "gi");
    masked = masked.replace(wordRegex, "████");
  }

  return masked;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ─────────────────────────────────────────────────────────────────
//  EXTRACTION DES VERBES D'ACTION
//  Retourne les 3 verbes les plus pertinents (forme infinitive)
// ─────────────────────────────────────────────────────────────────

function extractActionVerbs(description: string, maxCount = 3): string[] {
  const lower = description.toLowerCase();
  const found: string[] = [];

  for (const radical of VERB_RADICALS) {
    if (lower.includes(radical) && !found.includes(VERB_MAP[radical])) {
      found.push(VERB_MAP[radical]);
      if (found.length >= maxCount) break;
    }
  }

  return found;
}

// ─────────────────────────────────────────────────────────────────
//  GÉNÉRATION DE LEURRES (DECOYS)
//  3 fausses réponses parmi les événements de la même catégorie.
//  Fallback : pioche dans les autres catégories si pas assez.
// ─────────────────────────────────────────────────────────────────

function generateDecoys(
  correctEvent: WikiEvent,
  pool: WikiEvent[],
  count = 3,
): string[] {
  // Nettoyer le titre pour la comparaison
  const correctClean = correctEvent.title
    .replace(/^\(\d{1,4}(?:\s*av\.?\s*J\.?-?C\.?)?\)\s*/, "")
    .replace(/^\([IVXLCDM]+e(?:\s*av\.?\s*J\.?-?C\.?)?\)\s*/, "")
    .trim()
    .toLowerCase();

  // Priorité : même catégorie, puis tout le pool
  const sameCategory = pool.filter(
    (e) =>
      e.id !== correctEvent.id &&
      e.category === correctEvent.category &&
      cleanTitle(e.title).toLowerCase() !== correctClean,
  );

  const otherCategory = pool.filter(
    (e) =>
      e.id !== correctEvent.id &&
      e.category !== correctEvent.category &&
      cleanTitle(e.title).toLowerCase() !== correctClean,
  );

  // Mélanger aléatoirement
  const shuffled = [...shuffle(sameCategory), ...shuffle(otherCategory)];

  const decoys: string[] = [];
  const used = new Set<string>();
  used.add(correctClean);

  for (const e of shuffled) {
    const clean = cleanTitle(e.title).toLowerCase();
    if (!used.has(clean)) {
      decoys.push(cleanTitle(e.title));
      used.add(clean);
      if (decoys.length >= count) break;
    }
  }

  // Si pas assez de leurres, générer des titres génériques
  const genericFallbacks = [
    "Siège de Constantinople",
    "Révolte des Canuts",
    "Traité de Westphalie",
    "Bataille de Verdun",
    "Massacre de Wounded Knee",
    "Chute de l'Empire romain",
    "Croisade des Albigeois",
    "Déclaration de Balfour",
  ];

  let fi = 0;
  while (decoys.length < count && fi < genericFallbacks.length) {
    if (!used.has(genericFallbacks[fi].toLowerCase())) {
      decoys.push(genericFallbacks[fi]);
      used.add(genericFallbacks[fi].toLowerCase());
    }
    fi++;
  }

  return decoys.slice(0, count);
}

function cleanTitle(title: string): string {
  return title
    .replace(/^\(\d{1,4}(?:\s*av\.?\s*J\.?-?C\.?)?\)\s*/, "")
    .replace(/^\([IVXLCDM]+e(?:\s*av\.?\s*J\.?-?C\.?)?\)\s*/, "")
    .trim();
}

function shuffle<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// ─────────────────────────────────────────────────────────────────
//  PREPARE QUIZ QUESTION
//  Transforme un WikiEvent en question de quiz complète.
// ─────────────────────────────────────────────────────────────────

/**
 * Prépare une question de quiz à partir d'un WikiEvent.
 *
 * @param event  L'événement à deviner
 * @param pool   Liste de WikiEvents (pour générer les leurres)
 * @param difficulty  'easy' (QCM) ou 'hard' (saisie libre)
 */
export function prepareQuizQuestion(
  event: WikiEvent,
  pool: WikiEvent[],
  difficulty: "easy" | "hard" = "easy",
): QuizQuestion {
  const correctTitle = cleanTitle(event.title);
  const maskedDescription = maskDescription(event.description, event.title);
  const actions = extractActionVerbs(event.description);

  // Générer 3 leurres + la bonne réponse, mélangés
  const decoys = generateDecoys(event, pool);
  const options = shuffle([correctTitle, ...decoys]);

  return {
    eventId: String(event.id),
    correctTitle,
    maskedDescription,
    hints: {
      category: event.category,
      year: event.year,
      actions,
    },
    options,
    difficulty,
  };
}

// ─────────────────────────────────────────────────────────────────
//  CALCULATE POINTS
//  100 pts de base, -30 par indice, -50% si QCM
// ─────────────────────────────────────────────────────────────────

/**
 * Calcule le score final d'une réponse.
 *
 * @param correct     La réponse était-elle correcte ?
 * @param hintsUsed   Nombre d'indices révélés (0-3)
 * @param wasQCM      true si le joueur a utilisé le mode QCM (facile)
 */
export function calculatePoints(
  correct: boolean,
  hintsUsed: number,
  wasQCM: boolean,
): QuizResult {
  if (!correct) {
    return { points: 0, hintsUsed, wasQCM, correct: false };
  }

  let points = 100;

  // -30 points par indice révélé
  points -= hintsUsed * 30;

  // -50% si mode QCM (facile)
  if (wasQCM) {
    points = Math.round(points * 0.5);
  }

  // Plancher à 10 points (on récompense toujours une bonne réponse)
  points = Math.max(10, points);

  return { points, hintsUsed, wasQCM, correct: true };
}
