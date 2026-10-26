/**
 * Codecs du colKit — rendent CANONIQUE, à l'écriture, une valeur que SQLite et
 * MySQL rangeraient telle quelle là où PostgreSQL la normalise ou la refuse.
 *
 * Le but est une seule valeur JavaScript relue, quel que soit le moteur : celle
 * que PostgreSQL rendrait. Une valeur que PostgreSQL refuse est refusée ici
 * aussi, AVANT d'atteindre la base, en nommant la colonne. Fonctions pures,
 * appelées par les `customType` des fabriques (`toDriver`) — donc sur toute
 * écriture ET toute comparaison liée à la colonne (`eq(col, valeur)`).
 */

/** Genre de colonne dont un codec refuse la valeur. */
export type ColumnValueKind = "decimal" | "uuid" | "date";

/**
 * Valeur qu'une colonne du kit REFUSE avant la base — là où PostgreSQL la
 * refuserait lui-même (`22P02`).
 *
 * Structurée, et reconnue par sa FORME (`name` + `kind`) : le rendu d'erreur
 * HTTP, qui ne dépend d'aucun ORM, y lit un identifiant mal formé (`kind:
 * "uuid"`) et répond 404 comme pour PostgreSQL ou Mongoose — sans quoi le même
 * chemin rendrait 404 sur un moteur et 500 sur un autre.
 */
export class ColumnValueError extends Error {
  override readonly name = "ColumnValueError";

  /**
   * @param kind - genre de la colonne.
   * @param value - valeur refusée, telle que reçue.
   * @param column - `table.colonne`.
   * @param message - phrase qui dit le refus.
   */
  constructor(
    readonly kind: ColumnValueKind,
    override readonly value: string,
    readonly column: string,
    message: string,
  ) {
    super(`[@nodefony/drizzle] colKit "${column}": "${value}" ${message}`);
  }
}

/** Exposant au-delà duquel une écriture décimale est refusée (borne le calcul). */
const DECIMAL_MAX_EXPONENT = 1000;

const DECIMAL_RE = /^([+-])?(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/;

/**
 * Rend un décimal sous la forme que PostgreSQL rend pour `numeric(p,s)` :
 * exactement `s` décimales, arrondi au plus proche (moitié loin de zéro), sans
 * zéro de tête, sans signe pour zéro.
 *
 * @param value - écriture décimale (`"12.5"`, `"-0.125"`, `"1e2"`).
 * @param precision - nombre total de chiffres admis.
 * @param scale - nombre de décimales.
 * @param label - `table.colonne`, pour le message d'erreur.
 * @returns la forme canonique (`"12.50"`).
 * @throws Quand la valeur n'est pas un décimal, ou dépasse la précision.
 */
export function canonicalDecimal(
  value: string,
  precision: number,
  scale: number,
  label: string,
): string {
  const match = DECIMAL_RE.exec(value.trim());
  const intPart = match?.[2] ?? "";
  const fracPart = match?.[3] ?? "";
  if (match === null || intPart.length + fracPart.length === 0) {
    throw new ColumnValueError(
      "decimal",
      value,
      label,
      "is not a decimal number.",
    );
  }
  const exponent = Number(match[4] ?? "0");
  if (Math.abs(exponent) > DECIMAL_MAX_EXPONENT) {
    throw new ColumnValueError(
      "decimal",
      value,
      label,
      `does not fit decimal(${precision}, ${scale}).`,
    );
  }
  // valeur = digits × 10^(exponent − fracPart.length)
  const digits = BigInt(intPart + fracPart);
  const shift = scale + exponent - fracPart.length;
  let scaled: bigint;
  if (shift >= 0) {
    scaled = digits * 10n ** BigInt(shift);
  } else {
    const divisor = 10n ** BigInt(-shift);
    scaled = digits / divisor;
    if ((digits % divisor) * 2n >= divisor) {
      scaled += 1n;
    }
  }
  const text = scaled.toString();
  if (text.length > precision && scaled !== 0n) {
    throw new ColumnValueError(
      "decimal",
      value,
      label,
      `does not fit decimal(${precision}, ${scale}).`,
    );
  }
  const padded = text.padStart(scale + 1, "0");
  const integer = padded.slice(0, padded.length - scale);
  const fraction = padded.slice(padded.length - scale);
  const sign = match[1] === "-" && scaled !== 0n ? "-" : "";
  return scale === 0 ? `${sign}${integer}` : `${sign}${integer}.${fraction}`;
}

const UUID_RE =
  /^([0-9a-f]{8})-?([0-9a-f]{4})-?([0-9a-f]{4})-?([0-9a-f]{4})-?([0-9a-f]{12})$/i;

/**
 * Rend un UUID sous sa forme canonique — minuscules, `8-4-4-4-12` — comme le
 * type `uuid` de PostgreSQL le rend.
 *
 * @param value - UUID, tirets et accolades facultatifs, casse indifférente.
 * @param label - `table.colonne`, pour le message d'erreur.
 * @returns la forme canonique.
 * @throws Quand la valeur n'est pas un UUID (PostgreSQL la refuserait).
 */
export function canonicalUuid(value: string, label: string): string {
  const braced = value.startsWith("{") && value.endsWith("}");
  const match = UUID_RE.exec(braced ? value.slice(1, -1) : value);
  if (match === null) {
    throw new ColumnValueError("uuid", value, label, "is not a UUID.");
  }
  return `${match[1]}-${match[2]}-${match[3]}-${match[4]}-${match[5]}`.toLowerCase();
}

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Vérifie un jour calendaire `YYYY-MM-DD` — un jour qui n'existe pas
 * (`2023-02-29`) est refusé, comme PostgreSQL et MySQL le refusent.
 *
 * @param value - jour au format ISO.
 * @param label - `table.colonne`, pour le message d'erreur.
 * @returns la valeur, inchangée.
 * @throws Quand la valeur n'est pas un jour valide entre 0001 et 9999.
 */
export function canonicalDay(value: string, label: string): string {
  const match = DAY_RE.exec(value);
  const year = Number(match?.[1]);
  const month = Number(match?.[2]);
  const day = Number(match?.[3]);
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const lastDay =
    month === 2 ? (leap ? 29 : 28) : [4, 6, 9, 11].includes(month) ? 30 : 31;
  if (
    match === null ||
    year < 1 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > lastDay
  ) {
    throw new ColumnValueError(
      "date",
      value,
      label,
      "is not a calendar day (YYYY-MM-DD).",
    );
  }
  return value;
}
