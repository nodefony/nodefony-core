import type {
  IChannelPolicy,
  IPresenceEntry,
  IRealtimePresenceChanges,
  IRealtimePresenceCount,
  IRealtimePresenceList,
  RealtimePresenceFrame,
} from "nodefony";
import type {
  IPresenceChannelDelta,
  IPresenceChannelState,
} from "../backplane/presenceMessage";
import { isRecord } from "../guards";
import type { ChannelFrame } from "./RealtimeHub";
import type { IPresenceAggregate } from "./remotePresence";

/**
 * Fenêtre de regroupement des changements de présence vers le navigateur (ms) — front montant : le premier changement d'un canal calme part tout de suite, les suivants attendent la fin de la fenêtre (ADR-0025 P2 bis).
 */
export const PRESENCE_WINDOW_MS = 250;

/** Seuil par défaut d'identités nommées au-delà duquel la trame ne porte que les nombres (ADR-0025 P2 bis). */
export const DEFAULT_PRESENCE_MAX_NAMED = 1000;

const PRESENCE_OPTION_KEYS: ReadonlySet<string> = new Set([
  "grace",
  "maxNamed",
]);

/** Réglages RÉSOLUS de la présence d'un canal — défauts appliqués. */
export interface IPresenceSettings {
  /** Délai de grâce d'un départ (ms), `0` = départs exacts. */
  readonly grace: number;
  /** Identités nommées au-delà desquelles la trame ne porte que les nombres. */
  readonly maxNamed: number;
}

/**
 * Ce qu'un observateur serveur lit de la présence d'un canal (`hub.presence()`, ADR-0025 P3) — les membres TOUJOURS, quel que soit le seuil de la trame.
 */
export interface IChannelPresenceView {
  /** Identités nommées distinctes présentes (comptes seulement). */
  readonly count: number;
  /** Connexions comptées sans être nommées (anonymes, appelants machine sans compte). */
  readonly unnamed: number;
  /** Les présents nommés : identité → onglets. */
  readonly members: ReadonlyMap<string, IPresenceEntry>;
  /** `true` si la vue est connue incomplète ou figée. */
  readonly partial: boolean;
}

/**
 * Départ d'un PAIR retenu par la grâce (pod oublié, arrêté, remplacé) — ses onglets restent comptés jusqu'à l'échéance. Forme fixe : alloué au seul départ d'un pod, chemin froid.
 */
class RemoteDeparture {
  readonly deadline: number;
  tabs: number;

  constructor(deadline: number, tabs: number) {
    this.deadline = deadline;
    this.tabs = tabs;
  }
}

/** Entier sûr ≥ 0 ? */
function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/**
 * Défaut de la valeur de la clé `presence` d'une politique, ou `null` si elle est recevable — en clair, pour que le refus au démarrage dise QUOI corriger.
 *
 * @param value - valeur de `policy.presence` (`unknown` : une politique se lit
 *   depuis une métadonnée publique).
 */
export function presenceDefect(value: unknown): string | null {
  if (value === undefined || typeof value === "boolean") return null;
  if (!isRecord(value) || Array.isArray(value))
    return "« presence » doit être un booléen ou un objet d'options";
  for (const key of Object.keys(value)) {
    if (!PRESENCE_OPTION_KEYS.has(key)) {
      return (
        `« presence » : option inconnue « ${key} » (options admises : ` +
        `${[...PRESENCE_OPTION_KEYS].join(", ")})`
      );
    }
  }
  if (value.grace !== undefined && !isCount(value.grace))
    return "« presence.grace » doit être un entier de millisecondes ≥ 0";
  if (value.maxNamed !== undefined && !isCount(value.maxNamed))
    return "« presence.maxNamed » doit être un entier ≥ 0";
  return null;
}

/**
 * Réglages résolus de la présence qu'une politique déclare, ou `null` si elle n'en déclare pas.
 *
 * Précondition : la politique a passé {@link presenceDefect}.
 */
