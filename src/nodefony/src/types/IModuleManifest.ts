import type { TypeKernelOptions } from "../kernel/Kernel";

/**
 * Politique de chargement d'un module.
 *
 * - `mandatory` : socle — toujours chargé, non gatable (ex. http, framework, security, studio).
 * - `optional`  : chargé sauf si une condition `when` le filtre (valeur par défaut).
 * - `dev`       : chargé UNIQUEMENT hors production (outillage, démo, Studio dev).
 *
 * La politique **filtre** ; elle ne **réordonne jamais** — l'ordre de chargement
 * reste l'ordre du tableau du manifeste (cf {@link IModuleManifest}).
 */
export type ModulePolicy = "mandatory" | "optional" | "dev";

/**
 * Entrée détaillée d'un manifeste de modules.
 *
 * @see project_module_loading_architecture (mémoire IA) pour la décision d'archi.
 */
export interface IModuleManifestEntry {
  /** Nom du package/module à charger (résolu par `import()` dynamique). */
  name: string;
  /** Politique de chargement. Défaut : `"optional"`. */
  policy?: ModulePolicy;
  /**
   * Garde de chargement évaluée sur la config fusionnée du kernel. Renvoie `false`
   * → le module est ignoré (non importé = 0 coût boot/mémoire). Ex. ne charger
   * `@nodefony/drizzle` que si `config.orm?.driver === "drizzle"`.
   */
  when?: (config: TypeKernelOptions) => boolean;
}

/**
 * Manifeste déclaratif des modules d'une application Nodefony, exposé via
 * `config.modules`. Le Kernel en est le **seul orchestrateur** : il lit cette
 * liste, la filtre (policy + `when` + environnement) et charge les modules en
 * série à `onPreRegister`.
 *
 * **Liste ORDONNÉE** : la position dans le tableau = ordre (= priorité) de
 * chargement. Choix volontaire — l'ordre porte des invariants réels (realtime
 * après framework, frontend avant ses consumers, documentation avant studio).
 * `policy`/`when` ne font que filtrer ; ils ne réordonnent pas.
 *
 * Une `string` nue équivaut à `{ name, policy: "optional" }`.
 */
export type IModuleManifest = (string | IModuleManifestEntry)[];
