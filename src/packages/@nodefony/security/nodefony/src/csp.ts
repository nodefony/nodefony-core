/**
 * Fusion de directives Content-Security-Policy — logique PURE (aucune dépendance
 * à Vite, au frontend ni au transport). Permet à un module de DÉCLARER ses besoins
 * CSP (ex. `@nodefony/frontend` en dev : origines Vite + `'unsafe-eval'` pour le
 * Fast Refresh) sans que `@nodefony/security` connaisse leur sémantique : security
 * se contente de MERGER des fragments génériques `directive → sources`.
 *
 * Pourquoi un merge structuré (et pas une simple concaténation) : en CSP une
 * directive RÉPÉTÉE est ignorée après sa 1ʳᵉ occurrence (W3C CSP3 §3) → concaténer
 * deux `script-src` perdrait le second. Il faut fusionner les sources dans UNE
 * directive. Le token `'nonce-{{nonce}}'` est opaque (ni `;` ni espace) → préservé
 * tel quel par parse/serialize.
 */

import { BootConfigurationError } from "nodefony";

/** Fragment additif d'un module : directive CSP → sources à ajouter. */
export type CspFragment = Record<string, readonly string[]>;

// Grammaire W3C CSP Level 3 §2.2 (`serialized-directive`) :
//   directive-name  = 1*( ALPHA / DIGIT / "-" )
//   directive-value = *( required-ascii-whitespace / ( %x21-%x2B / %x2D-%x3A / %x3C-%x7E ) )
// Une SOURCE est un jeton de `directive-value` : ni espace, ni `,` (%x2C, sépare
// deux POLITIQUES dans un même en-tête), ni `;` (%x3B, sépare deux directives),
// ni caractère de contrôle (CR/LF). Classe de caractères fixe : pas de ReDoS.
const DIRECTIVE_NAME = /^[A-Za-z0-9-]+$/;
const SOURCE_TOKEN = /^[\x21-\x2B\x2D-\x3A\x3C-\x7E]+$/;

// W3C CSP3 §2.3.1 : `scheme-source = scheme ":"`, `host-source = [ scheme "://" ]
// host [ port ] [ path ]`. Classes de caractères fixes, sans imbrication : pas de ReDoS.
const SCHEME_SOURCE = /^[A-Za-z][A-Za-z0-9+.-]*:$/;
const HOST_OF_SOURCE = /^(?:[A-Za-z][A-Za-z0-9+.-]*:\/\/)?([^/:]+)/;
// Schémas LOCAUX : la ressource naît dans le navigateur, aucune requête ne sort —
// les autoriser n'ouvre aucun canal d'exfiltration.
const LOCAL_SCHEMES: ReadonlySet<string> = new Set([
  "data:",
  "blob:",
  "filesystem:",
  "mediastream:",
]);

/**
 * Dit si une source CSP ouvre la directive à tout l'internet.
 *
 * Trop large : `*`, un schéma réseau nu (`https:`, `wss:`…), un hôte joker seul
 * (`https://*`, `*:443`). Restent acceptés : une origine exacte, un joker de
 * sous-domaine borné (`https://*.example.com`), un mot-clé (`'self'`) et les
 * schémas locaux (`blob:`, `data:`).
 *
 * @param source - un jeton de source CSP.
 * @returns `true` si la source autorise n'importe quel hôte.
 */
export function isOverbroadSource(source: string): boolean {
  if (source.startsWith("'")) return false;
  if (SCHEME_SOURCE.test(source)) {
    return !LOCAL_SCHEMES.has(source.toLowerCase());
  }
  return HOST_OF_SOURCE.exec(source)?.[1] === "*";
}

/**
 * Relève les sources trop larges d'un jeu de directives (cf {@link isOverbroadSource}).
 *
 * @param directives - paires `[directive, sources]` (`parseCsp(csp)` ou `Object.entries(fragment)`).
 * @returns les paires `[directive, source]` trop larges, dans l'ordre de lecture.
 */
export function findOverbroadSources(
  directives: Iterable<readonly [string, readonly string[]]>,
): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const [name, sources] of directives) {
    for (const source of sources) {
      if (isOverbroadSource(source)) out.push([name, source]);
    }
  }
  return out;
}

/**
 * Refuse un fragment CSP qui sortirait de la grammaire CSP3 — seule garde contre
 * l'injection de directives par une valeur de configuration.
 *
 * Sans elle, une source comme `https://a.example; frame-src *` ajoute une
 * directive que personne n'a demandée, et `https://a.example, frame-src *` coupe
 * l'en-tête en deux politiques. Appelée là où un fragment ENTRE (enregistrement
 * d'un module, fusion d'une route `@Csp`), jamais par requête.
 *
 * @param fragment - directives additionnelles (`directive → sources`).
 * @param origin - qui déclare le fragment, pour nommer la faute.
 * @throws BootConfigurationError si un nom ou une source sort de la grammaire.
 */
