import type { Container } from "nodefony";
import type { Context, HttpKernel } from "@nodefony/http";

/**
 * En-tête par lequel une requête de banc se désigne au témoin des scopes : sa
 * valeur est la MARQUE que le banc a déclarée par `/scopes/watch`.
 */
export const SCOPE_WITNESS_HEADER = "x-scope-witness";

/** Une marque : lettres, chiffres, tirets — un `randomUUID()` y entre. */
const MARK_PATTERN = /^[A-Za-z0-9-]{1,64}$/;

/** Les scopes vus pour une marque : combien, et ceux encore ouverts. */
class WitnessedMark {
  seen = 0;
  readonly open = new Set<Container>();
}

/**
 * Témoin des scopes `request` d'UN banc — ceux des requêtes qui portent sa
 * marque, et eux seuls.
 *
 * Le compte global du conteneur (`/scopes`) additionne toutes les requêtes en
 * vol sur le serveur. Or les suites d'intégration de plusieurs paquets tournent
 * EN PARALLÈLE contre lui (turbo) : un flux gRPC long ouvert par une autre
 * suite pendant la mesure passait pour un scope retenu (#794 — 8 flux
 * `Watch`/`Converse` de framework, lus comme 8 HEAD qui fuyaient). Ici, seul
 * le scope d'une requête marquée entre au compte, et il en sort dès qu'il est
 * `closed` (`Container.leaveScope`) : le verdict ne dépend plus du voisinage.
 *
 * Armé à la demande, par marque : le premier `watch` pose les écouteurs, le
 * dernier `unwatch` les retire — deux suites qui se recouvrent ne se
 * désarment pas l'une l'autre. HTTP est vu à `onCreateContext` (au plus tôt :
 * avant le corps) ; une poignée de main WebSocket, qui n'émet pas cet
 * événement, à `beforeResolve` (avant contrôleur, session, pare-feu et
 * décision). Angle mort assumé : un scope refermé ou perdu AVANT ces points
 * (constructeur du contexte qui lève, refus d'origine WS) n'est pas vu — le
 * banc qui le vise affirme `seen` et s'en aperçoit.
 */
const marks = new Map<string, WitnessedMark>();
let armedOn: HttpKernel | null = null;

function record(context: Context): void {
  const mark = context.request?.headers[SCOPE_WITNESS_HEADER];
  if (typeof mark !== "string") return;
  const entry = marks.get(mark);
  const scope = context.container;
  // HTTP passe par les DEUX événements : le second voit un scope déjà inscrit.
  if (entry === undefined || scope === null || entry.open.has(scope)) return;
  entry.open.add(scope);
  entry.seen++;
}

/** Valide une marque reçue en paramètre ; `null` si absente ou mal formée. */
export function parseWitnessMark(mark: string | undefined): string | null {
  return mark !== undefined && MARK_PATTERN.test(mark) ? mark : null;
}

/** Déclare une marque (remise à zéro si elle existait) et arme le témoin. */
export function watchScopes(kernel: HttpKernel, mark: string): void {
  marks.set(mark, new WitnessedMark());
  if (armedOn === null) {
    kernel.on("onCreateContext", record);
    kernel.on("beforeResolve", record);
    armedOn = kernel;
  }
}

/**
 * Relève une marque : scopes vus, et encore ouverts. Les scopes refermés
 * sortent de l'ensemble à cette lecture — le témoin ne les retient pas.
 *
 * @returns `null` si la marque n'est pas surveillée.
 */
export function readScopes(
  mark: string,
): { seen: number; open: number } | null {
  const entry = marks.get(mark);
  if (entry === undefined) return null;
  for (const scope of entry.open) if (scope.closed) entry.open.delete(scope);
  return { seen: entry.seen, open: entry.open.size };
}

/** Oublie une marque ; la dernière oubliée désarme le témoin. */
export function unwatchScopes(mark: string): void {
  marks.delete(mark);
  if (marks.size === 0 && armedOn !== null) {
    armedOn.removeListener("onCreateContext", record);
    armedOn.removeListener("beforeResolve", record);
    armedOn = null;
  }
}
