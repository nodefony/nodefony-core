import {
  NODEFONY_CHANNEL_NAMESPACE,
  PLATFORM_CHANNELS,
  startsWithCI,
} from "nodefony";
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
 * Rapporteur de refus de frame (journal d'audit P6.14) — invoqué UNIQUEMENT
 * quand le verrou refuse une frame (cold-path : frames refusées rares). Le
 * chemin autorisé (`return true`) ne l'appelle JAMAIS → 0 allocation sur le
 * hot-path WS. Le firewall fournit l'implémentation (closure sur son container) ;
 * absent par défaut (verrou pur, testable sans audit).
 *
 * @param surface - cible refusée : pont API souverain (`api.request`) ou canal
 *   (subscribe/inbound).
 * @param target  - pathname (api.request) ou nom de canal refusé.
 * @param reason  - raison machine stable (`zone_protected` | `channel_policy`).
 * @param token   - jeton WS de l'acteur (lu pour `getUserIdentifier()`).
 */
export type FrameDenyReporter = (
  surface: "api.request" | "channel",
  target: string,
  reason: string,
  token: IRealtimeToken,
) => void;

/**
 * Politique système par défaut des canaux d'**introspection serveur** : réservés
 * aux administrateurs. DURCISSEMENT Zero Trust (P6) : avant, « authentifié
 * suffisait » (tout `ROLE_USER` lisait `nodefony:syslog`) ; désormais `ROLE_ADMIN`.
 * Surchargeable finement par `realtimeChannels` (ex. `ROLE_SECURITY_AUDITOR`).
 */
export const SYSTEM_CHANNEL_POLICY: IChannelPolicy = {
  authenticated: true,
  roles: ["ROLE_ADMIN"],
};

/**
 * Namespace d'introspection serveur (observabilité) — s'y abonner expose l'état
 * interne du pod : journaux (`nodefony:syslog`), base (`nodefony:orm:*`), métriques
 * et supervision (`nodefony:dashboard`, `nodefony:supervision@<pid>`), sonde de la
 * socket (`nodefony:socket`), contrôle du pod (`nodefony:kernel:gc` force un GC
 * bloquant). Liste extensible via la config. Convention transverse Nodefony :
 * `<module>:health` / `<module>:stats` (gérée à part dans {@link matchSystemPolicy}).
 *
 * ⚠️ Couplage ASSUMÉ : security connaît le namespace système de la plateforme
 * (c'est son rôle de définir la politique) — mais il ne le REDÉCLARE pas : la
 * constante vient du cœur, comme côté hub.
 */
export const DEFAULT_SYSTEM_PREFIXES = [NODEFONY_CHANNEL_NAMESPACE] as const;

/**
 * Plancher des canaux de **sécurité** (`nodefony:audit`, P6.14 lot 4) : réservé au
 * super-admin Nodefony (`ROLE_NODEFONY_ADMIN`) — un cran AU-DESSUS du plancher
 * d'observabilité générique (`ROLE_ADMIN`). Le journal d'audit du pod ne se lit
 * pas avec un simple rôle admin applicatif. Cohérent avec le data plane HTTP de
 * l'audit (`SecurityAdminApi`, lot 3, même rôle).
 *
 * Multi-tenant (futur) : `nodefony:audit` reste un canal **plateforme** (pod),
 * jamais exposé à un user tenant ; l'événement portera le `tenantId` (via l'ALS)
 * pour permettre un filtrage par tenant quand le chantier multi-tenant arrivera.
 */
export const SECURITY_CHANNEL_POLICY: IChannelPolicy = {
  authenticated: true,
  roles: ["ROLE_NODEFONY_ADMIN"],
};

/**
 * F2 (revue 0.6) — PLANCHER IRRÉDUCTIBLE du namespace réservé plateforme. Il
 * couvre tout ce qui expose l'état interne du pod (logs, audit, métriques,
 * requêtes, supervision) : une règle de config `realtimeChannels` (placée AVANT
 * les défauts, 1ᵉʳ match gagne) pourrait sinon l'OUVRIR à l'anonyme
 * (`{ authenticated:false }` ou policy vide). Le plancher garantit qu'un canal de
 * ce namespace exige TOUJOURS au moins `authenticated` — la config peut RESSERRER
 * (rôle/scope) ou re-cibler le rôle, jamais DESCENDRE sous authenticated. Le canal
 * d'audit en fait partie (son défaut ROLE_NODEFONY_ADMIN est déjà au-dessus, mais
 * le plancher le blinde contre une surcharge de config). Défense structurelle,
 * fail-closed (cf F1 fail-loud).
 */
export const RESERVED_FLOOR_PREFIXES = DEFAULT_SYSTEM_PREFIXES;

/**
 * Règles système par défaut. Le canal d'audit est placé EN TÊTE (1ᵉʳ match gagne)
 * avec son plancher super-admin propre ; le reste du namespace plateforme hérite de
 * {@link SYSTEM_CHANNEL_POLICY}. Le firewall y préfixe les règles issues de la
 * config (qui gagnent par ordre).
 */
export const DEFAULT_SYSTEM_RULES: readonly ISystemChannelRule[] =
  buildSystemRules(RESERVED_FLOOR_PREFIXES);

/**
 * Construit les règles système à partir d'une liste de namespaces réservés.
 *
 * Sépare la LISTE (quels namespaces sont réservés — propriété du hub realtime,
 * qui sert ces canaux) de la POLITIQUE (quels droits — propriété de la sécurité).
 * Le firewall appelle donc cette fabrique avec la liste que le hub lui donne, et
 * ne redéclare rien : un namespace ajouté côté realtime hérite automatiquement
 * d'une politique, au lieu de rester ouvert sans que personne ne le remarque.
 *
 * Le canal d'audit est placé EN TÊTE (premier match gagnant) : son plancher est
 * plus haut que celui du reste de l'observabilité. Il n'est pas un namespace mais
 * un canal précis — sa règle n'est donc posée que si la liste reçue le COUVRE : si
 * le hub cessait un jour de réserver ce territoire, la sécurité cesserait avec lui
 * de prétendre l'arbitrer, au lieu de garder une règle orpheline.
 *
 * @param prefixes - namespaces réservés (ordre indifférent).
 * @returns les règles, canal d'audit d'abord.
 */
export function buildSystemRules(
  prefixes: readonly string[],
): readonly ISystemChannelRule[] {
  const rules: ISystemChannelRule[] = [];
  const audit = PLATFORM_CHANNELS.audit;
  if (prefixes.some((prefix) => startsWithCI(audit, prefix))) {
    rules.push({ prefix: audit, policy: SECURITY_CHANNEL_POLICY });
  }
  for (const prefix of prefixes) {
    rules.push({ prefix, policy: SYSTEM_CHANNEL_POLICY });
  }
  return rules;
}

/**
 * `s` contient-il `needle`, insensible à la casse et sans allocation ? Pour les
 * conventions transverses `:health`/`:stats` (après le namespace de module —
 * `mymod:health` — éventuellement suffixées d'une cadence `nodefony:orm:health:5000`).
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
    if (startsWithCI(channel, rules[i]!.prefix)) {
      return floorReserved(channel, rules[i]!.policy);
    }
  }
  if (containsCI(channel, ":health") || containsCI(channel, ":stats")) {
    return SYSTEM_CHANNEL_POLICY;
  }
  return null;
}

/**
 * F2 (revue 0.6) — applique le PLANCHER irréductible : si `channel` est dans un
 * namespace réservé plateforme ({@link RESERVED_FLOOR_PREFIXES}), l'autorisation
 * effective exige AU MOINS `authenticated`, même si la `policy` (issue d'une règle
 * de config) tente de l'ouvrir. Basé sur le namespace du CANAL, PAS sur le prefixe
 * de la règle qui a matché → pas de contournement via un prefixe de config plus
 * court/altéré (`{ prefix:"sec", authenticated:false }` sur `nodefony:audit`).
 * `policy.authenticated` déjà vrai (cas nominal, défauts + `:health`) → retour tel
 * quel, 0 allocation. N'alloue que sur une config qui tente de DESSERRER un
 * namespace réservé (cold path de misconfiguration).
 */
function floorReserved(
  channel: string,
  policy: IChannelPolicy,
): IChannelPolicy {
  if (policy.authenticated) return policy;
  for (let i = 0; i < RESERVED_FLOOR_PREFIXES.length; i++) {
    if (startsWithCI(channel, RESERVED_FLOOR_PREFIXES[i]!)) {
      return { ...policy, authenticated: true };
    }
  }
  return policy;
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

/**
 * Verrou `api.request {path}` — vérifie l'autorisation de ZONE du pathname (le
 * MÊME re-match de zone qu'un `GET {path}` ; ne regarde PAS la méthode logique).
 * Une zone protégée + un token anonyme = refus. Les mutations (POST/PUT/PATCH/
 * DELETE) restent possibles via le pont MAIS seulement si la route déclare le
 * transport WEBSOCKET + `methodOverride` (une route REST HTTP-only = 405,
 * inatteignable), et sont gardées EN PLUS par `@IsGranted` + clé d'idempotence au
 * data plane. Le verrou n'accorde donc que le plancher de ZONE, pas l'action.
 */
function authorizeApiRequest(
  firewall: IFrameAuthorizerFirewall,
  params: unknown,
  token: IRealtimeToken,
  onDeny?: FrameDenyReporter,
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
  if (area && area.security && !token.isAuthenticated()) {
    // Refus audité (cold-path) : `pathname` déjà calculé → 0 surcoût.
    onDeny?.("api.request", pathname, "zone_protected", token);
    return false;
  }
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
  onDeny?: FrameDenyReporter,
): boolean {
  // 1. Système = plancher non contournable (le métier ne peut pas l'affaiblir).
  const sys = matchSystemPolicy(channel, systemRules);
  // 2. Métier (décorateur) seulement hors namespace système.
  const policy = sys ?? resolver?.resolveChannelPolicy?.(channel) ?? null;
  if (policy === null) return true; // canal applicatif libre (public)
  if (satisfies(policy, token, firewall)) return true;
  onDeny?.("channel", channel, "channel_policy", token); // refus audité (cold)
  return false;
}

/**
 * Construit le verrou de frame WS branché sur le hub realtime par le firewall au
 * boot (`RealtimeService.setFrameAuthorizer`). SYNC, 0 lecture base : lit le
 * token déjà résolu au handshake et matche la cible de la frame contre la zone
 * (api.request) ou la politique du canal (subscribe/inbound).
 *
 * Trois surfaces gardées :
 *  - `api.request {path}` (pont API souverain) : re-match de zone HTTP → zone
 *    protégée + anonyme = refus (autorisation de ZONE, identique à `GET {path}` ;
 *    la méthode/action est gardée en aval par le router + `@IsGranted`).
 *  - `subscribe {channel}` : politique de canal (système plancher + déclaration
 *    métier `@RealtimeChannel` → rôles/scopes).
 *  - inbound (`method` = canal full-duplex déclaré avec policy) : même politique
 *    que `subscribe` — un client ne pousse pas sur un canal protégé sans droit.
 *
 * Toute autre frame (`ping`, `unsubscribe`, action explicitement ouverte) passe — le verrou
 * cible les surfaces qui atteignent le data plane / l'observabilité / un canal
 * protégé.
 *
 * @param firewall    - matcher de zone + checker de rôle (le `Firewall`).
 * @param options     - `channelResolver` (politiques métier déclarées, via le
 *                      service realtime) + `systemRules` (défauts + config) +
 *                      `onDeny` (rapporteur d'audit, invoqué sur refus seulement).
 * @returns un {@link FrameAuthorizer} sync (`true` = frame autorisée).
 */
export function buildFrameAuthorizer(
  firewall: IFrameAuthorizerFirewall,
  options?: {
    readonly channelResolver?: IChannelPolicyResolver | null;
    readonly systemRules?: readonly ISystemChannelRule[];
    readonly onDeny?: FrameDenyReporter;
  },
): FrameAuthorizer {
  const resolver = options?.channelResolver ?? null;
  const systemRules = options?.systemRules ?? DEFAULT_SYSTEM_RULES;
  const onDeny = options?.onDeny;
  return (frame: unknown, token: IRealtimeToken): boolean => {
    const f = frame as { method?: unknown; params?: unknown } | undefined;
    const method = f?.method;
    if (method === "api.request") {
      return authorizeApiRequest(firewall, f!.params, token, onDeny);
    }
    if (method === "subscribe") {
      const channel = (f!.params as { channel?: unknown } | undefined)?.channel;
      // params invalides → laisser passer : `startChannel` ignore un canal absent.
      if (typeof channel !== "string") return true;
      return authorizeChannel(
        channel,
        token,
        firewall,
        resolver,
        systemRules,
        onDeny,
      );
    }
    // Inbound full-duplex : `method` = nom du canal entrant. Gardé UNIQUEMENT si
    // une politique le couvre (système OU déclarée) — sinon (ping/unsubscribe/
    // action libre) bypass. Pas de coût pour les méthodes non policées : un
    // `resolveChannelPolicy` sur un registre vide est O(1) `null`.
    if (typeof method === "string") {
      return authorizeChannel(
        method,
        token,
        firewall,
        resolver,
        systemRules,
        onDeny,
      );
    }
    return true;
  };
}

export default buildFrameAuthorizer;
