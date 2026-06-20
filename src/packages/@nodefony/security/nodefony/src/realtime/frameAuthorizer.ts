import type {
  FrameAuthorizer,
  IChannelPolicy,
  IRealtimeToken,
} from "./realtimeContracts";

/**
 * Surface MINIMALE du firewall consommée par le verrou de frame : matcher une
 * zone par pathname ET vérifier un rôle (hiérarchie comprise). `Firewall` la
 * satisfait structurellement (`matchPath` + `hasRole` délégué au
 * `RoleHierarchyWalker`) — typage local pour éviter un cycle d'import
 * `firewall.ts` ↔ `frameAuthorizer.ts`.
 */
export interface IFrameAuthorizerFirewall {
  matchPath(
    pathname: string,
    host?: string,
  ): { readonly security: boolean } | null;
  /** `true` si l'un des rôles de l'utilisateur couvre `required` (via hiérarchie). */
  hasRole(userRoles: readonly string[], required: string): boolean;
}

/**
 * Source des politiques de canal DÉCLARÉES côté métier (`@RealtimeChannel`) —
 * miroir partiel du `realtimeService`. `resolveChannelPolicy` est optionnel : un
 * hub d'une version antérieure ne l'expose pas (traité comme « pas de politique
 * métier »).
 */
export interface IChannelPolicyResolver {
  resolveChannelPolicy?(channel: string): IChannelPolicy | null;
}

/**
 * Règle de canal **système** (plateforme) — un préfixe de namespace réservé et
 * la politique qui s'y applique. Plancher NON contournable par une déclaration
 * métier (un controller user ne doit pas exposer `syslog:`). Surchargeable par
 * la config (`defineSecurityConfig().realtimeChannels`).
 */
export interface ISystemChannelRule {
  readonly prefix: string;
  readonly policy: IChannelPolicy;
}

/**
 * Politique système par défaut des canaux d'**introspection serveur** : réservés
 * aux administrateurs. DURCISSEMENT Zero Trust (P6) : avant, « authentifié
 * suffisait » (tout `ROLE_USER` lisait `syslog:stream`) ; désormais `ROLE_ADMIN`.
 * Surchargeable finement par `realtimeChannels` (ex. `ROLE_SECURITY_AUDITOR`).
 */
export const SYSTEM_CHANNEL_POLICY: IChannelPolicy = {
  roles: ["ROLE_ADMIN"],
};

/**
 * Namespaces d'introspection serveur (observabilité) — s'y abonner expose l'état
 * interne du pod (logs, requêtes, métriques, supervision). Liste extensible via
 * la config. Convention transverse Nodefony : `<module>:health` / `<module>:stats`
 * (gérée à part dans {@link matchSystemPolicy}).
 *
 * ⚠️ Couplage ASSUMÉ : security connaît les namespaces système de la plateforme
 * (c'est son rôle de définir la politique).
 */
export const DEFAULT_SYSTEM_PREFIXES = [
  "syslog:", // logs serveur (syslog:stream) — fuite directe d'infos sensibles
  "orm:", // santé / flux / requêtes ORM (orm:health, orm:flow, orm:vacuum)
  "node:", // métriques process (node:stream)
  "dashboard:", // supervision cluster (dashboard:stats, dashboard:supervision@pid)
  "debugbar:", // debug bar (debugbar:stats)
  "realtime:", // sonde socket (realtime:health)
  "cluster:", // sonde cluster
] as const;

/**
 * Règles système par défaut : chaque namespace réservé → {@link SYSTEM_CHANNEL_POLICY}.
 * Le firewall y préfixe les règles issues de la config (qui gagnent par ordre).
 */
export const DEFAULT_SYSTEM_RULES: readonly ISystemChannelRule[] =
  DEFAULT_SYSTEM_PREFIXES.map((prefix) => ({
    prefix,
    policy: SYSTEM_CHANNEL_POLICY,
  }));

