import { lazy } from "react";

/* ════════════════════════════════════════════════════════════════════════
 * staleChunk.ts — un onglet PÉRIMÉ se recharge une fois, tout seul.
 *
 * Après un redéploiement (ou un passage développement → production), un onglet
 * resté ouvert demande les fichiers de la génération précédente : noms hachés
 * disparus, ou URL de Vite qui ne tourne plus. Le premier changement d'écran
 * échouait alors sur « Failed to fetch dynamically imported module » et la
 * console semblait en panne, alors qu'un rechargement suffisait.
 * ════════════════════════════════════════════════════════════════════════ */

const RELOAD_KEY = "nodefony:studio:stale-chunk-reload";

/**
 * Fenêtre pendant laquelle un second échec n'est PLUS un onglet périmé : la
 * page vient d'être rechargée et l'écran ne se charge toujours pas. On laisse
 * alors l'erreur remonter — jamais de boucle de rechargements.
 */
const RELOAD_WINDOW_MS = 10_000;

/**
 * Recharge la page UNE fois quand un module de l'application ne se charge pas.
 *
 * @returns `true` si le rechargement est lancé ; `false` si un rechargement
 *   vient d'avoir lieu, ou si le stockage de session est indisponible (sans
 *   mémoire, un rechargement pourrait boucler).
 */
export function reloadForStaleChunk(): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) ?? 0);
    if (Date.now() - last < RELOAD_WINDOW_MS) return false;
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    return false;
  }
  window.location.reload();
  return true;
}

/**
 * `React.lazy` qui survit à un redéploiement : un import en échec déclenche
 * {@link reloadForStaleChunk}. Pendant le rechargement, la promesse ne se
 * résout jamais — le repli `Suspense` reste affiché au lieu d'un écran d'erreur.
 *
 * Même signature que `lazy` (l'import dynamique de l'écran, remappé sur
 * `default`) : elle s'y substitue sans rien changer d'autre.
 */
export const lazyRoute: typeof lazy = (load) =>
  lazy(() =>
    load().catch((error: unknown) => {
      if (reloadForStaleChunk()) return new Promise<never>(() => {});
      throw error;
    }),
  );