export function assertCspFragment(fragment: CspFragment, origin: string): void {
  for (const name in fragment) {
    if (!DIRECTIVE_NAME.test(name)) {
      throw new BootConfigurationError(
        `[@nodefony/security] CSP refusée (${origin}) — nom de directive invalide ${JSON.stringify(name)} : lettres, chiffres et « - » seulement (W3C CSP3 §2.2).`,
      );
    }
    for (const source of fragment[name] ?? []) {
      if (!SOURCE_TOKEN.test(source)) {
        throw new BootConfigurationError(
          `[@nodefony/security] CSP refusée (${origin}) — source invalide ${JSON.stringify(source)} dans « ${name} » : ni espace, ni « ; », ni « , », ni caractère de contrôle (W3C CSP3 §2.2). Une source = une origine ou un mot-clé ; déclarer plusieurs sources = plusieurs entrées du tableau.`,
        );
      }
    }
  }
}

/**
 * Parse une chaîne CSP en directives ordonnées `[nom, sources[]]`. L'ordre des
 * directives et des sources est préservé (déterminisme : header stable, tests
 * fiables). Les séparateurs multiples / espaces superflus sont normalisés.
 */
export function parseCsp(csp: string): Array<[string, string[]]> {
  const out: Array<[string, string[]]> = [];
  for (const part of csp.split(";")) {
    const [name, ...sources] = part.trim().split(/\s+/).filter(Boolean);
    if (name === undefined) continue;
    out.push([name, sources]);
  }
  return out;
}

/** Sérialise des directives ordonnées en chaîne CSP (`a b; c d`). */
export function serializeCsp(directives: Array<[string, string[]]>): string {
  return directives
    .map(([name, src]) => (src.length ? `${name} ${src.join(" ")}` : name))
    .join("; ");
}

/**
 * Fusionne un CSP de base avec des fragments additifs par module.
 *
 * - directive déjà dans la base → ses sources sont COMPLÉTÉES (dédupliquées,
 *   ordre base d'abord puis ajouts) ;
 * - directive absente → AJOUTÉE en fin (ordre d'apparition des fragments).
 *
 * Pur + déterministe : recalculé uniquement quand un module (dé)enregistre ses
 * origines (jamais par requête). Le résultat repart dans `SecurityHeaders`, qui
 * re-split autour de `{{nonce}}` au boot → 1 `join` par requête (hot-path inchangé).
 *
 * Chaque fragment passe {@link assertCspFragment} : une source hors grammaire
 * lève au lieu d'injecter une directive. Une source TROP LARGE
 * ({@link isOverbroadSource}) n'est pas fusionnée : un module ne déclare que SON
 * origine, et la politique de l'application ne s'ouvre pas à tout l'internet par
 * une contribution. Retirer plutôt que lever : la sécurité ne bloque pas le
 * démarrage. L'avertissement appartient à l'appelant, qui sait QUI contribue
 * (`Firewall.registerCspOrigins`). La base (config de l'application) n'est jamais
 * filtrée : c'est un choix explicite de son auteur.
 *
 * @param base - CSP de configuration (peut contenir `'nonce-{{nonce}}'`).
 * @param fragments - fragments additifs (un par module enregistré).
 * @returns la chaîne CSP fusionnée.
 * @throws BootConfigurationError si un fragment sort de la grammaire CSP3.
 */
export function mergeCspFragments(
  base: string,
  fragments: Iterable<CspFragment>,
): string {
  const directives = parseCsp(base);
  // Index nom → sources (référence partagée avec `directives` pour l'append).
  const index = new Map<string, string[]>();
  for (const [name, src] of directives) index.set(name, src);

  for (const fragment of fragments) {
    assertCspFragment(fragment, "fusion");
    for (const name in fragment) {
      const additions = fragment[name];
      if (additions === undefined || additions.length === 0) continue;
      let sources = index.get(name);
      for (const src of additions) {
        if (isOverbroadSource(src)) continue;
        // Directive créée au premier ajout RETENU : une directive sans source
        // vaut `'none'` (W3C CSP3 §2.3.1) — un fragment entièrement retiré ne
        // doit pas fermer la directive.
        if (sources === undefined) {
          sources = [];
          index.set(name, sources);
          directives.push([name, sources]);
        }
        if (!sources.includes(src)) sources.push(src);
      }
    }
  }
  return serializeCsp(directives);
}
