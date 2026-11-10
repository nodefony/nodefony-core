/**
 * presenceView — lecteur et vue PURS de la trame `realtime:presence` (ADR-0025 P2 bis, P3).
 *
 * Une seule implémentation, chargée partout où une trame de présence se lit : la socket du
 * navigateur (`NodefonySocket`), ses quatre liaisons de vue, le kit de test du serveur, la
 * console d'administration et la barre de debug. Le serveur ÉCRIT la trame
 * (`ChannelPresence`), ce module la LIT : une trame qui sortirait du serveur sans être
 * lisible ici est un défaut que le kit de test attrape, puisqu'il passe par ce lecteur.
 *
 * La forme de la vue ({@link IPresenceView}) est aussi celle que rend `hub.presence()` côté
 * serveur : l'observateur serveur et le navigateur lisent le même objet.
 *
 * Pur et isomorphe : aucun minuteur, aucune socket, aucun import Node. La politique de
 * resynchronisation (re-`subscribe` limité) appartient à qui tient la socket ; la vue ne
 * fait que dire `gap`.
 */
import { ownField } from "../runtime/ownField";
import {
  classifyNumberedChange,
  type NumberedChangeOutcome,
} from "./numberedChange";
import type {
  IPresenceEntry,
  IRealtimePresenceChanges,
  PresencePairs,
  PresenceStates,
  RealtimePresenceFrame,
} from "./RealtimeEventMap";

/**
 * Délai minimal entre deux re-`subscribe` d'un même canal émis pour combler un trou de
 * version (ADR-0025 P2 bis, S-rt-103) — la protection du serveur, qui renvoie TOUJOURS la
 * liste, est cette limite côté client.
 */
export const PRESENCE_RESYNC_MS = 2_000;

/**
 * Gigue ajoutée au délai de resynchronisation, en fraction de {@link PRESENCE_RESYNC_MS}
 * (0 à 25 %, comme le premier battement de la preuve de vie) : des onglets qui voient le
 * même trou ne redemandent pas la liste au même instant.
 */
export const PRESENCE_RESYNC_JITTER = 0.25;

/**
 * Ce qu'un lecteur voit de la présence d'un canal — la même forme côté serveur
 * (`hub.presence()`) et côté navigateur (socket, liaisons).
 */
export interface IPresenceView {
  /** Identités NOMMÉES distinctes présentes (comptes seulement). */
  readonly count: number;
  /** Connexions comptées sans être nommées (anonymes, appelants machine sans compte). */
  readonly unnamed: number;
  /**
   * Les présents nommés : identité → `{ tabs, states? }`. Vide au-delà du seuil de
   * membres nommés de la trame (seul `count` le dit) ; toujours rempli côté serveur.
   */
  readonly members: ReadonlyMap<string, IPresenceEntry>;
  /**
   * `true` si la vue est connue incomplète ou figée : le serveur le dit (liste locale
   * avant la réponse des pairs, bus perdu), ou la vue du navigateur n'est plus
   * synchronisée (socket fermée, trou de version, resynchronisation en cours).
   */
  readonly partial: boolean;
}

/**
 * Instantané de la vue d'un canal côté navigateur — {@link IPresenceView} plus `ready`.
 *
 * Immuable : un nouvel objet à chaque changement, le même tant que rien ne change (il
 * convient tel quel à `useSyncExternalStore` et à toute comparaison par référence).
 */
export interface IPresenceSnapshot extends IPresenceView {
  /**
   * `false` tant qu'aucune trame complète n'est arrivée : « vide » et « pas encore
   * reçu » ne se confondent pas (l'état neutre de RFC 6665 §4.1.2.4).
   */
  readonly ready: boolean;
}

const NO_MEMBERS: ReadonlyMap<string, IPresenceEntry> = new Map();

/** Instantané d'un canal dont aucune trame n'est arrivée — partagé, jamais modifié. */
export const EMPTY_PRESENCE: IPresenceSnapshot = Object.freeze({
  ready: false,
  count: 0,
  unnamed: 0,
  members: NO_MEMBERS,
  partial: false,
});

/** Entier sûr ≥ `min` (version, nombres, onglets). */
function isCount(value: unknown, min: number): value is number {
  return (
    typeof value === "number" && Number.isSafeInteger(value) && value >= min
  );
}

/** Objet ordinaire (ni tableau, ni `null`) — la forme d'un champ `states`. */
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Paires à plat `[identité, onglets, …]` recevables : longueur paire, identité texte,
 * onglets entiers ≥ 1. Un parcours, aucune allocation.
 */
function isPairs(value: unknown): value is PresencePairs {
  if (!Array.isArray(value)) return false;
  const length = value.length;
  if ((length & 1) !== 0) return false;
  for (let i = 0; i < length; i += 2) {
    if (typeof value[i] !== "string" || !isCount(value[i + 1], 1)) return false;
  }
  return true;
}

