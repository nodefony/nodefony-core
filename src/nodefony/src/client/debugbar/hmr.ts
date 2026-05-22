/**
 * Observation des hot-updates Vite **sans ouvrir de WebSocket**.
 *
 * Historique : cette sonde ouvrait jadis un **2ᵉ client** WebSocket `vite-hmr`
 * sur le serveur HMR de Vite. Ce client passif (il ne renvoyait jamais le
 * heartbeat attendu) se faisait fermer par Vite, puis se reconnectait en
 * boucle → une cascade de connexions `wss://…:5173` qui s'ouvrent et se ferment
 * sans fin dans la console. C'était aussi un WebSocket de trop (philosophie
 * Nodefony : une seule connexion temps réel côté navigateur).
 *
 * Désormais : aucun socket. On écoute un `CustomEvent` `nodefony:hmr` émis sur
 * `window` par un pont injecté côté page (TemplateHelper, `@nodefony/frontend`),
 * lequel se branche sur le client HMR **déjà chargé** par Vite via
 * `createHotContext` — zéro connexion ajoutée.
 */
export type HmrKind =
  | "connected"
  | "update"
  | "full-reload"
  | "error"
  | "prune";

export interface HmrEvent {
  kind: HmrKind;
  /** Chemin du module mis à jour (si fourni par Vite). */
  path?: string;
}

/** Nom de l'événement DOM émis par le pont HMR côté page. */
export const HMR_EVENT = "nodefony:hmr";

/**
 * Observe les hot-updates Vite via l'événement `window` `nodefony:hmr`.
 * Aucune connexion réseau ouverte. No-op hors navigateur.
 *
 * @param onEvent - appelé à chaque hot-update relayé par le pont.
 * @returns dispose() — retire le listener (OBLIGATOIRE au démontage).
 */
export function observeViteHmr(onEvent: (e: HmrEvent) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (ev: Event): void => {
    const detail = (ev as CustomEvent).detail as HmrEvent | undefined;
    if (detail && typeof detail.kind === "string") onEvent(detail);
  };
  window.addEventListener(HMR_EVENT, handler);
  return () => window.removeEventListener(HMR_EVENT, handler);
}