export function presenceSettingsOf(
  policy: IChannelPolicy | null | undefined,
): IPresenceSettings | null {
  const presence = policy?.presence;
  if (presence === undefined || presence === false) return null;
  if (presence === true)
    return { grace: 0, maxNamed: DEFAULT_PRESENCE_MAX_NAMED };
  return {
    grace: presence.grace ?? 0,
    maxNamed: presence.maxNamed ?? DEFAULT_PRESENCE_MAX_NAMED,
  };
}

/**
 * Deux politiques déclarent-elles la même présence ? Défauts appliqués : `true` et `{ grace: 0 }` sont la même.
 *
 * Sert à refuser deux déclarations d'un même nom qui ne diffèrent que par la
 * présence — une seule s'appliquerait. Démarrage seulement.
 */
export function samePresence(a: IChannelPolicy, b: IChannelPolicy): boolean {
  const x = presenceSettingsOf(a);
  const y = presenceSettingsOf(b);
  if (x === null || y === null) return x === y;
  return x.grace === y.grace && x.maxNamed === y.maxNamed;
}

/**
 * État de présence LOCAL d'un canal à présence (ADR-0025 P2 bis, P5) — identités nommées et onglets, connexions non nommées, version, changements en attente de la fenêtre, départs en grâce.
 *
 * Alloué au premier client d'un canal qui déclare `presence`, jamais pour un
 * autre canal. Ne connaît ni l'horloge ni le protocole : le hub lui passe
 * l'instant et fabrique les trames. Les changements portent des valeurs
 * ABSOLUES (nombre d'onglets, départ), donc rejouer un changement déjà inclus
 * dans une liste ne change rien — c'est ce qui permet de servir à un nouvel
 * abonné la liste prise au dernier envoi, encodée une fois.
 *
 * Sur un canal DIFFUSÉ entre pods, c'est aussi l'agrégat de la vue des pairs
 * ({@link IPresenceAggregate}) : les compteurs portent le TOTAL (local + pairs),
 * et une table à part garde la seule part locale — ce que ce pod annonce à ses
 * pairs, en deltas par lot. Ailleurs, cette table n'existe pas.
 */
export class ChannelPresence implements IPresenceAggregate {
  readonly channel: string;
  readonly settings: IPresenceSettings;
  /** Canal diffusé entre pods : sa part locale part sur le bus, la vue des pairs s'y ajoute. */
  readonly distributed: boolean;
  /** Fin de la fenêtre de regroupement en cours (horloge monotone, ms). */
  windowEnd = Number.NEGATIVE_INFINITY;
  /** Liste complète encodée, servie telle quelle jusqu'au prochain envoi. */
  listFrame: ChannelFrame | null = null;
  /** Le canal est-il encore tenu par le hub ? `false` après son retrait. */
  live = true;
  /**
   * Fin de la synchronisation initiale avec les pairs (ms monotone) — la vue
   * n'est que locale tant que la demande d'état du premier abonné n'a pas eu le
   * temps d'être servie ; `0` = synchronisée (ou canal non diffusé).
   */
  syncUntil = 0;
  // Identités nommées → onglets, TOUS pods confondus.
  readonly #named = new Map<string, number>();
  #unnamed = 0;
  // Part LOCALE d'un canal diffusé (identité → onglets de CE pod) ; `null`
  // ailleurs : un canal local ne paie aucune seconde table.
  readonly #local: Map<string, number> | null;
  #localUnnamed = 0;
  // Pour le prochain lot du bus : identité → onglets locaux au DERNIER lot (la
  // valeur d'avant le premier changement de la fenêtre). Une arrivée suivie d'un
  // départ dans la même fenêtre retrouve sa valeur d'avant : rien ne part
  // (annulation à la source). `-1` = non nommés inchangés.
  #busBefore: Map<string, number> | null = null;
  #busUnnamedBefore = -1;
  #partial = false;
  #version = 0;
  #dirty: Set<string> | null = null;
  #countsDirty = false;
  // La dernière trame complète nommait-elle les présents ? Au retour sous le
  // seuil, la vue cliente est vide d'identités : la liste est due à tous.
  #namedSent = true;
  // Départs retenus par la grâce — `null` tant qu'aucun. UNE grâce par canal
  // et une horloge monotone : l'ordre d'insertion EST l'ordre des échéances,
  // donc la première entrée est la prochaine (O(1), jamais un parcours par
  // départ — un pod qui redémarre en fait mille d'un coup).
  #leaving: Map<string, number> | null = null;
  #unnamedLeaving: number[] | null = null;
  #unnamedHead = 0;
  // Départs d'un PAIR retenus par la grâce — même ordre (une grâce par canal,
  // horloge monotone) ; tenus à part des départs locaux : ils ne touchent pas la
  // part locale et peuvent porter plusieurs onglets.
  #remoteLeaving: Map<string, RemoteDeparture> | null = null;
  // Non nommés d'un pair parti, en paires à plat `[échéance, nombre, …]`.
  #remoteUnnamedLeaving: number[] | null = null;
  #remoteUnnamedHead = 0;

