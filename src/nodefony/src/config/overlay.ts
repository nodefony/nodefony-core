/**
 * Calque de configuration par requête : une requête surcharge, pour elle seule,
 * quelques clés de la configuration d'un module — celles que le module a mises
 * sur sa LISTE BLANCHE.
 *
 * La configuration d'un module (`module.options`) est partagée par toutes les
 * requêtes et figée à la fin de `onReady`. Un calque ne l'écrit jamais : il vit
 * sur le scope de la requête, et {@link useConfig} rend la vue fusionnée à
 * CETTE requête seulement. Une clé hors liste blanche est refusée, et un module
 * qui n'en déclare pas n'accepte aucun calque — c'est le refus par défaut qui
 * empêche une organisation de toucher un secret, un port ou une politique de
 * sécurité.
 *
 * @example
 * ```ts
 * // au début de la requête (pare-feu, résolveur d'organisation…)
 * overlayConfig("@nodefony/http", { upload: { maxFileSize: 50_000_000 } });
 * // plus loin, dans le code qui applique la limite
 * const { upload } = useConfig("@nodefony/http");
 * ```
 */
import { Nodefony } from "../Nodefony";
import RequestContext from "../runtime/RequestContext";
import { isPlainObject } from "../Tools";
import {
  freezeConfigTree,
  parseConfigOverlay,
  type IModuleConfigEntry,
} from "../kernel/moduleConfig";
import type { IScope } from "../types/IContainer";
import type { ConfigOf } from "./use";

/**
 * Registre AUGMENTABLE des calques acceptés par module — la forme de la liste
 * blanche, déclarée par chaque module comme {@link NodefonyModuleConfig} :
 * @example
 * ```ts
 * declare module "nodefony" {
 *   interface NodefonyModuleOverlay {
 *     "@nodefony/http": z.input<typeof overlaySchema>;
 *   }
 * }
 * ```
 * Un module absent de ce registre n'accepte aucun calque : l'appel ne compile pas.
 */
// L'interface vide EST le point d'extension (declaration merging). Volontaire.
export interface NodefonyModuleOverlay {}

/** Calque accepté par le module `N` — `never` s'il n'en déclare pas. */
export type OverlayOf<N extends string> = N extends keyof NodefonyModuleOverlay
  ? NodefonyModuleOverlay[N]
  : never;

/**
 * Vues fusionnées, par scope puis par paquet. Une `WeakMap` et non un champ du
 * `Scope` : une requête sans calque ne paie rien, et le calque disparaît avec
 * son scope.
 */
const overlays = new WeakMap<IScope, Record<string, object>>();

function entryOf(packageName: string, caller: string): IModuleConfigEntry {
  const entry = Nodefony.getKernel()?.getModuleConfigEntry(packageName);
  if (entry === undefined) {
    throw new Error(
      `${caller} : aucune configuration figée pour « ${packageName} » — ` +
        "le module n'est pas chargé, ou la lecture a lieu avant la fin de onReady.",
    );
  }
  return entry;
}

/**
 * Fusion profonde dans des objets NEUFS, le long du seul chemin du calque : les
 * sous-arbres que le calque ne touche pas restent ceux de la racine, déjà
 * gelés. Un tableau ou une valeur simple du calque REMPLACE celle de la racine.
 */
const mergeOverlay = (base: unknown, patch: unknown): unknown => {
  if (!isPlainObject(base) || !isPlainObject(patch)) return patch;
  const out: Record<string, unknown> = {
    ...(base as Record<string, unknown>),
  };
  for (const key of Object.keys(patch as object)) {
    const value = (patch as Record<string, unknown>)[key];
    if (value !== undefined) out[key] = mergeOverlay(out[key], value);
  }
  return out;
};

/**
 * Pose un calque de configuration sur la requête courante.
 *
 * @remarks Validé contre la liste blanche du module (`overlaySchema`), fusionné
 * avec la configuration figée, puis gelé : la vue est calculée UNE fois ici,
 * jamais à la lecture. Deux appels pour un même module se cumulent. En
 * WebSocket, le scope est celui de la CONNEXION : le calque vaut pour tous ses
 * messages, invocations concurrentes comprises.
 *
 * @param packageName - nom du paquet du module (`"@nodefony/http"`)
 * @param overlay - les clés à surcharger, parmi celles de la liste blanche
 * @throws Error hors d'une requête, si le module n'accepte aucun calque, ou si
 *   une clé est hors liste blanche — le message nomme la clé
 */
export function overlayConfig<N extends string>(
  packageName: N,
  overlay: OverlayOf<N>,
): void {
  const scope = RequestContext.requireScope();
  const entry = entryOf(packageName, "overlayConfig");
  if (entry.overlaySchema === null) {
    throw new Error(
      `overlayConfig : « ${packageName} » n'accepte aucun calque de configuration — ` +
        "le module ne déclare pas de liste blanche (overlaySchema).",
    );
  }
  const valid = parseConfigOverlay(entry.overlaySchema, overlay, packageName);
  let byPackage = overlays.get(scope);
  if (byPackage === undefined) {
    byPackage = Object.create(null) as Record<string, object>;
    overlays.set(scope, byPackage);
  }
  const merged = mergeOverlay(
    byPackage[packageName] ?? entry.options,
    valid,
  ) as object;
  freezeConfigTree(merged);
  byPackage[packageName] = merged;
}

/**
 * Lit la configuration d'un module telle que la voit la requête courante.
 *
 * @remarks Sans calque (ou hors requête) : l'objet figé du module, rendu par
 * référence — aucune allocation. Avec calque : la vue fusionnée de CETTE
 * requête. Tout code qui lit une clé de la liste blanche doit passer par ici,
 * sinon le calque est accepté puis ignoré.
 *
 * @param packageName - nom du paquet du module (`"@nodefony/http"`)
 * @returns la configuration, en lecture seule
 * @throws Error si le module est inconnu ou si le kernel n'a pas fini `onReady`
 */
export function useConfig<N extends string>(
  packageName: N,
): Readonly<ConfigOf<N>> {
  const scope = RequestContext.getScope();
  if (scope !== undefined) {
    const merged = overlays.get(scope)?.[packageName];
    if (merged !== undefined) return merged as Readonly<ConfigOf<N>>;
  }
  return entryOf(packageName, "useConfig").options as Readonly<ConfigOf<N>>;
}
