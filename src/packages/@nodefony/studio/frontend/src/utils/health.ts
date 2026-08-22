/**
 * Indice de **Santé du framework** — logique PARTAGÉE (source unique) entre la page
 * Supervision mono-process (détail) et l'accueil multi-process (santé pod agrégée).
 *
 * Méthode **Derringer-Suich** (NIST Engineering Statistics Handbook §5.5.3.2.2) :
 * chaque sonde → désirabilité [0,1] (« smaller is better »), combinées par **moyenne
 * géométrique PONDÉRÉE**. Les **poids sont réglables + persistés** (clé localStorage
 * `nf.supervision.weights`) → la spec de pondération vaut pour les DEUX vues.
 */

/** Clé de persistance des poids (réglés par les sliders de la page Supervision). */
export const HEALTH_WEIGHTS_KEY = "nf.supervision.weights";

/** Poids par défaut de chaque sonde dans l'indice (réglables par l'utilisateur). */
export const DEFAULT_WEIGHTS: Record<string, number> = {
  CPU: 1,
  "Saturation (ELU)": 1.5,
  "Event-loop": 1.5,
  "Mémoire (heap)": 1,
  "GC overhead": 0.8,
  Erreurs: 1.2,
  Connecteurs: 1,
  "Temps réel": 0.5,
};

/** Une entrée de l'indice de santé : valeur courante + seuils bon/critique + poids. */
export interface HealthInput {
  label: string;
  /** Valeur courante (« smaller is better ») ou `null` si indisponible (exclue). */
  value: number | null;
  /** Seuil « bon » (d=1 en dessous). */
  good: number;
  /** Seuil « critique » (d=0 au-dessus). */
  crit: number;
  /** Poids dans la moyenne géométrique. */
  weight: number;
  /**
   * Plancher de désirabilité (défaut 0). Une métrique de **SATURATION** (CPU, ELU,
   * event-loop, GC) dégrade le score sans le faire tomber à 0 — le framework saturé
   * RALENTIT mais SERT toujours (≠ panne). Plancher ~0.2 → « Dégradé », pas « Critique ».
   */
  floor?: number;
  /**
   * Si `true`, cette métrique est une **PANNE réelle** (erreurs, connecteur coupé,
   * heap proche OOM) : atteindre son seuil critique tire l'indice GLOBAL à 0
   * (Critique). Les métriques de saturation sont `false` → jamais de Critique seules.
   */
  critical?: boolean;
}

/** Résultat de l'agrégation : indice 0-100 + libellé/couleur + facteur limitant. */
export interface HealthResult {
  score: number | null;
  label: string;
  color: string;
  worst: string | null;
  /** Détail par sonde : sous-score, poids, et classe (saturation planchée vs panne). */
  parts: {
    label: string;
    score: number;
    weight: number;
    kind: "sat" | "fail";
  }[];
}

/**
 * Désirabilité d'une métrique « smaller is better » (Derringer-Suich) : 1 sous le
 * seuil bon, 0 au-dessus du critique, rampe linéaire entre les deux.
 */
export function healthDesirability(
  v: number,
  good: number,
  crit: number,
): number {
  if (crit <= good) return v <= good ? 1 : 0;
  if (v <= good) return 1;
  if (v >= crit) return 0;
  return (crit - v) / (crit - good);
}

/**
 * **Indice de santé composite** (0-100) — agrège des sondes hétérogènes via la
 * méthode Derringer-Suich : chaque sonde normalisée en désirabilité [0,1], puis
 * combinées par **moyenne géométrique pondérée**. Si une sonde `critical` est à 0,
 * l'indice tombe à 0 (le maillon faible domine). Sondes `null` (ou poids 0) exclues.
 */
export function buildHealth(inputs: HealthInput[]): HealthResult {
  const avail = inputs.filter((m) => m.value != null && m.weight > 0);
  if (!avail.length) {
    return { score: null, label: "—", color: "gray", worst: null, parts: [] };
  }
  let anyZero = false;
  let sumW = 0;
  let sumWln = 0;
  let worst: HealthInput | null = null;
  let worstD = 2;
  const parts: HealthResult["parts"] = [];
  for (const m of avail) {
    // Désirabilité brute, puis PLANCHER : une saturation (floor>0) contribue mais
    // ne tombe jamais à 0 → « Dégradé », pas « Critique ».
    const raw = healthDesirability(m.value as number, m.good, m.crit);
    const d = Math.max(raw, m.floor ?? 0);
    parts.push({
      label: m.label,
      score: Math.round(d * 100),
      weight: m.weight,
      kind: m.critical ? "fail" : "sat",
    });
    if (d < worstD) {
      worstD = d;
      worst = m;
    }
    // Seule une PANNE réelle (critical) à son seuil critique force l'indice à 0.
    if (m.critical && raw <= 0) anyZero = true;
    sumW += m.weight;
    sumWln += m.weight * Math.log(Math.max(d, 1e-9));
  }
  const D = anyZero ? 0 : Math.exp(sumWln / sumW);
  const score = Math.round(D * 100);
  const [label, color] =
    score >= 90
      ? ["Excellent", "teal"]
      : score >= 75
        ? ["Bon", "green"]
        : score >= 50
          ? ["À surveiller", "yellow"]
          : score >= 25
            ? ["Dégradé", "orange"]
            : ["Critique", "red"];
  return { score, label, color, worst: worst?.label ?? null, parts };
}

/**
 * Charge les poids persistés (sliders Supervision) fusionnés avec {@link DEFAULT_WEIGHTS}.
 * → la santé pod (accueil) applique EXACTEMENT la pondération réglée sur la page détail.
 */
export function loadHealthWeights(): Record<string, number> {
  try {
    const raw =
      typeof localStorage !== "undefined"
        ? localStorage.getItem(HEALTH_WEIGHTS_KEY)
        : null;
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        return { ...DEFAULT_WEIGHTS, ...(parsed as Record<string, number>) };
      }
    }
  } catch {
    /* ignore */
  }
  return { ...DEFAULT_WEIGHTS };
}
