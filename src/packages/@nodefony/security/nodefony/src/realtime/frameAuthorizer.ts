import type { FrameAuthorizer, IRealtimeToken } from "./realtimeContracts";

/**
 * Surface MINIMALE du firewall consommée par le verrou de frame : matcher une
 * zone par pathname. `Firewall.matchPath` la satisfait structurellement
 * (`SecuredArea` porte `security`) — typage local pour éviter un cycle d'import
 * `firewall.ts` ↔ `frameAuthorizer.ts`.
 */
export interface IZoneMatcher {
  matchPath(
    pathname: string,
    host?: string,
  ): { readonly security: boolean } | null;
}

/**
 * Préfixes de canaux d'**introspection serveur** (observabilité) — s'y abonner
 * expose l'état interne du pod (logs, requêtes, métriques, supervision). Zero
 * Trust : exige un token authentifié. Les canaux APPLICATIFS (chat, présence…)
 * restent libres par défaut — une app publique garde ses canaux publics.
 *
 * ⚠️ Couplage ASSUMÉ : security connaît les namespaces système de la plateforme
 * (c'est son rôle de définir la politique). Liste extensible (config) si besoin.
 * Convention transverse Nodefony : `<module>:health` / `<module>:stats`.
 */
const PROTECTED_CHANNEL_PREFIXES = [
  "syslog:", // logs serveur (syslog:stream) — fuite directe d'infos sensibles
  "orm:", // santé / flux / requêtes ORM (orm:health, orm:flow, orm:vacuum, orm:rich@pid)
  "node:", // métriques process (node:stream)
  "dashboard:", // supervision cluster (dashboard:stats, dashboard:supervision@pid)
  "debugbar:", // debug bar (debugbar:stats)
  "realtime:", // sonde socket (realtime:health)
  "cluster:", // sonde cluster
] as const;

/** Le canal expose-t-il de l'observabilité serveur (→ auth requise) ? */
function isProtectedChannel(channel: string): boolean {
  for (let i = 0; i < PROTECTED_CHANNEL_PREFIXES.length; i++) {
    if (channel.startsWith(PROTECTED_CHANNEL_PREFIXES[i]!)) return true;
  }
  // Convention <module>:health / <module>:stats (namespaces hors liste ci-dessus).
  return channel.includes(":health") || channel.includes(":stats");
}

/** Verrou `api.request {path}` — invariant : ne donne jamais plus que `GET {path}`. */
function authorizeApiRequest(
  zones: IZoneMatcher,
  params: unknown,
  token: IRealtimeToken,
): boolean {
  const path = (params as { path?: unknown } | undefined)?.path;
  // params invalides → laisser passer : le handler `api.request` renverra -32602
  // (on ne duplique pas sa validation ; le verrou ne décide QUE l'autorisation).
  if (typeof path !== "string") return true;
  const qi = path.indexOf("?");
  const pathname = qi === -1 ? path : path.slice(0, qi);
  // Source UNIQUE de zone, partagée avec `isSecure` HTTP (matchPath). Le host
  // n'est pas porté par la frame → match host-agnostique (la seule zone realtime
  // data plane n'a pas de vhost ; réserve J3b pour une zone realtime host-scopée).
  const area = zones.matchPath(pathname);
  if (area && area.security && !token.isAuthenticated()) return false;
  return true;
}

/** Verrou `subscribe {channel}` — canaux d'observabilité → authentifié requis. */
function authorizeSubscribe(params: unknown, token: IRealtimeToken): boolean {
  const channel = (params as { channel?: unknown } | undefined)?.channel;
  // params invalides → laisser passer : `startChannel` ignore un canal absent.
  if (typeof channel !== "string") return true;
  if (isProtectedChannel(channel) && !token.isAuthenticated()) return false;
  return true;
}

/**
 * Construit le verrou de frame WS branché sur le hub realtime par le firewall au
 * boot (`RealtimeService.setFrameAuthorizer`). SYNC, 0 lecture base : lit le
 * token déjà résolu au handshake et matche la cible de la frame contre la zone.
 *
 * Deux trous fermés (audit socket J3b) :
 *  - `api.request {path}` (pont API souverain) ne contourne plus le firewall :
 *    re-match de zone HTTP via `matchPath` → zone protégée + anonyme = refus.
 *  - `subscribe {channel}` aux canaux d'introspection (`syslog:stream`…) exige
 *    une connexion authentifiée.
 *
 * Toute autre frame (`ping`, `unsubscribe`, canaux full-duplex déjà gatés par
 * déclaration explicite côté controller) passe — le verrou cible les 2 surfaces
 * qui peuvent atteindre le data plane / l'observabilité.
 *
 * @param zones - matcher de zone (le `Firewall`).
 * @returns un {@link FrameAuthorizer} sync (`true` = frame autorisée).
 */
export function buildFrameAuthorizer(zones: IZoneMatcher): FrameAuthorizer {
  return (frame: unknown, token: IRealtimeToken): boolean => {
    const method = (frame as { method?: unknown } | undefined)?.method;
    if (method === "api.request") {
      return authorizeApiRequest(
        zones,
        (frame as { params?: unknown }).params,
        token,
      );
    }
    if (method === "subscribe") {
      return authorizeSubscribe((frame as { params?: unknown }).params, token);
    }
    return true;
  };
}

export default buildFrameAuthorizer;
