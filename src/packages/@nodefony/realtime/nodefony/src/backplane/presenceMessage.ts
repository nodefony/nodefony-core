import { ownField } from "nodefony";
import type { PresencePairs } from "nodefony";
import { isBoundedBusText } from "./controlOrder";

/**
 * Messages de la présence répartie entre serveurs — la LISTE FERMÉE de ce qui
 * circule sur `PLATFORM_BUS_CHANNELS.presence` (lots, demandes, réponses d'état)
 * et `PLATFORM_BUS_CHANNELS.presenceAlive` (preuve de vie), ADR-0025 P2.
 *
 * Comme un ordre de contrôle (`controlOrder.ts#readControlOrder`), chaque
 * message voyage dans la charge d'un message ordinaire du bus, sous le sceau de
 * l'enveloppe : aucun champ neuf dans l'enveloppe, aucune méthode neuve dans
 * `IBackplane`. L'émetteur (`originId`) se lit dans l'enveloppe, jamais dans la
 * charge.
 *
 * Lecture par champs PROPRES (`ownField`), textes bornés (`isBoundedBusText`),
 * entiers sûrs ; un champ inconnu est toléré (déploiement progressif), un champ
 * connu de forme fausse fait refuser le message entier. Les tableaux rendus
 * sont CEUX reçus, validés en place — aucune copie, aucune allocation par
 * membre : le lecteur ne les modifie pas, l'appelant non plus.
 */

/** Plus petit intervalle de preuve de vie qu'un pair peut annoncer (ms). */
export const MIN_PRESENCE_INTERVAL_MS = 100;

/** Plus grand intervalle de preuve de vie qu'un pair peut annoncer (ms) — 10 min. */
export const MAX_PRESENCE_INTERVAL_MS = 600_000;

/**
 * Plafond d'identités nommées qu'un pod peut annoncer pour UN canal — au-delà,
 * l'entrée est refusée (ADR-0025 P2, « plafond de membres par pod et par canal »).
 */
export const MAX_PRESENCE_MEMBERS = 100_000;

/** Plafond d'entrées de canal dans un même message (lot, demande ou part de réponse). */
export const MAX_PRESENCE_CHANNELS = 4096;

/** Plafond de parts d'une réponse d'état (`n`). */
export const MAX_PRESENCE_PARTS = 4096;

/**
 * Changements d'un pod sur UN canal, en valeurs ABSOLUES : rejouer une entrée
 * déjà comprise dans un état ne change rien.
 */
export interface IPresenceChannelDelta {
  /** Nom exact du canal. */
  readonly channel: string;
  /** Identités dont le NOMBRE d'onglets sur ce pod change, à plat `[identité, onglets, …]` (onglets ≥ 1) ; `null` si aucune. */
  readonly set: PresencePairs | null;
  /** Identités qui n'ont plus aucun onglet sur ce pod ; `null` si aucune. */
  readonly gone: readonly string[] | null;
  /** Connexions non nommées de ce pod sur ce canal — valeur absolue. */
  readonly unnamed: number;
}

/** État COMPLET d'un pod sur un canal, dans une réponse d'état. */
export interface IPresenceChannelState {
  /** Nom exact du canal. */
  readonly channel: string;
  /** Toutes les identités nommées de ce pod, à plat `[identité, onglets, …]` (onglets ≥ 1). */
  readonly members: PresencePairs;
  /** Connexions non nommées de ce pod sur ce canal. */
  readonly unnamed: number;
}

/** Lot de changements d'un pod, scellé toutes les 50 ms, chaîné par `prev`. */
export interface IPresenceBatch {
  /** Discriminant. */
  readonly op: "batch";
  /** Vie du processus émetteur (`Date.now() × 1024 + aléa sur 10 bits`). */
  readonly incarnation: number;
  /** Numéro du message, strictement croissant par (`originId`, incarnation), ≥ 1. */
  readonly seq: number;
  /** `seq` du lot précédent de l'émetteur, `0` pour le premier ; `< seq`. */
  readonly prev: number;
  /** Changements par canal. */
  readonly channels: readonly IPresenceChannelDelta[];
}

/** Demande d'état — le *fetch* de RFC 2778 §2.1, la *presence probe* de RFC 6121 §4.3. */
export interface IPresenceRequest {
  /** Discriminant. */
  readonly op: "request";
  /** Vie du processus demandeur. */
  readonly incarnation: number;
  /** Numéro du message (même suite que les lots du demandeur). */
  readonly seq: number;
  /** Canaux dont l'état est demandé. */
  readonly channels: readonly string[];
  /**
   * Pod visé (`originId`) — il répond TOUJOURS, même vide (RFC 6121 §4.3.2) ;
   * `null` = demande non ciblée, servie par les seuls pods qui ont des présents.
   */
  readonly to: string | null;
}