/**
 * `s` commence-t-il par `prefix`, comparaison INSENSIBLE À LA CASSE (ASCII) et
 * SANS allocation ? Un plancher de namespace réservé ne doit JAMAIS être
 * contournable en changeant la casse (`SYSLOG:stream` vs `syslog:stream`) :
 * sinon un client échappe à la politique ROLE_ADMIN par un simple `toUpperCase`
 * (defense-in-depth Zero Trust). 0 `toLowerCase()` : appelé sur le chemin
 * subscribe/inbound → on respecte la règle perf (pas d'alloc hot-path).
 */
function startsWithCI(s: string, prefix: string): boolean {
  if (s.length < prefix.length) return false;
  for (let i = 0; i < prefix.length; i++) {
    let a = s.charCodeAt(i);
    if (a >= 65 && a <= 90) a += 32; // A-Z → a-z
    let b = prefix.charCodeAt(i);
    if (b >= 65 && b <= 90) b += 32;
    if (a !== b) return false;
  }
  return true;
}

/**
 * `s` contient-il `needle`, insensible à la casse et sans allocation ? Pour les
 * conventions transverses `:health`/`:stats` (après le namespace de module —
 * `mymod:health` — éventuellement suffixées d'une cadence `orm:health:5000`).
 */
function containsCI(s: string, needle: string): boolean {
  const last = s.length - needle.length;
  for (let i = 0; i <= last; i++) {
    let ok = true;
    for (let j = 0; j < needle.length; j++) {
      let a = s.charCodeAt(i + j);
      if (a >= 65 && a <= 90) a += 32;
      let b = needle.charCodeAt(j);
      if (b >= 65 && b <= 90) b += 32;
      if (a !== b) {
        ok = false;
        break;
      }
    }
    if (ok) return true;
  }
  return false;
}

/**
 * Politique système applicable à un canal, ou `null` si le canal n'est pas
 * réservé. Premier préfixe qui matche gagne (la config est placée AVANT les
 * défauts par le firewall → elle peut surcharger). Les conventions transverses
 * `:health`/`:stats` retombent sur la politique système par défaut. Le match est
 * INSENSIBLE À LA CASSE (cf {@link startsWithCI}) : le plancher ne se contourne
 * pas en altérant la casse du namespace.
 */
function matchSystemPolicy(
  channel: string,
  rules: readonly ISystemChannelRule[],
): IChannelPolicy | null {
  for (let i = 0; i < rules.length; i++) {
    if (startsWithCI(channel, rules[i]!.prefix)) return rules[i]!.policy;
  }
  if (containsCI(channel, ":health") || containsCI(channel, ":stats")) {
    return SYSTEM_CHANNEL_POLICY;
  }
  return null;
}

/**
 * Le token satisfait-il la politique ? Contraintes cumulatives (ET) ; un champ
 * absent = pas de contrainte sur cet axe. SYNC, 0 lecture base (lit le token déjà
 * résolu au handshake).
 *  - `authenticated` : token non anonyme.
 *  - `roles` : l'un des rôles requis, hiérarchie comprise (un anonyme `[]` échoue).
 *  - `scopes` : l'un des scopes requis (session BFF n'en porte pas → refus).
 */
function satisfies(
  policy: IChannelPolicy,
  token: IRealtimeToken,
  firewall: IFrameAuthorizerFirewall,
): boolean {
  if (policy.authenticated && !token.isAuthenticated()) return false;
  if (policy.roles && policy.roles.length > 0) {
    const userRoles = token.getRoles();
    let granted = false;
    for (let i = 0; i < policy.roles.length; i++) {
      if (firewall.hasRole(userRoles, policy.roles[i]!)) {
        granted = true;
        break;
      }
    }
    if (!granted) return false;
  }
  if (policy.scopes && policy.scopes.length > 0) {
    const userScopes = token.getScopes();
    let granted = false;
    for (let i = 0; i < policy.scopes.length; i++) {
      if (userScopes.includes(policy.scopes[i]!)) {
        granted = true;
        break;
      }
    }
    if (!granted) return false;
  }
  return true;
}

