/**
 * Mesure de RÉTENTION par itération : une pente, jamais un écart.
 *
 * Un écart avant/après sur 1 000 requêtes est la différence de deux mesures
 * bruitées : le serveur de dev (HMR, profileur, logs) retient du tas PAR
 * À-COUPS, et un seul à-coup de 2,5 Mo se lit comme 2,5 Ko « retenus par
 * requête ». On relève donc le tas (GC forcé par la sonde) à paliers réguliers
 * et on prend la pente robuste de Theil–Sen — la médiane des pentes de toutes
 * les paires de points —, qui ignore un point aberrant là où une régression
 * aux moindres carrés s'y aligne.
 */

/**
 * Pente de Theil–Sen : médiane des pentes de toutes les paires de points.
 *
 * @param xs - abscisses (nombre d'itérations cumulées), strictement croissantes
 * @param ys - ordonnées (octets de tas mesurés)
 * @returns la pente, en unités de `ys` par unité de `xs`
 */
export function theilSen(xs: number[], ys: number[]): number {
  const slopes: number[] = [];
  for (let i = 0; i < xs.length; i++) {
    for (let j = i + 1; j < xs.length; j++) {
      slopes.push((ys[j] - ys[i]) / (xs[j] - xs[i]));
    }
  }
  if (slopes.length === 0) throw new Error("theilSen : au moins 2 points");
  slopes.sort((a, b) => a - b);
  const mid = slopes.length >> 1;
  return slopes.length % 2 ? slopes[mid] : (slopes[mid - 1] + slopes[mid]) / 2;
}

export interface IRetentionPlan {
  /** relève le tas du serveur, GC forcé (`/nodefony/test/memory`) */
  probe: () => Promise<number>;
  /** une itération (une requête, une connexion…) ; reçoit son rang */
  act: (i: number) => Promise<void>;
  /** itérations jetées avant le premier point (caches, JIT, lazy init) */
  warmup: number;
  /** itérations entre deux points */
  batch: number;
  /** nombre de paliers : `batches + 1` points */
  batches: number;
  /**
   * unités portées par UNE itération (défaut 1) — un lot de 50 streams
   * concurrents, 10 sockets × 100 trames : la pente est rendue PAR unité.
   */
  unit?: number;
}

export interface IRetention {
  /** octets retenus par unité (pente de Theil–Sen ÷ `unit`) */
  slope: number;
  /** tas relevé à chaque palier, en octets */
  points: number[];
}

/**
 * Déroule le plan et rend la pente de rétention par itération.
 *
 * @param plan - sonde, action, échauffement et paliers
 * @returns la pente (octets / itération) et les points relevés
 */
export async function measureRetention(
  plan: IRetentionPlan,
): Promise<IRetention> {
  let n = 0;
  for (let i = 0; i < plan.warmup; i++) await plan.act(n++);
  const xs: number[] = [0];
  const points: number[] = [await plan.probe()];
  for (let k = 1; k <= plan.batches; k++) {
    for (let i = 0; i < plan.batch; i++) await plan.act(n++);
    xs.push(k * plan.batch);
    points.push(await plan.probe());
  }
  return { slope: theilSen(xs, points) / (plan.unit ?? 1), points };
}