/**
 * Une part d'une réponse d'état. Les `n` parts d'une réponse partent d'un bloc,
 * à `seq` consécutifs (`seq` de la part `i` = `seq` de la part 0 + `i`), et
 * s'appliquent d'un bloc : une part perdue laisse la vue inchangée.
 */
export interface IPresenceStatePart {
  /** Discriminant. */
  readonly op: "state";
  /** Vie du processus qui répond. */
  readonly incarnation: number;
  /** Numéro du message. */
  readonly seq: number;
  /** `seq` du dernier lot émis avant la réponse — il ferme le trou (RFC 5263 §4.5) ; `< seq`. */
  readonly last: number;
  /** Rang de la part, `0 ≤ i < n`. */
  readonly i: number;
  /** Nombre de parts de la réponse, `1 ≤ n ≤ MAX_PRESENCE_PARTS`. */
  readonly n: number;
  /** États complets par canal (un canal peut s'étendre sur plusieurs parts). */
  readonly channels: readonly IPresenceChannelState[];
}

/** Message lu sur `PLATFORM_BUS_CHANNELS.presence`. */
export type PresenceMessage =
  IPresenceBatch | IPresenceRequest | IPresenceStatePart;

/** Preuve de vie, lue sur `PLATFORM_BUS_CHANNELS.presenceAlive` — quelques dizaines d'octets, indépendante du nombre de canaux. */
export interface IPresenceAlive {
  /** Vie du processus émetteur. */
  readonly incarnation: number;
  /** Numéro du message (même suite que les lots). */
  readonly seq: number;
  /** `seq` du dernier lot émis, `0` si aucun ; `< seq`. */
  readonly last: number;
  /** Intervalle de l'émetteur (ms), ANNONCÉ : il fixe le délai d'oubli chez les pairs (RFC 6665 §3.1.1). */
  readonly interval: number;
  /** `true` = arrêt propre : les pairs l'oublient aussitôt (RFC 6121 §4.5.1). */
  readonly final: boolean;
}

/** Entier sûr ≥ 0. */
function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/**
 * Paires à plat `[identité, onglets, …]` recevables : longueur paire, au plus
 * {@link MAX_PRESENCE_MEMBERS} identités, textes bornés, onglets entiers ≥ 1.
 * Un seul parcours, aucune allocation.
 */
function isPairs(value: unknown): value is PresencePairs {
  if (!Array.isArray(value)) return false;
  const length = value.length;
  if ((length & 1) !== 0 || length > MAX_PRESENCE_MEMBERS * 2) return false;
  for (let i = 0; i < length; i += 2) {
    if (!isBoundedBusText(value[i])) return false;
    const tabs: unknown = value[i + 1];
    if (typeof tabs !== "number" || !Number.isSafeInteger(tabs) || tabs < 1)
      return false;
  }
  return true;
}

/** Liste de textes bornés d'au plus `max` éléments. */
function isTextList(value: unknown, max: number): value is readonly string[] {
  if (!Array.isArray(value) || value.length > max) return false;
  for (let i = 0; i < value.length; i += 1)
    if (!isBoundedBusText(value[i])) return false;
  return true;
}

/** Numéro de message recevable : entier sûr ≥ 1. */
function isSeq(value: unknown): value is number {
  return isCount(value) && value >= 1;
}

/** Un champ « numéro précédent » (`prev`, `last`) : entier sûr ≥ 0, strictement sous `seq`. */
function readBefore(payload: unknown, key: string, seq: number): number | null {
  const value = ownField(payload, key);
  return isCount(value) && value < seq ? value : null;
}

function readDeltas(value: unknown): IPresenceChannelDelta[] | null {
  if (!Array.isArray(value) || value.length > MAX_PRESENCE_CHANNELS)
    return null;
  const out = new Array<IPresenceChannelDelta>(value.length);
  for (let i = 0; i < value.length; i += 1) {
    const entry: unknown = value[i];
    const channel = ownField(entry, "channel");
    const unnamed = ownField(entry, "unnamed");
    if (!isBoundedBusText(channel) || !isCount(unnamed)) return null;
    const set = ownField(entry, "set");
    if (set !== undefined && set !== null && !isPairs(set)) return null;
    const gone = ownField(entry, "gone");
    if (
      gone !== undefined &&
      gone !== null &&
      !isTextList(gone, MAX_PRESENCE_MEMBERS)
    )
      return null;
    out[i] = { channel, set: set ?? null, gone: gone ?? null, unnamed };
  }
  return out;
}

