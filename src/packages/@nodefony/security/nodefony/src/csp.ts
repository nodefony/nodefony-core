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

// Directives qui décident de l'EXÉCUTION d'un script.
const SCRIPT_DIRECTIVES: ReadonlySet<string> = new Set([
  "script-src",
  "script-src-elem",
  "script-src-attr",
]);

/**
 * Dit si une source CSP ouvre la directive à n'importe quel contenu.
 *
 * Trop large : `*`, un schéma réseau nu (`https:`, `wss:`…), un hôte joker seul
 * (`https://*`, `*:443`). Restent acceptés : une origine exacte, un joker de
 * sous-domaine borné (`https://*.example.com`), un mot-clé (`'self'`) et les
 * schémas locaux (`blob:`, `data:`) — SAUF dans une directive de scripts :
 * `data:` y exécute le code porté par l'URL, `blob:` celui qu'un script a
 * fabriqué, et sans nonce c'est une injection de script.
 *
 * @param source - un jeton de source CSP.
 * @param directive - la directive qui porte la source ; sans elle, les schémas
 *   locaux sont acceptés.
 * @returns `true` si la source autorise n'importe quel hôte ou contenu.
 */
export function isOverbroadSource(source: string, directive?: string): boolean {
  if (source.startsWith("'")) return false;
  if (SCHEME_SOURCE.test(source)) {
    if (
      directive !== undefined &&
      SCRIPT_DIRECTIVES.has(directive.toLowerCase())
    ) {
      return true;
    }
    return !LOCAL_SCHEMES.has(source.toLowerCase());
  }
  return HOST_OF_SOURCE.exec(source)?.[1] === "*";
}

/**
 * Retire d'un fragment de MODULE ses sources trop larges (cf {@link isOverbroadSource}).
 *
 * Moindre privilège : une contribution GLOBALE (`Firewall.registerCspOrigins`)
 * ne déclare que SON origine, et n'ouvre pas la politique de toute l'application.
 * Retirer plutôt que lever : la sécurité ne bloque pas le démarrage. Ne
 * s'applique PAS à ce que l'application écrit elle-même (sa config, un `@Csp` de
 * route) : un choix délibéré de son auteur n'est jamais contourné en silence.
 *
 * @param fragment - directives déclarées par un module.
 * @returns le fragment sans les sources trop larges, et les paires retirées.
 */
export function withoutOverbroadSources(fragment: CspFragment): {
  fragment: CspFragment;
  dropped: Array<[string, string]>;
} {
  const dropped = findOverbroadSources(Object.entries(fragment));
  if (dropped.length === 0) return { fragment, dropped };
  const kept: Record<string, readonly string[]> = {};
  for (const name in fragment) {
    const sources = (fragment[name] ?? []).filter(
      (s) => !isOverbroadSource(s, name),
    );
    if (sources.length > 0) kept[name] = sources;
  }
  return { fragment: kept, dropped };
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
      if (isOverbroadSource(source, name)) out.push([name, source]);
    }
  }
  return out;
}

/**
 * Relève les sources de scripts d'un fragment que `'strict-dynamic'` rend inertes.
 *
 * Sous `'strict-dynamic'` dans `script-src`, un navigateur CSP3 ignore les hôtes
 * et les schémas : un script n'est admis que signé, ou chargé par un script
 * signé (W3C CSP3 § « strict-dynamic »). La source reste utile à un navigateur
 * CSP2 ; on la garde, mais son auteur doit savoir qu'elle n'ouvre rien.
 *
 * @param fragment - directives déclarées par un module.
 * @param policy - politique à laquelle le fragment s'ajoute.
 * @returns les paires `[directive, source]` inertes ; vide sans `'strict-dynamic'`.
 */
export function findInertScriptSources(
  fragment: CspFragment,
  policy: string,
): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  let strictDynamic: boolean | null = null;
  for (const name in fragment) {
    if (!SCRIPT_DIRECTIVES.has(name.toLowerCase())) continue;
    strictDynamic ??= parseCsp(policy).some(
      ([n, sources]) =>
        n.toLowerCase() === "script-src" &&
        sources.includes("'strict-dynamic'"),
    );
    if (!strictDynamic) return out;
    for (const source of fragment[name] ?? []) {
      if (!source.startsWith("'")) out.push([name, source]);
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
 * lève au lieu d'injecter une directive. Aucune source n'est retirée ici : le
 * filtre des sources trop larges ne vise que les contributions globales des
 * modules ({@link withoutOverbroadSources}, appliqué à l'enregistrement).
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
      if (!sources) {
        sources = [];
        index.set(name, sources);
        directives.push([name, sources]);
      }
      for (const src of additions) {
        if (!sources.includes(src)) sources.push(src);
      }
    }
  }
  return serializeCsp(directives);
}

/** Directive réservée aux réponses servies en TLS (ADR-0024 §C6). */
export const UPGRADE_INSECURE_REQUESTS = "upgrade-insecure-requests";

/**
 * Retire une directive d'une politique, sans toucher au reste.
 *
 * Sert à composer, au démarrage, la variante EN CLAIR d'une politique qui porte
 * `upgrade-insecure-requests` : sur une page servie en `http`, la directive
 * réécrirait chaque sous-ressource en `https`, que le serveur ne sert pas.
 *
 * @param csp - politique (peut contenir `'nonce-{{nonce}}'`).
 * @param name - nom de la directive, insensible à la casse.
 * @returns la politique sans la directive ; la MÊME chaîne si elle n'y est pas.
 */