  /**
   * @param distributed - le canal est diffusé entre pods (bus branché, préfixe
   *   diffusé) : la part locale est tenue à part pour le bus.
   */
  constructor(
    channel: string,
    settings: IPresenceSettings,
    distributed = false,
  ) {
    this.channel = channel;
    this.settings = settings;
    this.distributed = distributed;
    this.#local = distributed ? new Map<string, number>() : null;
  }

  /** La part locale a-t-elle changé depuis le dernier lot ? */
  get busDirty(): boolean {
    return this.#busBefore !== null || this.#busUnnamedBefore >= 0;
  }

  /** La vue est-elle connue incomplète (synchronisation initiale, trou chez un pair) ? */
  get partial(): boolean {
    return this.#partial;
  }

  /** Version courante de la vue (+1 par trame de changements). */
  get version(): number {
    return this.#version;
  }

  /** Des changements attendent-ils un envoi ? */
  get dirty(): boolean {
    return this.#dirty !== null || this.#countsDirty;
  }

  /**
   * Une connexion entre.
   *
   * @param key - identité nommée, ou `null` pour une connexion non nommée.
   */
  join(key: string | null): void {
    const local = this.#local;
    if (key === null) {
      this.#unnamed += 1;
      this.#countsDirty = true;
      if (local !== null) this.#addLocalUnnamed(1);
      return;
    }
    // Revenue pendant sa grâce : son départ n'a jamais été publié, rien ne change.
    if (this.#leaving?.delete(key) === true) return;
    const named = this.#named;
    const before = named.get(key) ?? 0;
    // Revenue ici pendant la grâce d'un pair parti : ses onglets là-bas tombent,
    // celui-ci s'ajoute — aucun départ publié entre les deux.
    const total = before - this.#cancelRemoteDeparture(key) + 1;
    named.set(key, total);
    if (total !== before) this.#markDirty(key);
    if (local !== null) this.#setLocal(local, key, (local.get(key) ?? 0) + 1);
  }

  /**
   * Une connexion sort.
   *
   * @param key - même valeur qu'à {@link ChannelPresence.join}.
   * @param now - instant monotone (ms), pour la grâce.
   */
  leave(key: string | null, now: number): void {
    const grace = this.settings.grace;
    const local = this.#local;
    if (key === null) {
      if (grace > 0) (this.#unnamedLeaving ??= []).push(now + grace);
      else {
        this.#unnamed -= 1;
        this.#countsDirty = true;
        if (local !== null) this.#addLocalUnnamed(-1);
      }
      return;
    }
    const tabs = this.#named.get(key);
    if (tabs === undefined) return;
    if (tabs > 1) {
      // Encore présente (autre onglet, ici ou chez un pair) : aucun départ,
      // donc aucune grâce — seule la part locale baisse.
      this.#named.set(key, tabs - 1);
      this.#markDirty(key);
      if (local !== null) {
        const mine = local.get(key) ?? 0;
        if (mine > 0) this.#setLocal(local, key, mine - 1);
      }
      return;
    }
    if (grace > 0) {
      (this.#leaving ??= new Map<string, number>()).set(key, now + grace);
      return;
    }
    this.#named.delete(key);
    this.#markDirty(key);
    if (local !== null) this.#setLocal(local, key, 0);
  }

  /** Publie les départs dont la grâce est écoulée. */
  expire(now: number): void {
    const leaving = this.#leaving;
    const local = this.#local;
    if (this.#remoteLeaving !== null || this.#remoteUnnamedLeaving !== null)
      this.#expireRemote(now);
    if (leaving !== null) {
      // Échéances croissantes : on s'arrête à la première non échue.
      for (const [key, deadline] of leaving) {
        if (deadline > now) break;
        leaving.delete(key);
        this.#named.delete(key);
        this.#markDirty(key);
        if (local !== null) this.#setLocal(local, key, 0);
      }
      if (leaving.size === 0) this.#leaving = null;
    }
    const queue = this.#unnamedLeaving;
    if (queue !== null) {
      let head = this.#unnamedHead;
      const from = head;
      while (head < queue.length && (queue[head] ?? 0) <= now) head += 1;
      if (head > from) {
        this.#unnamed -= head - from;
        this.#countsDirty = true;
        if (local !== null) this.#addLocalUnnamed(from - head);
      }
      if (head === queue.length) {
        this.#unnamedLeaving = null;
        this.#unnamedHead = 0;
      } else if (head > 1024 && head * 2 > queue.length) {
        // Compactage amorti : la tête consommée ne grossit pas sans fin.
        queue.splice(0, head);
        this.#unnamedHead = 0;
      } else this.#unnamedHead = head;
    }
  }

  /** Prochaine échéance de grâce (ms monotone), `Infinity` sans départ retenu — O(1). */
  nextDeadline(): number {
    let next = Number.POSITIVE_INFINITY;
    if (this.#leaving !== null) {
      for (const deadline of this.#leaving.values()) {
        next = deadline; // la première est la plus proche
        break;
      }
    }
    const first = this.#unnamedLeaving?.[this.#unnamedHead];
    if (first !== undefined && first < next) next = first;
    if (this.#remoteLeaving !== null) {
      for (const departure of this.#remoteLeaving.values()) {
        if (departure.deadline < next) next = departure.deadline;
        break;
      }
    }
    const remote = this.#remoteUnnamedLeaving?.[this.#remoteUnnamedHead];
    if (remote !== undefined && remote < next) next = remote;
    return next;
  }

  /**
   * Trame complète à la version COURANTE — la liste, ou les nombres seuls au-delà du seuil.
   *
   * Une liste ne prend jamais de numéro : servie à un nouvel abonné, elle ferait
   * voir un trou à tous les autres (ADR-0025 P2 bis).
   */
  listParams(): IRealtimePresenceList | IRealtimePresenceCount {
    const named = this.#named;
    const count = named.size;
    const channel = this.channel;
    const version = this.#version;
    const unnamed = this.#unnamed;
    // Littéraux construits d'un bloc (forme stable) ; `partial` n'est posé qu'à
    // `true`, cas rare.
    if (count > this.settings.maxNamed) {
      return this.#partial
        ? { channel, version, count, unnamed, partial: true }
        : { channel, version, count, unnamed };
    }
    const members = pairsOf(named);
    return this.#partial
      ? { channel, version, count, unnamed, members, partial: true }
      : { channel, version, count, unnamed, members };
  }

  /**
   * Consomme les changements en attente et rend la trame à envoyer à tous les membres, ou `null` s'il n'y en a pas.
   *
   * Sous le seuil : les changements, version +1. Au-delà : les nombres seuls,
   * version inchangée (trame complète). Au retour sous le seuil : la liste.
   * Toute trame envoyée périme la liste encodée.
   */
  takeChanges(): RealtimePresenceFrame | null {
    if (!this.dirty) return null;
    const dirty = this.#dirty;
    this.#dirty = null;
    this.#countsDirty = false;
    this.listFrame = null;
    const named = this.#named.size <= this.settings.maxNamed;
    if (!named || !this.#namedSent) {
      this.#namedSent = named;
      return this.listParams();
    }
    this.#version += 1;
    let set: (string | number)[] | null = null;
    let gone: string[] | null = null;
    if (dirty !== null) {
      for (const key of dirty) {
        const tabs = this.#named.get(key);
        if (tabs === undefined) (gone ??= []).push(key);
        else (set ??= []).push(key, tabs);
      }
    }
    // Littéral construit d'un bloc : forme d'objet stable, aucune clé ajoutée après coup.
    const changes: IRealtimePresenceChanges =
      set === null
        ? gone === null
          ? {}
          : { gone }
        : gone === null
          ? { set }
          : { set, gone };
    const channel = this.channel;
    const version = this.#version;
    const count = this.#named.size;
    const unnamed = this.#unnamed;
    return this.#partial
      ? { channel, version, count, unnamed, changes, partial: true }
      : { channel, version, count, unnamed, changes };
  }

  /** Vue de l'observateur serveur : les membres toujours, une copie. */
  view(): IChannelPresenceView {
    const members = new Map<string, IPresenceEntry>();
    for (const [key, tabs] of this.#named) members.set(key, { tabs });
    return {
      count: this.#named.size,
      unnamed: this.#unnamed,
      members,
      partial: this.#partial,
    };
  }

  /**
   * Pose l'état « incomplet » de la vue ; un changement fait partir une trame (la version suit) et périme la liste encodée.
   */
  setPartial(partial: boolean): void {
    if (partial === this.#partial) return;
    this.#partial = partial;
    this.#countsDirty = true;
    this.listFrame = null;
  }

  /** {@inheritDoc IPresenceAggregate.remoteTabs} */
  remoteTabs(key: string, delta: number): void {
    const named = this.#named;
    const before = named.get(key) ?? 0;
    let total = before;
    // Départ local retenu par la grâce, et l'identité est là chez un pair :
    // elle est restée présente, le départ local prend effet sans être publié.
    if (delta > 0) {
      if (this.#leaving?.delete(key) === true) {
        total -= 1;
        const local = this.#local;
        if (local !== null) this.#setLocal(local, key, 0);
      } else total -= this.#cancelRemoteDeparture(key);
    }
    total += delta;
    if (total > 0) named.set(key, total);
    else named.delete(key);
    if (total !== before) this.#markDirty(key);
  }

  /** {@inheritDoc IPresenceAggregate.remoteUnnamed} */
  remoteUnnamed(delta: number): void {
    this.#unnamed += delta;
    this.#countsDirty = true;
  }

  /** {@inheritDoc IPresenceAggregate.remoteLeave} */
  remoteLeave(key: string, tabs: number, now: number): void {
    const grace = this.settings.grace;
    // Encore présente ailleurs (ici ou chez un autre pair) : aucun départ, aucune grâce.
    if (grace === 0 || (this.#named.get(key) ?? 0) > tabs) {
      this.remoteTabs(key, -tabs);
      return;
    }
    const leaving = (this.#remoteLeaving ??= new Map<
      string,
      RemoteDeparture
    >());
    const pending = leaving.get(key);
    if (pending !== undefined) pending.tabs += tabs;
    else leaving.set(key, new RemoteDeparture(now + grace, tabs));
  }

  /** {@inheritDoc IPresenceAggregate.remoteUnnamedLeave} */
  remoteUnnamedLeave(count: number, now: number): void {
    const grace = this.settings.grace;
    if (grace === 0) this.remoteUnnamed(-count);
    else (this.#remoteUnnamedLeaving ??= []).push(now + grace, count);
  }

  /**
   * Consomme les changements de la part locale depuis le dernier lot et rend l'entrée du lot, en valeurs absolues — `null` s'ils s'annulent tous.
   */
  takeBusDelta(): IPresenceChannelDelta | null {
    const local = this.#local;
    const before = this.#busBefore;
    const unnamedBefore = this.#busUnnamedBefore;
    this.#busBefore = null;
    this.#busUnnamedBefore = -1;
    if (local === null) return null;
    let set: (string | number)[] | null = null;
    let gone: string[] | null = null;
    if (before !== null) {
      for (const [key, was] of before) {
        const tabs = local.get(key) ?? 0;
        if (tabs === was) continue;
        if (tabs === 0) (gone ??= []).push(key);
        else (set ??= []).push(key, tabs);
      }
    }
    const unnamed = this.#localUnnamed;
    if (
      set === null &&
      gone === null &&
      (unnamedBefore < 0 || unnamedBefore === unnamed)
    )
      return null;
    return { channel: this.channel, set, gone, unnamed };
  }

  /** État COMPLET de la part locale, pour une réponse d'état (paires à plat). */
  localState(): IPresenceChannelState {
    const local = this.#local;
    return {
      channel: this.channel,
      members: local === null ? [] : pairsOf(local),
      unnamed: this.#localUnnamed,
    };
  }

  /** La part locale compte-t-elle quelqu'un ? */
  get hasLocal(): boolean {
    return (this.#local?.size ?? 0) > 0 || this.#localUnnamed > 0;
  }

  /**
   * Le canal n'est plus servi ici : toute la part locale part à zéro au prochain lot, pour que les pairs ne gardent aucun fantôme.
   */
  release(): void {
    const local = this.#local;
    if (local === null) return;
    // Retirer l'entrée courante d'une `Map` pendant son parcours est sûr : aucune copie.
    for (const key of local.keys()) this.#setLocal(local, key, 0);
    this.#leaving = null;
    if (this.#localUnnamed !== 0) this.#addLocalUnnamed(-this.#localUnnamed);
    this.#unnamedLeaving = null;
    this.#unnamedHead = 0;
    this.#remoteLeaving = null;
    this.#remoteUnnamedLeaving = null;
    this.#remoteUnnamedHead = 0;
  }

  /** Annule le départ en grâce d'un pair pour `key` ; rend les onglets qu'il retenait (`0` sans départ). */
  #cancelRemoteDeparture(key: string): number {
    const leaving = this.#remoteLeaving;
    if (leaving === null) return 0;
    const departure = leaving.get(key);
    if (departure === undefined) return 0;
    leaving.delete(key);
    if (leaving.size === 0) this.#remoteLeaving = null;
    return departure.tabs;
  }

  /** Départs de pairs dont la grâce est écoulée — échéances croissantes, arrêt à la première non échue. */
  #expireRemote(now: number): void {
    const leaving = this.#remoteLeaving;
    if (leaving !== null) {
      const named = this.#named;
      for (const [key, departure] of leaving) {
        if (departure.deadline > now) break;
        leaving.delete(key);
        const total = (named.get(key) ?? 0) - departure.tabs;
        if (total > 0) named.set(key, total);
        else named.delete(key);
        this.#markDirty(key);
      }
      if (leaving.size === 0) this.#remoteLeaving = null;
    }
    const queue = this.#remoteUnnamedLeaving;
    if (queue === null) return;
    let head = this.#remoteUnnamedHead;
    let gone = 0;
    while (head < queue.length && (queue[head] ?? 0) <= now) {
      gone += queue[head + 1] ?? 0;
      head += 2;
    }
    if (gone !== 0) {
      this.#unnamed -= gone;
      this.#countsDirty = true;
    }
    if (head >= queue.length) {
      this.#remoteUnnamedLeaving = null;
      this.#remoteUnnamedHead = 0;
    } else this.#remoteUnnamedHead = head;
  }

  #markDirty(key: string): void {
    (this.#dirty ??= new Set<string>()).add(key);
  }

  /** Pose les onglets LOCAUX d'une identité, en retenant la valeur du dernier lot. */
  #setLocal(local: Map<string, number>, key: string, tabs: number): void {
    const before = local.get(key) ?? 0;
    if (tabs === before) return;
    const pending = (this.#busBefore ??= new Map<string, number>());
    if (!pending.has(key)) pending.set(key, before);
    if (tabs === 0) local.delete(key);
    else local.set(key, tabs);
  }

  #addLocalUnnamed(delta: number): void {
    if (this.#busUnnamedBefore < 0) this.#busUnnamedBefore = this.#localUnnamed;
    this.#localUnnamed += delta;
  }
}

/** Paires à plat `[identité, onglets, …]` d'une table — tableau pré-dimensionné, rempli en place. */
function pairsOf(table: ReadonlyMap<string, number>): (string | number)[] {
  const pairs = new Array<string | number>(table.size * 2);
  let i = 0;
  for (const [key, tabs] of table) {
    pairs[i++] = key;
    pairs[i++] = tabs;
  }
  return pairs;
}
