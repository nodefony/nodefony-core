/**
 * La règle qui décide QUELS modules du manifeste seront chargés — et lesquels
 * disparaîtront.
 *
 * Extraite du Kernel pour une raison précise : cette décision se pose à DEUX
 * moments, et pas seulement au démarrage. Le boot l'applique pour de vrai ; le
 * diagnostic (`nodefony doctor --env production`) la rejoue à froid, sur un
 * poste de développement, pour répondre à la question qu'on se pose AVANT de
 * déployer — « qu'est-ce qui ne sera plus là, là-bas ? ». Deux copies de la
 * règle divergeraient au premier cas particulier, et c'est précisément le
 * silence qu'on veut casser qui reviendrait par la porte de derrière.
 *
 * Fonction PURE : ni `process.env`, ni kernel, ni journal. Ce qui la rend
 * éprouvable pour un environnement dans lequel on ne tourne PAS — et c'est tout
 * l'objet de son second lecteur.
 */
import type {
  IModuleManifest,
  IModuleManifestEntry,
} from "../types/IModuleManifest";

/** Ce que la garde `when()` d'un manifeste reçoit — la config fusionnée du kernel. */
export type GateConfig = Parameters<
  NonNullable<IModuleManifestEntry["when"]>
>[0];

/** Une entrée retenue, prête à charger. */
export interface IModuleEntry {
  name: string;
  config?: Record<string, unknown>;
}

/** Un module volontairement écarté, avec la raison qui le dit. */
export interface IModuleGated {
  /** Nom d'entrée du manifeste (`config.modules`). */
  module: string;
  /** Raison lisible du non-chargement. */
  reason: string;
}

/** Ce que la règle décide d'un manifeste, sans rien exécuter. */
export interface IGatingOutcome {
  /** Les entrées retenues, dans l'ordre du manifeste (= priorité de chargement). */
  entries: IModuleEntry[];
  /** Les entrées écartées, avec leur raison. */
  gated: IModuleGated[];
  /**
   * Les modules `policy:"dev"` chargés en production PAR DÉROGATION.
   *
   * Rendus à part parce qu'ils appellent un geste que la règle pure ne peut pas
   * faire : le crier au journal et armer l'auto-arrêt. Un module de banc dans
   * un runtime de production est une surface offerte — personne ne doit la
   * découvrir en lisant les routes.
   */
  derogated: string[];
}

/** Ce que la règle a besoin de savoir de l'environnement — jamais lu ici. */
export interface IGatingInput {
  /** `true` si le runtime visé est un runtime de production (collapse dev/prod). */
  isProduction: boolean;
  /** `true` si la dérogation `NF_WITH_DEV_MODULES=1` est posée. */
  forceDevModules: boolean;
  /**
   * La config fusionnée, sur laquelle chaque `when()` est évalué.
   *
   * Le type est DÉRIVÉ de la garde du manifeste plutôt qu'importé du Kernel :
   * la règle n'a besoin de rien savoir du Kernel, et l'y raccrocher rendrait
   * ce module inatteignable depuis un diagnostic qui, justement, ne boote pas.
   */
  config: GateConfig;
}

/** La raison affichée quand la politique du module l'écarte d'un runtime de production. */
export const GATED_BY_POLICY = 'policy "dev" — runtime production';

/** La raison affichée quand la garde `when(config)` du module refuse. */
export const GATED_BY_CONDITION = "condition when(config) non remplie";

/**
 * Applique la règle de gating à un manifeste.
 *
 * `policy`/`when` ne font que FILTRER — jamais réordonner : l'ordre du tableau
 * est la priorité de chargement, et un tri introduirait une dépendance que
 * personne n'a écrite.
 *
 * @param manifest - le manifeste `config.modules`, tel qu'il est déclaré.
 * @param input - ce qu'il faut savoir de l'environnement visé.
 * @returns les entrées retenues, celles écartées, et les dérogations.
 */
export function gateModuleManifest(
  manifest: IModuleManifest | unknown,
  input: IGatingInput,
): IGatingOutcome {
  const entries: IModuleEntry[] = [];
  const gated: IModuleGated[] = [];
  const derogated: string[] = [];
  if (!Array.isArray(manifest)) return { entries, gated, derogated };

  for (const item of manifest) {
    const entry: IModuleManifestEntry =
      typeof item === "string" ? { name: item } : item;
    if (!entry?.name) continue;

    if (entry.policy === "dev" && input.isProduction) {
      if (input.forceDevModules) {
        derogated.push(entry.name);
      } else {
        gated.push({ module: entry.name, reason: GATED_BY_POLICY });
        continue;
      }
    }
    // Une garde qui lève ne doit pas emporter le boot entier : le manifeste
    // d'une application est écrit à la main, et une `when()` fautive laisserait
    // le Kernel sans le moindre module plutôt qu'avec un module de moins.
    let allowed = true;
    if (typeof entry.when === "function") {
      try {
        allowed = Boolean(entry.when(input.config));
      } catch (e) {
        gated.push({
          module: entry.name,
          reason: `condition when(config) en erreur — ${(e as Error).message}`,
        });
        continue;
      }
    }
    if (!allowed) {
      gated.push({ module: entry.name, reason: GATED_BY_CONDITION });
      continue;
    }
    entries.push({ name: entry.name, config: entry.config });
  }
  return { entries, gated, derogated };
}
