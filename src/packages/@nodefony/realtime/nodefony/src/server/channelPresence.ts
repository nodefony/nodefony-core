import type {
  IChannelPolicy,
  IPresenceEntry,
  IRealtimePresenceChanges,
  IRealtimePresenceCount,
  IRealtimePresenceList,
  RealtimePresenceFrame,
} from "nodefony";
import { isRecord } from "../guards";
import type { ChannelFrame } from "./RealtimeHub";

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
 */
export class ChannelPresence {
  readonly channel: string;
  readonly settings: IPresenceSettings;
  /** Fin de la fenêtre de regroupement en cours (horloge monotone, ms). */
  windowEnd = Number.NEGATIVE_INFINITY;
  /** Liste complète encodée, servie telle quelle jusqu'au prochain envoi. */
  listFrame: ChannelFrame | null = null;
  /** Le canal est-il encore tenu par le hub ? `false` après son retrait. */
  live = true;
  readonly #named = new Map<string, number>();
  #unnamed = 0;
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

  constructor(channel: string, settings: IPresenceSettings) {
    this.channel = channel;
    this.settings = settings;
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
    if (key === null) {
      this.#unnamed += 1;
      this.#countsDirty = true;
      return;
    }
    // Revenue pendant sa grâce : son départ n'a jamais été publié, rien ne change.
    if (this.#leaving?.delete(key) === true) return;
    this.#named.set(key, (this.#named.get(key) ?? 0) + 1);
    this.#markDirty(key);
  }

  /**
   * Une connexion sort.
   *
   * @param key - même valeur qu'à {@link ChannelPresence.join}.
   * @param now - instant monotone (ms), pour la grâce.
   */
  leave(key: string | null, now: number): void {
    const grace = this.settings.grace;
    if (key === null) {
      if (grace > 0) (this.#unnamedLeaving ??= []).push(now + grace);
      else {
        this.#unnamed -= 1;
        this.#countsDirty = true;
      }
      return;
    }
    const tabs = this.#named.get(key);
    if (tabs === undefined) return;
    if (tabs > 1) {
      this.#named.set(key, tabs - 1);
      this.#markDirty(key);
      return;
    }
    if (grace > 0) {
      (this.#leaving ??= new Map<string, number>()).set(key, now + grace);
      return;
    }
    this.#named.delete(key);
    this.#markDirty(key);
  }

  /** Publie les départs dont la grâce est écoulée. */
  expire(now: number): void {
    const leaving = this.#leaving;
    if (leaving !== null) {
      // Échéances croissantes : on s'arrête à la première non échue.
      for (const [key, deadline] of leaving) {
        if (deadline > now) break;
        leaving.delete(key);
        this.#named.delete(key);
        this.#markDirty(key);
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
    if (count > this.settings.maxNamed) {
      return {
        channel: this.channel,
        version: this.#version,
        count,
        unnamed: this.#unnamed,
      };
    }
    // Taille connue : un tableau pré-dimensionné, rempli en place.
    const members = new Array<string | number>(count * 2);
    let i = 0;
    for (const [key, tabs] of named) {
      members[i++] = key;
      members[i++] = tabs;
    }
    return {
      channel: this.channel,
      version: this.#version,
      count,
      unnamed: this.#unnamed,
      members,
    };
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
    return {
      channel: this.channel,
      version: this.#version,
      count: this.#named.size,
      unnamed: this.#unnamed,
      changes,
    };
  }

  /** Vue de l'observateur serveur : les membres toujours, une copie. */
  view(): IChannelPresenceView {
    const members = new Map<string, IPresenceEntry>();
    for (const [key, tabs] of this.#named) members.set(key, { tabs });
    return {
      count: this.#named.size,
      unnamed: this.#unnamed,
      members,
      partial: false,
    };
  }

  #markDirty(key: string): void {
    (this.#dirty ??= new Set<string>()).add(key);
  }
}