function readStates(value: unknown): IPresenceChannelState[] | null {
  if (!Array.isArray(value) || value.length > MAX_PRESENCE_CHANNELS)
    return null;
  const out = new Array<IPresenceChannelState>(value.length);
  for (let i = 0; i < value.length; i += 1) {
    const entry: unknown = value[i];
    const channel = ownField(entry, "channel");
    const unnamed = ownField(entry, "unnamed");
    const members = ownField(entry, "members");
    if (!isBoundedBusText(channel) || !isCount(unnamed) || !isPairs(members))
      return null;
    out[i] = { channel, members, unnamed };
  }
  return out;
}

/** Les types de message que cette version sait lire sur le canal de présence — liste fermée. */
function isKnownOp(op: unknown): op is PresenceMessage["op"] {
  return op === "batch" || op === "request" || op === "state";
}

/**
 * Lit un message du canal de présence — `null` si sa forme n'est pas celle d'un message connu.
 *
 * Une seule garde pour les deux bords : l'émetteur la passe en test (il n'émet
 * jamais ce que ses pairs refuseraient), le récepteur avant d'appliquer.
 *
 * @param payload - la charge du message reçu (forme inconnue).
 * @returns le message, ou `null` (forme invalide, ou type inconnu : cf
 *   {@link isUnknownPresenceMessage} pour les distinguer).
 */
export function readPresenceMessage(payload: unknown): PresenceMessage | null {
  const op = ownField(payload, "op");
  if (!isKnownOp(op)) return null;
  const incarnation = ownField(payload, "incarnation");
  const seq = ownField(payload, "seq");
  if (!isCount(incarnation) || !isSeq(seq)) return null;
  const raw = ownField(payload, "channels");
  if (op === "batch") {
    const prev = readBefore(payload, "prev", seq);
    if (prev === null) return null;
    const channels = readDeltas(raw);
    return channels === null ? null : { op, incarnation, seq, prev, channels };
  }
  if (op === "request") {
    if (!isTextList(raw, MAX_PRESENCE_CHANNELS)) return null;
    const to = ownField(payload, "to");
    if (to !== undefined && to !== null && !isBoundedBusText(to)) return null;
    return { op, incarnation, seq, channels: raw, to: to ?? null };
  }
  const last = readBefore(payload, "last", seq);
  const i = ownField(payload, "i");
  const n = ownField(payload, "n");
  if (
    last === null ||
    !isCount(n) ||
    n < 1 ||
    n > MAX_PRESENCE_PARTS ||
    !isCount(i) ||
    i >= n
  )
    return null;
  const channels = readStates(raw);
  return channels === null
    ? null
    : { op, incarnation, seq, last, i, n, channels };
}

/**
 * La charge est-elle un message de présence d'un TYPE que cette version ne connaît pas — `op` lisible, hors de la liste fermée ?
 *
 * C'est ce qu'émet un serveur plus récent pendant un déploiement progressif :
 * jeté et compté dans `ingressUnknownDiscardedTotal`, jamais comme une
 * injection (ADR-0025, « Règle de lecture du bus »).
 *
 * @param payload - la charge du message reçu (forme inconnue).
 */
export function isUnknownPresenceMessage(payload: unknown): boolean {
  const op = ownField(payload, "op");
  return isBoundedBusText(op) && !isKnownOp(op);
}

/**
 * Lit une preuve de vie — `null` si sa forme est fausse.
 *
 * `interval` hors de [{@link MIN_PRESENCE_INTERVAL_MS}, {@link MAX_PRESENCE_INTERVAL_MS}]
 * est refusé : un pair qui annoncerait 1 ms se ferait oublier à chaque tic, un
 * qui annoncerait une heure garderait ses fantômes une demi-journée.
 *
 * @param payload - la charge du message reçu (forme inconnue).
 */
export function readPresenceAlive(payload: unknown): IPresenceAlive | null {
  const incarnation = ownField(payload, "incarnation");
  const seq = ownField(payload, "seq");
  if (!isCount(incarnation) || !isSeq(seq)) return null;
  const last = readBefore(payload, "last", seq);
  const interval = ownField(payload, "interval");
  const final = ownField(payload, "final");
  if (
    last === null ||
    !isCount(interval) ||
    interval < MIN_PRESENCE_INTERVAL_MS ||
    interval > MAX_PRESENCE_INTERVAL_MS ||
    (final !== undefined && typeof final !== "boolean")
  )
    return null;
  return { incarnation, seq, last, interval, final: final === true };
}