/** Identités parties : un tableau de textes. */
function isGone(value: unknown): value is readonly string[] {
  if (!Array.isArray(value)) return false;
  for (const id of value) if (typeof id !== "string") return false;
  return true;
}

/** États par identité puis par onglet : deux niveaux d'objets ordinaires. */
function isStates(value: unknown): value is PresenceStates {
  if (!isRecord(value)) return false;
  for (const key of Object.keys(value)) if (!isRecord(value[key])) return false;
  return true;
}

/** Bloc `changes` recevable : objet, chacun de ses champs connus à la bonne forme. */
function isChanges(value: unknown): value is IRealtimePresenceChanges {
  if (!isRecord(value)) return false;
  const set = ownField(value, "set");
  const gone = ownField(value, "gone");
  const states = ownField(value, "states");
  return (
    (set === undefined || isPairs(set)) &&
    (gone === undefined || isGone(gone)) &&
    (states === undefined || isStates(states))
  );
}

/**
 * Lecteur à liste fermée d'une trame `realtime:presence` reçue : `true` si elle est
 * recevable, et alors typée telle quelle — aucune copie, aucune allocation.
 *
 * Champs exigés : `channel` (texte), `version`, `count`, `unnamed` (entiers sûrs ≥ 0) ;
 * `partial` absent ou `true` ; puis AU PLUS un de `members` (paires à plat, `states`
 * voisin facultatif) et `changes` — aucun des deux = trame de nombres seuls. Un champ
 * inconnu est toléré (un serveur plus récent l'ajoute sans casser ce lecteur) ; un champ
 * connu à la mauvaise forme refuse la trame entière, rien n'en atteint la vue. Lu par
 * champs propres (`ownField`) : rien d'hérité ne passe.
 *
 * @param value - `params` de la notification, tel que décodé.
 * @returns `true` si `value` est une trame de présence recevable.
 */
export function isPresenceFrame(
  value: unknown,
): value is RealtimePresenceFrame {
  if (!isRecord(value)) return false;
  const partial = ownField(value, "partial");
  if (
    typeof ownField(value, "channel") !== "string" ||
    !isCount(ownField(value, "version"), 0) ||
    !isCount(ownField(value, "count"), 0) ||
    !isCount(ownField(value, "unnamed"), 0) ||
    (partial !== undefined && partial !== true)
  )
    return false;
  const members = ownField(value, "members");
  const changes = ownField(value, "changes");
  const states = ownField(value, "states");
  if (changes !== undefined)
    return members === undefined && states === undefined && isChanges(changes);
  if (members === undefined) return states === undefined;
  return isPairs(members) && (states === undefined || isStates(states));
}

/**
 * Entrée de vue pour une identité : l'entrée précédente si elle est identique (aucune
 * allocation pour un présent inchangé — les entrées sont immuables, donc partageables
 * entre deux instantanés), sinon une neuve.
 */
function entryOf(
  previous: IPresenceEntry | undefined,
  tabs: number,
  states: Readonly<Record<string, unknown>> | undefined,
): IPresenceEntry {
  if (states !== undefined) return { tabs, states };
  if (previous?.tabs === tabs && previous.states === undefined) return previous;
  return { tabs };
}

/** États d'une identité dans un champ `states`, lus par champ propre. */
function statesOf(
  states: PresenceStates | undefined,
  id: string,
): Readonly<Record<string, unknown>> | undefined {
  if (states === undefined) return undefined;
  const own = ownField(states, id);
  return isRecord(own) ? own : undefined;
}

/**
 * Vue d'un canal tenue à partir des trames `realtime:presence` — la règle pure
 * applied / gap / stale (RFC 5263 §4.5) appliquée à une `Map` (aucune clé héritée,
 * `__proto__` sans effet).
 *
 * - Une trame COMPLÈTE (liste ou nombres seuls) remplace la vue et prend sa version
 *   pour référence, demandée ou non (RFC 5262 §4).
 * - Une trame de CHANGEMENTS s'applique seulement si `classifyNumberedChange` rend
 *   `applied`. Sur `gap`, rien n'est appliqué et la vue devient NON SYNCHRONISÉE :
 *   elle reste affichée, marquée `partial`, et rend `gap` à tout changement jusqu'à la
 *   prochaine trame complète. `stale` : jetée.
 *
 * Coût : la `Map` est modifiée en place tant que personne n'a pris d'instantané ; dès
 * qu'un instantané l'a exposée, le changement suivant la copie d'abord (copie à
 * l'écriture) — un instantané rendu ne change donc jamais, et une vue que personne ne lit
 * ne copie rien.
 */
