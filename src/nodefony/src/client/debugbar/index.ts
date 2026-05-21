/**
 * Subpath `nodefony/debugbar` — point d'entrée de la debug bar Nodefony.
 *
 * Entry Rollup SÉPARÉE (tree-shakée, 0 octet si non importée) : ce fichier ne
 * doit JAMAIS être réexporté depuis `client/index.ts` (sinon le barrel `nodefony`
 * navigateur tire toute la barre). Cf décision `project_client_lib_subpaths_decision`.
 *
 * Usage :
 * ```ts
 * import { mountDebugBar } from "nodefony/debugbar";
 * mountDebugBar(); // dev only
 * ```
 */
import { DebugBar, type DebugBarOptions } from "./DebugBar";

export { DebugBar };
export type { DebugBarOptions };
export type { DebugBarView, DebugBarModel } from "./model";

// Modèle PUR du profiler/Network (tree-shakeable, 0 DOM) — réutilisé par Studio
// (page Profiler React) sans dupliquer la logique de waterfall. Cf décision
// « widget par-page + Studio = 2 consommateurs du même Core isomorphe ».
export {
  computeWaterfall,
  phaseTier,
  NetworkModel,
  isError as isNetworkError,
} from "./profile";
export type {
  ProfileEntry,
  ProfilePhase,
  ProfileQuery,
  ProfileState,
  WaterfallBar,
} from "./profile";
export type { NetEntry } from "./network";

/**
 * Monte la debug bar sur la page courante. Idempotent (un seul widget par page).
 * No-op hors navigateur (SSR). Branche un {@link RealtimeClient} sur le WS
 * realtime et rend l'overlay live.
 *
 * @param opts - URL du WS, client partagé, position, ouverture initiale
 * @returns l'instance {@link DebugBar} (appeler `.unmount()` pour retirer)
 */
export function mountDebugBar(opts: DebugBarOptions = {}): DebugBar {
  return new DebugBar(opts).mount();
}

export default mountDebugBar;