/** Verrou `api.request {path}` — invariant : ne donne jamais plus que `GET {path}`. */
function authorizeApiRequest(
  firewall: IFrameAuthorizerFirewall,
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
  const area = firewall.matchPath(pathname);
  if (area && area.security && !token.isAuthenticated()) return false;
  return true;
}

/**
 * Verrou `subscribe {channel}` (et canaux inbound full-duplex) — applique la
 * politique du canal. PLANCHER système prioritaire (namespace réservé) ; sinon
 * politique métier déclarée (`@RealtimeChannel`) ; sinon canal libre.
 */
function authorizeChannel(
  channel: string,
  token: IRealtimeToken,
  firewall: IFrameAuthorizerFirewall,
  resolver: IChannelPolicyResolver | null,
  systemRules: readonly ISystemChannelRule[],
): boolean {
  // 1. Système = plancher non contournable (le métier ne peut pas l'affaiblir).
  const sys = matchSystemPolicy(channel, systemRules);
  // 2. Métier (décorateur) seulement hors namespace système.
  const policy = sys ?? resolver?.resolveChannelPolicy?.(channel) ?? null;
  if (policy === null) return true; // canal applicatif libre (public)
  return satisfies(policy, token, firewall);
}

/**
 * Construit le verrou de frame WS branché sur le hub realtime par le firewall au
 * boot (`RealtimeService.setFrameAuthorizer`). SYNC, 0 lecture base : lit le
 * token déjà résolu au handshake et matche la cible de la frame contre la zone
 * (api.request) ou la politique du canal (subscribe/inbound).
 *
 * Trois surfaces gardées :
 *  - `api.request {path}` (pont API souverain) : re-match de zone HTTP → zone
 *    protégée + anonyme = refus (invariant `api.request ≤ GET`).
 *  - `subscribe {channel}` : politique de canal (système plancher + déclaration
 *    métier `@RealtimeChannel` → rôles/scopes).
 *  - inbound (`method` = canal full-duplex déclaré avec policy) : même politique
 *    que `subscribe` — un client ne pousse pas sur un canal protégé sans droit.
 *
 * Toute autre frame (`ping`, `unsubscribe`, action RPC libre) passe — le verrou
 * cible les surfaces qui atteignent le data plane / l'observabilité / un canal
 * protégé.
 *
 * @param firewall    - matcher de zone + checker de rôle (le `Firewall`).
 * @param options     - `channelResolver` (politiques métier déclarées, via le
 *                      service realtime) + `systemRules` (défauts + config).
 * @returns un {@link FrameAuthorizer} sync (`true` = frame autorisée).
 */
export function buildFrameAuthorizer(
  firewall: IFrameAuthorizerFirewall,
  options?: {
    readonly channelResolver?: IChannelPolicyResolver | null;
    readonly systemRules?: readonly ISystemChannelRule[];
  },
): FrameAuthorizer {
  const resolver = options?.channelResolver ?? null;
  const systemRules = options?.systemRules ?? DEFAULT_SYSTEM_RULES;
  return (frame: unknown, token: IRealtimeToken): boolean => {
    const f = frame as { method?: unknown; params?: unknown } | undefined;
    const method = f?.method;
    if (method === "api.request") {
      return authorizeApiRequest(firewall, f!.params, token);
    }
    if (method === "subscribe") {
      const channel = (f!.params as { channel?: unknown } | undefined)?.channel;
      // params invalides → laisser passer : `startChannel` ignore un canal absent.
      if (typeof channel !== "string") return true;
      return authorizeChannel(channel, token, firewall, resolver, systemRules);
    }
    // Inbound full-duplex : `method` = nom du canal entrant. Gardé UNIQUEMENT si
    // une politique le couvre (système OU déclarée) — sinon (ping/unsubscribe/
    // action libre) bypass. Pas de coût pour les méthodes non policées : un
    // `resolveChannelPolicy` sur un registre vide est O(1) `null`.
    if (typeof method === "string") {
      return authorizeChannel(method, token, firewall, resolver, systemRules);
    }
    return true;
  };
}

export default buildFrameAuthorizer;
