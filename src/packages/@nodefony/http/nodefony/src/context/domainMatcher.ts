/**
 * Matching de domaine (`Host`) — fonctions PURES, politique UNIQUE partagée par
 * les deux étages de Nodefony :
 *
 * - **`trustedHosts` (kernel, sécu)** : barrière testée AVANT le routing. Quels
 *   `Host` ce serveur accepte de traiter (anti Host-header injection). Host non
 *   trusté → 401 (`HttpKernel.checkValidDomain`). Grossier, optionnel (en prod,
 *   typiquement délégué au reverse-proxy via `trustedHosts: true`).
 * - **`@Domain` (route, routing)** : restreint une route / un contrôleur à un
 *   vhost. Source de vérité du « qui sert quoi ». Testé PENDANT le routing
 *   (`Route.matchHostname`) → 403 si la route ne sert pas ce domaine.
 *
 * Politique de compilation (sûre, ancrée, ReDoS-free) :
 * - string sans `*` → match EXACT ancré (`^...$`, le `.` est littéral).
 * - string avec `*` → wildcard UN label (`*.example.com` → `^[^.]+\.example\.com$`,
 *   RFC 6125 TLS-wildcard : matche `img.example.com`, pas `a.b.example.com` ni `example.com`).
 * - `RegExp` → reprise telle quelle (l'auteur assume l'ancrage).
 *
 * Compilation faite UNE fois (boot / enregistrement de route) ; le test par
 * requête est un simple `RegExp.test` sur une liste pré-compilée (zéro alloc hot-path).
 */

import { escapeRegExp } from "nodefony";

/** Un pattern de domaine : string (exact ou `*`-wildcard) ou `RegExp` (libre). */
export type DomainPattern = string | RegExp;

/**
 * Valeur de configuration `http.trustedHosts` (barrière sécu avant routing) :
 * - `false` / absent : défaut (domaine canonique + loopback en dev).
 * - `true` : bypass total — tout `Host` passe (déploiement où un reverse-proxy
 *   filtre déjà le `Host`, cf doctrine cloud-native).
 * - `string` / `string[]` : patterns additionnels (exact ou `*`-wildcard).
 */
export type TrustedHostsConfig = boolean | DomainPattern | DomainPattern[];

// Loopback ajouté au défaut en development (les 3 formes que `url.hostname`
// produit : Node sérialise toute IPv6 loopback en `[::1]` canonique — WHATWG URL).
const DEV_LOOPBACK: readonly string[] = ["localhost", "127.0.0.1", "[::1]"];

/**
 * Compile UN pattern de domaine en `RegExp` selon la politique sûre.
 *
 * @param pattern - string (exact / `*`-wildcard) ou `RegExp` (reprise telle quelle).
 * @returns une `RegExp` ancrée (pour les string) ou le `RegExp` fourni.
 */
export function compileDomainPattern(pattern: DomainPattern): RegExp {
  if (pattern instanceof RegExp) {
    return pattern;
  }
  // Split sur `*` AVANT d'échapper → le wildcard n'est pas échappé ; chaque
  // segment littéral l'est ; `*` devient `[^.]+` (un label DNS).
  const body = pattern.split("*").map(escapeRegExp).join("[^.]+");
  return new RegExp(`^${body}$`, "u");
}

/**
 * Compile une liste de patterns. Les string vides sont ignorées (un `^$` ne
 * sert à rien et masque une coquille de config).
 *
 * @param patterns - un pattern ou un tableau de patterns.
 * @returns liste de `RegExp` à tester contre le `Host` entrant.
 */
export function compileDomainPatterns(
  patterns: DomainPattern | DomainPattern[],
): RegExp[] {
  const list = Array.isArray(patterns) ? patterns : [patterns];
  const out: RegExp[] = [];
  for (const p of list) {
    if (p instanceof RegExp) {
      out.push(p);
    } else if (typeof p === "string" && p) {
      out.push(compileDomainPattern(p));
    }
  }
  return out;
}

/**
 * Construit la liste `RegExp` de la barrière `trustedHosts` (kernel, avant routing).
 *
 * Toujours : le domaine canonique (`kernel.domain`). En development : + loopback
 * (`localhost`/`127.0.0.1`/`[::1]`) pour que l'URL tapée (nom OU IP) passe.
 * `trustedHosts: true` → bypass total (un seul `/^.*$/`).
 *
 * @param domain - domaine canonique du serveur (`kernel.domain`).
 * @param trusted - config `http.trustedHosts` (optionnelle).
 * @param isDev - vrai en environnement `development` (ajoute le loopback).
 * @returns liste de `RegExp` pour {@link isDomainAllowed}.
 */
export function compileTrustedHosts(
  domain: string,
  trusted: TrustedHostsConfig | undefined,
  isDev: boolean,
): RegExp[] {
  if (trusted === true) {
    return [/^.*$/u]; // bypass — Host filtré en amont par le reverse-proxy
  }
  const patterns: DomainPattern[] = [domain];
  if (isDev) {
    patterns.push(...DEV_LOOPBACK);
  }
  if (trusted) {
    if (Array.isArray(trusted)) {
      patterns.push(...trusted);
    } else {
      patterns.push(trusted);
    }
  }
  return compileDomainPatterns(patterns);
}

/**
 * Teste un `Host` entrant contre une liste de `RegExp` pré-compilée.
 *
 * @param regAlias - sortie de {@link compileTrustedHosts} ou {@link compileDomainPatterns}.
 * @param domain - `Host` de la requête (`context.domain`, port déjà strippé).
 * @returns `true` dès le premier match (court-circuit), `false` sinon.
 */
export function isDomainAllowed(regAlias: RegExp[], domain: string): boolean {
  for (const reg of regAlias) {
    if (reg.test(domain)) {
      return true;
    }
  }
  return false;
}