export class PresenceView {
  /** Nom EXACT du canal suivi — une trame d'un autre canal est refusée. */
  readonly channel: string;
  #reference: number | null = null;
  #ready = false;
  #count = 0;
  #unnamed = 0;
  #partial = false;
  #members = new Map<string, IPresenceEntry>();
  /** La `Map` courante a été exposée par un instantané : la copier avant d'y écrire. */
  #shared = false;
  #snapshot: IPresenceSnapshot | null = null;

  /**
   * @param channel - nom exact du canal dont la vue lit les trames.
   */
  constructor(channel: string) {
    this.channel = channel;
  }

  /** `true` quand la vue a une référence de version (une trame complète, sans trou depuis). */
  get synced(): boolean {
    return this.#reference !== null;
  }

  /** Version de la dernière trame appliquée, ou `null` si la vue n'est pas synchronisée. */
  get reference(): number | null {
    return this.#reference;
  }

  /**
   * Applique une trame reconnue par {@link isPresenceFrame}.
   *
   * @param frame - trame de CE canal.
   * @returns `applied` (la vue a changé), `gap` (rien d'appliqué, resynchroniser) ou
   *   `stale` (déjà vue, jetée). Une trame complète rend toujours `applied`.
   * @throws Error si la trame décrit un autre canal — erreur d'aiguillage de l'appelant.
   */
  apply(frame: RealtimePresenceFrame): NumberedChangeOutcome {
    if (frame.channel !== this.channel)
      throw new Error(
        `[nodefony] trame de présence de « ${frame.channel} » appliquée à la vue de « ${this.channel} »`,
      );
    const changes = frame.changes;
    if (changes === undefined) {
      this.#replace(frame.members, frame.states);
    } else {
      const outcome = classifyNumberedChange(this.#reference, frame.version);
      if (outcome !== "applied") {
        if (outcome === "gap") this.unsync();
        return outcome;
      }
      this.#change(changes);
    }
    this.#reference = frame.version;
    this.#ready = true;
    this.#count = frame.count;
    this.#unnamed = frame.unnamed;
    this.#partial = frame.partial === true;
    this.#snapshot = null;
    return "applied";
  }

  /**
   * Retire la référence de version : la vue reste affichée, marquée `partial`, et tout
   * changement y rend `gap` jusqu'à la prochaine trame complète. À appeler à la fermeture
   * de la socket et à chaque `subscribe` émis (ADR-0025 P2 bis) — reconnecté sur un autre
   * pod, un changement pourrait sinon tomber par hasard sur le numéro attendu.
   *
   * @returns `true` si l'instantané a changé (la vue était synchronisée).
   */
  unsync(): boolean {
    if (this.#reference === null) return false;
    this.#reference = null;
    this.#snapshot = null;
    return true;
  }

  /** Instantané immuable de la vue — le même objet tant qu'elle ne change pas. */
  snapshot(): IPresenceSnapshot {
    let snap = this.#snapshot;
    if (snap === null) {
      const ready = this.#ready;
      snap = {
        ready,
        count: this.#count,
        unnamed: this.#unnamed,
        members: this.#members,
        partial: this.#partial || (ready && this.#reference === null),
      };
      this.#shared = true;
      this.#snapshot = snap;
    }
    return snap;
  }

  /** `Map` modifiable : la courante, ou sa copie si un instantané l'expose. */
  #writable(): Map<string, IPresenceEntry> {
    if (this.#shared) {
      this.#members = new Map(this.#members);
      this.#shared = false;
    }
    return this.#members;
  }

  /** Remplace la vue par une trame complète (liste, ou nombres seuls si `pairs` absent). */
  #replace(
    pairs: PresencePairs | undefined,
    states: PresenceStates | undefined,
  ): void {
    const previous = this.#members;
    // Une liste neuve : on ne recopie pas l'ancienne pour la vider. Les entrées
    // inchangées sont reprises telles quelles (immuables).
    const next = new Map<string, IPresenceEntry>();
    if (pairs !== undefined) {
      for (let i = 0; i < pairs.length; i += 2) {
        const id = pairs[i];
        const tabs = pairs[i + 1];
        if (typeof id !== "string" || typeof tabs !== "number") continue;
        next.set(id, entryOf(previous.get(id), tabs, statesOf(states, id)));
      }
    }
    this.#members = next;
    this.#shared = false;
  }

  /** Applique un bloc `changes` déjà classé `applied`. */
  #change(changes: IRealtimePresenceChanges): void {
    const { set, gone, states } = changes;
    if (set === undefined && gone === undefined) return;
    const members = this.#writable();
    if (gone !== undefined) for (const id of gone) members.delete(id);
    if (set !== undefined) {
      for (let i = 0; i < set.length; i += 2) {
        const id = set[i];
        const tabs = set[i + 1];
        if (typeof id !== "string" || typeof tabs !== "number") continue;
        members.set(id, entryOf(members.get(id), tabs, statesOf(states, id)));
      }
    }
  }
}