export function withoutDirective(csp: string, name: string): string {
  const wanted = name.toLowerCase();
  const directives = parseCsp(csp);
  const kept = directives.filter(([n]) => n.toLowerCase() !== wanted);
  return kept.length === directives.length ? csp : serializeCsp(kept);
}

/**
 * Traduit la valeur de `X-Frame-Options` en source de `frame-ancestors`.
 *
 * Un seul réglage, `http.securityHeaders.frameOptions`, pilote les DEUX en-têtes :
 * un navigateur CSP ignore `X-Frame-Options` dès que `frame-ancestors` est
 * présent (W3C CSP3 § « `frame-ancestors` »), et l'inverse vaut pour un ancien
 * navigateur. Deux réglages distincts finiraient par dire deux choses.
 *
 * @param frameOptions - valeur émise de `X-Frame-Options` (`null` = non émis).
 * @returns `'none'` pour `DENY`, `'self'` pour `SAMEORIGIN`, `null` sinon
 *   (en-tête coupé, ou valeur que `frame-ancestors` ne sait pas traduire).
 */
export function frameAncestorsFor(frameOptions: string | null): string | null {
  const value = frameOptions?.trim().toUpperCase();
  if (value === "DENY") return "'none'";
  if (value === "SAMEORIGIN") return "'self'";
  return null;
}

/**
 * Ajoute à une politique la directive `frame-ancestors` dérivée de
 * `X-Frame-Options` (cf {@link frameAncestorsFor}).
 *
 * L'application garde la main : une politique qui déclare DÉJÀ
 * `frame-ancestors` est rendue telle quelle — c'est le geste qui autorise
 * l'encadrement par une origine tierce. Une politique vide le reste (pas de CSP
 * voulue). Appelée à la composition de la politique de base, jamais par requête.
 *
 * @param csp - politique de base (config `security.headers.csp`).
 * @param frameOptions - valeur émise de `X-Frame-Options` (`null` = non émis).
 * @returns la politique, complétée de `frame-ancestors` si besoin.
 */
export function withFrameAncestors(
  csp: string,
  frameOptions: string | null,
): string {
  const source = frameAncestorsFor(frameOptions);
  if (source === null || csp.trim() === "") return csp;
  for (const [name] of parseCsp(csp)) {
    if (name.toLowerCase() === "frame-ancestors") return csp;
  }
  // Séparateurs de fin retirés à la main : un `/[\s;]+$/` serait quadratique
  // sur une longue suite de `;` suivie d'autre chose.
  let end = csp.length;
  while (end > 0 && (csp[end - 1] === ";" || /\s/.test(csp[end - 1] ?? ""))) {
    end--;
  }
  return `${csp.slice(0, end)}; frame-ancestors ${source}`;
}

/**
 * Demande à une politique ses rapports de violation : `report-uri` (lu par
 * tous les navigateurs, en http comme en https) ET `report-to` (Reporting API,
 * que le navigateur n'honore que vers une origine sûre — https ou localhost).
 * ADR-0024 §C7.
 *
 * L'application garde la main : une politique qui déclare DÉJÀ `report-uri` ou
 * `report-to` est rendue telle quelle — elle a son collecteur. Une politique
 * vide le reste.
 *
 * @param csp - politique de base.
 * @param url - où poster les rapports (chemin absolu ou URL https).
 * @param group - nom du groupe `report-to`, déclaré par `Reporting-Endpoints`.
 * @returns la politique, et `added` vrai si les directives ont été posées ici —
 *   c'est alors à l'appelant d'émettre `Reporting-Endpoints`.
 */
export function withViolationReports(
  csp: string,
  url: string,
  group: string,
): { csp: string; added: boolean } {
  if (csp.trim() === "") return { csp, added: false };
  for (const [name] of parseCsp(csp)) {
    const lower = name.toLowerCase();
    if (lower === "report-uri" || lower === "report-to") {
      return { csp, added: false };
    }
  }
  let end = csp.length;
  while (end > 0 && (csp[end - 1] === ";" || /\s/.test(csp[end - 1] ?? ""))) {
    end--;
  }
  return {
    csp: `${csp.slice(0, end)}; report-uri ${url}; report-to ${group}`,
    added: true,
  };
}

/**
 * Valide l'URL d'un collecteur de rapports écrite par l'application : un
 * chemin absolu (`/csp`) ou une URL `https:` / `http:`, sans rien qu'un en-tête
 * ou une directive CSP ne puisse porter (espace, `;`, `,`, guillemet).
 *
 * @param url - valeur de `headers.cspReport`.
 * @returns la cause du refus, ou `null` si l'URL est utilisable.
 */
export function reportUrlProblem(url: string): string | null {
  if (url === "") return "URL vide";
  // Hors ASCII visible (espaces et contrôles compris), ou séparateur.
  if (/[^\x21-\x7e]|[;,"\\]/u.test(url)) {
    return "caractère qu’un en-tête ne peut pas porter";
  }
  if (url.startsWith("/")) {
    return url.startsWith("//") ? "URL relative au schéma (//)" : null;
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "ni chemin absolu ni URL";
  }
  return parsed.protocol === "https:" || parsed.protocol === "http:"
    ? null
    : `schéma ${parsed.protocol} refusé`;
}
