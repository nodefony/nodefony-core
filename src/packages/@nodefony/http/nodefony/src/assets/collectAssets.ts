import { join } from "node:path";
import { stripTrailingSlashes } from "nodefony";

/**
 * Une source d'assets statiques : un dossier servi sous un préfixe d'URL.
 * Provient soit des montages natifs `server-static.mounts` (publics de module),
 * soit des bundles `@nodefony/frontend` (`publicPath` → `outDir` buildé).
 */
export interface AssetSource {
  /** Préfixe d'URL public (ex. `/_assets/studio/`, `/test/`). */
  prefix: string;
  /** Dossier ABSOLU servi sous ce préfixe. */
  dir: string;
}

/**
 * Une entrée du plan de publication : copier `dir` → `target` (sous-arbre de
 * `outDir` miroir du préfixe d'URL), servi à terme par le CDN sous `prefix`.
 */
export interface AssetPlanEntry {
  prefix: string;
  dir: string;
  /** Dossier de destination ABSOLU dans l'arbre `outDir`. */
  target: string;
}

/** Normalise un préfixe en segment de chemin (`/_assets/x/` → `_assets/x`). */
const prefixToSegment = (prefix: string): string =>
  stripTrailingSlashes(prefix.replace(/^\/+/, ""));

/**
 * Construit le plan de publication des assets : pour chaque source unique
 * (dédupliquée par préfixe — le DERNIER gagne, comme `addMount`), calcule le
 * dossier cible `outDir/<préfixe-en-chemin>` miroir de l'URL.
 *
 * PUR (0 I/O) → testable. La copie réelle + le manifeste sont faits par la
 * commande `assets:publish`. L'upload (S3/CDN/rsync) reste à l'orchestrateur :
 * Nodefony assemble l'arbre, le déploiement le pousse (cloud-native).
 *
 * @param sources dossiers + préfixes (mounts natifs + bundles frontend)
 * @param outDir racine ABSOLUE de l'arbre de sortie (ex. `<root>/dist-assets`)
 * @returns plan ordonné, 1 entrée par préfixe unique
 */
export function planAssetPublish(
  sources: ReadonlyArray<AssetSource>,
  outDir: string,
): AssetPlanEntry[] {
  // Dédup par préfixe (le dernier écrase), ordre d'insertion préservé.
  const byPrefix = new Map<string, string>();
  for (const s of sources) byPrefix.set(s.prefix, s.dir);
  const plan: AssetPlanEntry[] = [];
  for (const [prefix, dir] of byPrefix) {
    const seg = prefixToSegment(prefix);
    plan.push({ prefix, dir, target: seg ? join(outDir, seg) : outDir });
  }
  return plan;
}
