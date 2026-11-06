/**
 * Requêtes conditionnelles sur une représentation servie par un contrôleur —
 * validateurs (RFC 9110 §8.8) et évaluation des préconditions (§13).
 *
 * Fonctions PURES : l'instant courant est un paramètre, aucune lecture
 * d'horloge ni d'en-tête n'a lieu ici. Le contrôleur rassemble les entrées,
 * ce module rend le verdict.
 */

/** Validateurs d'une représentation (RFC 9110 §8.8). */
export interface IValidators {
  /** Étiquette d'entité, guillemets compris (`"…"` forte, `W/"…"` faible) ; `null` si aucune. */
  readonly etag: string | null;
  /**
   * Dernière modification (ms depuis l'époque), à la seconde — la précision
   * d'une date HTTP — et jamais postérieure à l'instant de la réponse
   * (§8.8.2.1) ; `null` si aucune.
   */
  readonly lastModified: number | null;
  /**
   * La date est-elle un validateur FORT (§8.8.2.2) : modifiée au moins une
   * seconde avant la réponse, elle ne peut plus changer dans la même seconde.
   * Seul un validateur fort autorise une reprise par `If-Range` (§13.1.5).
   */
  readonly lastModifiedStrong: boolean;
}

/** Issue des préconditions : servir (200), rien n'a changé (304), condition fausse (412). */
export type PreconditionOutcome = 200 | 304 | 412;

/** En-têtes de requête lus par l'évaluation (noms en minuscules, comme Node les rend). */
export interface IConditionalHeaders {
  readonly "if-match"?: string | undefined;
  readonly "if-none-match"?: string | undefined;
  readonly "if-modified-since"?: string | undefined;
  readonly "if-unmodified-since"?: string | undefined;
  readonly "if-range"?: string | undefined;
}

/** Une `entity-tag` (RFC 9110 §8.8.3) : `W/` facultatif, puis une chaîne entre guillemets. */
const ENTITY_TAG = /(?:W\/)?"[^"]*"/g;

/**
 * Validateurs d'un fichier, tirés de ses métadonnées sans le lire.
 *
 * L'`ETag` est FORTE : taille et date de modification à la microseconde, deux
 * grandeurs qu'une écriture change. C'est la forme que posent les serveurs de
 * fichiers courants, et la seule qui autorise une reprise (§13.1.5).
 *
 * @param stats - taille et date de modification du fichier
 * @param now - instant de la réponse (ms)
 * @returns les validateurs du fichier
 */
export function fileValidators(
  stats: { readonly size: number; readonly mtimeMs: number },
  now: number,
): IValidators {
  const micros = Math.floor(stats.mtimeMs * 1000);
  const seconds = Math.floor(Math.min(stats.mtimeMs, now) / 1000) * 1000;
  return {
    etag: `"${stats.size.toString(16)}-${micros.toString(16)}"`,
    lastModified: seconds,
    lastModifiedStrong: stats.mtimeMs + 1000 <= now,
  };
}

/**
 * Date HTTP (RFC 9110 §5.6.7) lue en ms, ou `null` si la valeur n'en est pas
 * une — une condition sur une date invalide DOIT être ignorée (§13.1.3, §13.1.4).
 *
 * @param value - valeur brute de l'en-tête
 */
export function parseHttpDate(value: string | undefined): number | null {
  if (value === undefined) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

/** Les `entity-tag` d'une liste, ou `"*"`. */
function entityTags(value: string): readonly string[] | "*" {
  if (value.trim() === "*") return "*";
  return value.match(ENTITY_TAG) ?? [];
}

/** Partie opaque d'une `entity-tag` (sans `W/`). */
function opaque(tag: string): string {
  return tag.startsWith("W/") ? tag.slice(2) : tag;
}

/** Comparaison FORTE (§8.8.3.2) : aucune des deux n'est faible, et elles sont identiques. */
function strongMatch(a: string, b: string): boolean {
  return !a.startsWith("W/") && !b.startsWith("W/") && a === b;
}

/** Comparaison FAIBLE (§8.8.3.2) : parties opaques identiques. */
function weakMatch(a: string, b: string): boolean {
  return opaque(a) === opaque(b);
}

/**
 * Évalue les préconditions d'une requête sur une représentation qui EXISTE,
 * dans l'ordre de RFC 9110 §13.2.2 — `If-Match`, sinon `If-Unmodified-Since` ;
 * puis `If-None-Match`, sinon `If-Modified-Since`. `Range` et `If-Range`
 * viennent après, s'il faut servir (voir {@link ifRangeHolds}).
 *
 * @param method - méthode de la requête
 * @param headers - en-têtes de la requête
 * @param validators - validateurs de la représentation
 * @returns 200 pour servir, 304 si rien n'a changé (GET et HEAD seulement),
 *   412 si une condition est fausse
 */
export function evaluatePreconditions(
  method: string,
  headers: IConditionalHeaders,
  validators: IValidators,
): PreconditionOutcome {
  const read = method === "GET" || method === "HEAD";
  const ifMatch = headers["if-match"];
  if (ifMatch !== undefined) {
    // §13.1.1 : `*` est vrai dès que la représentation existe.
    const tags = entityTags(ifMatch);
    const { etag } = validators;
    const holds =
      tags === "*" ||
      (etag !== null && tags.some((tag) => strongMatch(tag, etag)));
    if (!holds) return 412;
  } else {
    // §13.1.4 : ignorée sous `If-Match`, et si la date est invalide.
    const since = parseHttpDate(headers["if-unmodified-since"]);
    if (
      since !== null &&
      validators.lastModified !== null &&
      validators.lastModified > since
    ) {
      return 412;
    }
  }
  const ifNoneMatch = headers["if-none-match"];
  if (ifNoneMatch !== undefined) {
    // §13.1.2 : `*` est faux dès que la représentation existe.
    const tags = entityTags(ifNoneMatch);
    const { etag } = validators;
    const matched =
      tags === "*" ||
      (etag !== null && tags.some((tag) => weakMatch(tag, etag)));
    if (matched) return read ? 304 : 412;
  } else if (read) {
    // §13.1.3 : ignorée sous `If-None-Match`, hors GET/HEAD, et si la date
    // est invalide.
    const since = parseHttpDate(headers["if-modified-since"]);
    if (
      since !== null &&
      validators.lastModified !== null &&
      validators.lastModified <= since
    ) {
      return 304;
    }
  }
  return 200;
}

/**
 * Une condition `If-Range` tient-elle (RFC 9110 §13.1.5) ? Vraie, la plage
 * demandée est servie (206) ; fausse, `Range` est ignoré et la représentation
 * part entière (200) — un client ne recolle jamais deux versions.
 *
 * Une étiquette tient si elle est FORTEMENT égale ; une date, si elle égale
 * exactement `Last-Modified` ET que celle-ci est un validateur fort.
 *
 * @param value - valeur brute de `If-Range`
 * @param validators - validateurs de la représentation
 */
export function ifRangeHolds(value: string, validators: IValidators): boolean {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') || trimmed.startsWith("W/")) {
    return validators.etag !== null && strongMatch(trimmed, validators.etag);
  }
  const date = parseHttpDate(trimmed);
  return (
    date !== null &&
    validators.lastModifiedStrong &&
    validators.lastModified === date
  );
}
