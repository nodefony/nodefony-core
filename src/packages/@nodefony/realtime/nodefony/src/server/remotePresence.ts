import { classifyNumberedChange } from "nodefony";
import type { PresencePairs } from "nodefony";
import {
  MAX_PRESENCE_MEMBERS,
  type IPresenceAlive,
  type IPresenceBatch,
  type IPresenceChannelState,
  type IPresenceRequest,
  type IPresenceStatePart,
  type PresenceMessage,
} from "../backplane/presenceMessage";

/**
 * Agrégat d'un canal servi par ce pod — ce que la vue distante ajuste quand la présence d'un pair change (ADR-0025 P2).
 *
 * Les deux méthodes reçoivent un DELTA : la vue distante range ce que chaque
 * pod annonce (valeurs absolues) et ne transmet que la différence, si bien que
 * l'agrégat n'a jamais à reparcourir les pods.
 */
export interface IPresenceAggregate {
  /**
   * L'identité a `delta` onglets de plus (négatif : de moins) chez les pairs.
   *
   * @param key - identité nommée.
   * @param delta - entier non nul.
   */
  remoteTabs(key: string, delta: number): void;
  /**
   * Les pairs comptent `delta` connexions non nommées de plus (négatif : de moins).
   *
   * @param delta - entier non nul.
   */
  remoteUnnamed(delta: number): void;
  /**
   * Un pair PART (oublié, arrêt propre, vie remplacée) avec les `tabs` onglets de l'identité qu'il annonçait — retenu par la grâce du canal s'il en déclare une (ADR-0025 P5), annulé si l'identité revient pendant ce délai.
   *
   * @param key - identité nommée.
   * @param tabs - onglets retirés, entier > 0.
   * @param now - instant monotone local (ms).
   */
  remoteLeave(key: string, tabs: number, now: number): void;
  /**
   * Un pair part avec `count` connexions non nommées — décompte retardé par la grâce du canal.
   *
   * @param count - entier > 0.
   * @param now - instant monotone local (ms).
   */
  remoteUnnamedLeave(count: number, now: number): void;
}

/**
 * Résout un canal reçu du bus : son agrégat s'il est SERVI ici, `null` s'il déclare la présence sans être servi (lu puis jeté, sans stockage), `false` s'il ne déclare pas la présence sur ce pod (refusé, compté).
 */
export type PresenceAggregateLookup = (
  channel: string,
) => IPresenceAggregate | null | false;

/** Réglages de la vue distante. */
export interface IRemotePresenceOptions {
  /** Résolution d'un canal reçu (cf {@link PresenceAggregateLookup}). */
  readonly lookup: PresenceAggregateLookup;
  /** Délai d'oubli en intervalles ANNONCÉS par le pair (≥ 2, défaut de l'ADR : 3). */
  readonly factor: number;
  /**
   * Intervalle LOCAL (ms) : cadence des demandes répétées pendant un trou, et
   * intervalle supposé d'un pair dont aucune preuve de vie n'est encore arrivée.
   */
  readonly interval: number;
}

/** Ce qu'un pod annonce sur UN canal : identités nommées → onglets, et connexions non nommées. */
class RemoteChannel {
  readonly members = new Map<string, number>();
  unnamed = 0;
}

/**
 * Ce que CE pod sait d'un pair — une vie (`originId`, incarnation), ses numéros, son dernier signe de vie, ses tables par canal.
 *
 * Classe à forme fixe : un pair lu à chaque message, des champs jamais ajoutés
 * après coup.
 */
class RemotePod {
  readonly origin: string;
  incarnation: number;
  /** `seq` du dernier lot appliqué ; `null` = trou (vue à resynchroniser). */
  reference: number | null = null;
  /** Plus haut `seq` vu sur le canal des lots, demandes et réponses. */
  messageSeq = 0;
  /**
   * Plus haut `seq` vu sur le canal de la preuve de vie — relevé À PART : la
   * preuve de vie passe hors quota de la file d'envoi et peut doubler un lot
   * encore en attente ; un relevé commun jetterait ce lot comme un rejeu.
   */
  aliveSeq = 0;
  /** Intervalle ANNONCÉ par le pair (ms). */
  interval: number;
  /** Dernier signe de vie, horloge monotone LOCALE (ms). */
  lastSeen: number;
  /** Instant de la dernière demande d'état pendant un trou ; `-Infinity` = à faire. */
  requestedAt = Number.NEGATIVE_INFINITY;
  /** Canaux nommés par la demande en cours — les réponses ne ferment le trou que si elles les couvrent. */
  asked: readonly string[] | null = null;
  /**
   * Canaux nommés pendant le trou par les réponses au même `last` — elles décrivent le même état, leurs couvertures s'additionnent ; `null` hors trou.
   */
  covered: Set<string> | null = null;
  /** `last` des réponses relevées dans {@link RemotePod.covered}. */
  coveredLast = 0;
  /** Pierre tombale : arrêt propre reçu, plus rien de cette vie ne s'applique. */
  ended = false;
  /** Tables par canal servi ; `null` tant que le pair n'a présenté personne ici. */
  channels: Map<string, RemoteChannel> | null = null;
  // Réponse d'état en cours d'assemblage (parts à `seq` consécutifs).
  partSeq = 0;
  partCount = 0;
  partLast = 0;
  parts: (readonly IPresenceChannelState[])[] | null = null;

  constructor(
    origin: string,
    incarnation: number,
    interval: number,
    now: number,
  ) {
    this.origin = origin;
    this.incarnation = incarnation;
    this.interval = interval;
    this.lastSeen = now;
  }
}

/** Entrées d'une table, retirées de l'agrégat quand le pod PART (grâce du canal comprise). */
function withdraw(
  table: RemoteChannel,
  aggregate: IPresenceAggregate,
  now: number,
): void {
  for (const [key, tabs] of table.members)
    aggregate.remoteLeave(key, tabs, now);
  if (table.unnamed !== 0) aggregate.remoteUnnamedLeave(table.unnamed, now);
}

/** Un canal nommé par une réponse d'état, pendant son application. */
interface IPendingState {
  readonly aggregate: IPresenceAggregate;
  /** Table à mettre à jour ; `null` = canal refusé (plafond). */
  table: RemoteChannel | null;
  /** Identités nommées par la réponse pour ce canal, toutes parts confondues. */
  count: number;
  /** Non nommés : la valeur de la dernière entrée du canal. */
  unnamed: number;
}

/**
 * Pose les paires à plat `[identité, onglets, …]` dans `table`, EN PLACE — une lecture par membre, l'agrégat n'est appelé que si le nombre d'onglets change.
 */
function upsertPairs(
  table: RemoteChannel,
  pairs: PresencePairs,
  aggregate: IPresenceAggregate,
): void {
  const members = table.members;
  for (let i = 0; i < pairs.length; i += 2) {
    const key = pairs[i];
    const tabs = pairs[i + 1];
    if (typeof key !== "string" || typeof tabs !== "number") continue;
    const old = members.get(key);
    if (old === tabs) continue;
    members.set(key, tabs);
    aggregate.remoteTabs(key, old === undefined ? tabs : tabs - old);
  }
}

/**
 * Retire de `table` les identités qu'une réponse d'état ne nomme plus — chemin RARE : il ne tourne que si la table compte plus d'identités que la réponse n'en nomme.
 *
 * Un émetteur conforme ne nomme jamais deux fois la même identité ; un qui le
 * ferait (il détient alors le secret du bus) peut laisser une entrée jusqu'à
 * l'état suivant ou à l'oubli — rien de plus que ce qu'il peut déjà forger.
 */
function dropAbsentIn(
  table: RemoteChannel,
  channel: string,
  parts: readonly (readonly IPresenceChannelState[])[],
  aggregate: IPresenceAggregate,
): void {
  const named = new Set<string>();
  for (const entries of parts) {
    for (const entry of entries) {
      if (entry.channel !== channel) continue;
      const pairs = entry.members;
      for (let i = 0; i < pairs.length; i += 2) {
        const key = pairs[i];
        if (typeof key === "string") named.add(key);
      }
    }
  }
  const members = table.members;
  for (const [key, tabs] of members) {
    if (named.has(key)) continue;
    members.delete(key);
    aggregate.remoteTabs(key, -tabs);
  }
}

/**
 * Vue de la présence des PAIRS, rangée par pod puis par canal (ADR-0025 P2) — la règle répartie, sans horloge, sans minuteur, sans bus.
 *
 * Elle applique ce que le bus apporte — lots chaînés par `seq`/`prev`, réponses
 * d'état en parts appliquées d'un bloc, preuves de vie —, détecte les trous
 * (règle pure `classifyNumberedChange`, RFC 5263 §4.5), départage les vies d'un
 * même `originId` par l'incarnation, oublie un pair muet au bout de `factor`
 * intervalles ANNONCÉS, et ne transmet aux agrégats que des DELTAS. L'instant
 * (`now`, horloge monotone) est passé à chaque appel : la règle se prouve à
 * l'horloge simulée, au compte exact.
 *
 * Coût : un canal non servi ne stocke rien ; oublier un pod libère ses tables
 * d'un coup ; un message ne parcourt que ses propres entrées. Aucun parcours de
 * tous les pods hors de {@link RemotePresence.expire},
 * {@link RemotePresence.nextDeadline}, {@link RemotePresence.rearm} et
 * {@link RemotePresence.takeRequests}, appelés au tic.
 */
export class RemotePresence {
  readonly #lookup: PresenceAggregateLookup;
  readonly #factor: number;
  readonly #interval: number;
  readonly #pods = new Map<string, RemotePod>();
  #gaps = 0;
  #rejectedTotal = 0;
  #staleTotal = 0;
  #forgottenTotal = 0;
  #gapTotal = 0;
  #endedTotal = 0;
  // Plus proche échéance d'oubli apparue depuis le dernier relevé du porteur.
  #closer = Number.POSITIVE_INFINITY;

  /**
   * @throws RangeError si `factor` < 2 (Phoenix Tracker exige le même plancher :
   *   sous deux intervalles, une seule preuve de vie retardée fait oublier un pair
   *   vivant) ou si `interval` n'est pas un entier > 0.
   */
  constructor(options: IRemotePresenceOptions) {
    if (!Number.isSafeInteger(options.factor) || options.factor < 2)
      throw new RangeError(
        `présence : le délai d'oubli doit valoir au moins 2 intervalles (reçu ${String(options.factor)})`,
      );
    if (!Number.isSafeInteger(options.interval) || options.interval <= 0)
      throw new RangeError(
        `présence : l'intervalle doit être un entier de millisecondes > 0 (reçu ${String(options.interval)})`,
      );
    this.#lookup = options.lookup;
    this.#factor = options.factor;
    this.#interval = options.interval;
  }

  /** Pairs connus (pierres tombales comprises). */
  get size(): number {
    return this.#pods.size;
  }

  /** Pairs dont la vue est en trou — la présence servie est alors `partial`. */
  get gaps(): number {
    return this.#gaps;
  }

  /** Messages refusés : canal non déclaré à présence ici, plafond dépassé (`presenceRejectedTotal`). */
  get rejectedTotal(): number {
    return this.#rejectedTotal;
  }

  /** Messages déjà vus ou d'une vie plus ancienne (`presenceStaleDiscardedTotal`). */
  get staleTotal(): number {
    return this.#staleTotal;
  }

  /** Pairs oubliés faute de signe de vie. */
  get forgottenTotal(): number {
    return this.#forgottenTotal;
  }

  /** Arrêts propres reçus (preuve de vie `final`) — présents retirés sans attendre l'oubli. */
  get endedTotal(): number {
    return this.#endedTotal;
  }

  /** Trous ouverts depuis le début (lot perdu, pair inconnu, vie neuve). */
  get gapTotal(): number {
    return this.#gapTotal;
  }

  /**
   * Compte un message de présence REFUSÉ par le lecteur à liste fermée (forme invalide) — même compteur que les refus de la vue.
   */
  countRejected(): void {
    this.#rejectedTotal += 1;
  }

  /**
   * Applique un message du canal des lots, demandes et réponses.
   *
   * @param origin - `originId` de l'émetteur, lu dans l'enveloppe.
   * @param message - message validé par `readPresenceMessage`.
   * @param now - instant monotone local (ms).
   * @returns la demande d'état si le message en est une, FRAÎCHE, à servir par
   *   le répondeur ; `null` sinon.
   */
  receive(
    origin: string,
    message: PresenceMessage,
    now: number,
  ): IPresenceRequest | null {
    const pod = this.#podFor(
      origin,
      message.incarnation,
      message.op === "batch" && message.prev === 0,
      now,
    );
    if (pod === null) return null;
    if (message.seq <= pod.messageSeq) {
      this.#staleTotal += 1;
      return null;
    }
    pod.messageSeq = message.seq;
    pod.lastSeen = now;
    if (message.op === "batch") this.#batch(pod, message);
    else if (message.op === "state") this.#part(pod, message);
    else return message;
    return null;
  }

  /**
   * Applique une preuve de vie.
   *
   * @param origin - `originId` de l'émetteur.
   * @param alive - preuve de vie validée par `readPresenceAlive`.
   * @param now - instant monotone local (ms).
   */
  receiveAlive(origin: string, alive: IPresenceAlive, now: number): void {
    const pod = this.#podFor(origin, alive.incarnation, alive.last === 0, now);
    if (pod === null) return;
    if (alive.seq <= pod.aliveSeq) {
      this.#staleTotal += 1;
      return;
    }
    pod.aliveSeq = alive.seq;
    pod.lastSeen = now;
    pod.interval = alive.interval;
    // Un intervalle annoncé plus court que celui supposé rapproche l'échéance.
    this.#closerAt(now + this.#factor * alive.interval);
    if (alive.final) {
      this.#bury(pod, now);
      return;
    }
    const reference = pod.reference;
    if (reference === null) {
      // Aucun lot jamais émis : l'état du pair est vide, connu sans demande.
      if (alive.last === 0) this.#close(pod, 0);
    } else if (alive.last > reference) this.#openGap(pod);
  }

  /**
   * Pairs à qui demander leur état MAINTENANT — en trou, et pas encore redemandés depuis un intervalle local ; ils sont marqués demandés.
   *
   * @param now - instant monotone local (ms).
   * @param served - canaux à présence servis ici, nommés par la demande ; une
   *   réponse ne ferme le trou que si elle les couvre tous.
   * @returns les `originId` à viser (`to`), `null` s'il n'y en a pas.
   */
  takeRequests(now: number, served: readonly string[]): string[] | null {
    if (this.#gaps === 0) return null;
    let out: string[] | null = null;
    for (const pod of this.#pods.values()) {
      if (pod.reference !== null || pod.ended) continue;
      if (now - pod.requestedAt < this.#interval) continue;
      pod.requestedAt = now;
      pod.asked = served;
      (out ??= []).push(pod.origin);
    }
    return out;
  }

  /**
   * Oublie les pairs muets depuis `factor` intervalles ANNONCÉS, et retire les pierres tombales échues.
   *
   * @param now - instant monotone local (ms).
   * @returns le nombre de pairs VIVANTS oubliés (hors pierres tombales).
   */
  expire(now: number): number {
    let forgotten = 0;
    for (const pod of this.#pods.values()) {
      if (now - pod.lastSeen < this.#factor * pod.interval) continue;
      if (!pod.ended) {
        this.#withdrawPod(pod, now);
        forgotten += 1;
      }
      this.#pods.delete(pod.origin);
    }
    this.#forgottenTotal += forgotten;
    return forgotten;
  }

  /**
   * Plus proche échéance d'oubli APPARUE depuis le dernier appel — celle d'une preuve de vie, dont l'intervalle annoncé peut être plus court que le local ; `Infinity` sinon. O(1), relevée à chaque réception pour que le porteur avance son tic sans attendre le suivant.
   *
   * Tout autre message recule l'échéance, et celle d'un pair neuf tombe au
   * moins deux intervalles LOCAUX plus loin : le tic suivant la relève à temps.
   * {@link RemotePresence.nextDeadline} reste la valeur exacte, recalculée au tic.
   */
  takeCloserDeadline(): number {
    const at = this.#closer;
    this.#closer = Number.POSITIVE_INFINITY;
    return at;
  }

  /** Prochaine échéance d'oubli (ms monotone), `Infinity` sans pair. */
  nextDeadline(): number {
    let next = Number.POSITIVE_INFINITY;
    for (const pod of this.#pods.values()) {
      const deadline = pod.lastSeen + this.#factor * pod.interval;
      if (deadline < next) next = deadline;
    }
    return next;
  }

  /**
   * Réarme le délai d'oubli de TOUS les pairs — après un tic en retard (récepteur gelé) ou au retour de l'écho (bus revenu).
   *
   * Sans lui, un pod bloqué 20 s oublierait d'un coup tous les pairs vivants
   * dont les preuves de vie attendent encore dans son tampon : les minuteurs
   * passent avant la lecture des sockets (Lifeguard).
   *
   * @param now - instant monotone local (ms).
   */
  rearm(now: number): void {
    for (const pod of this.#pods.values()) pod.lastSeen = now;
  }

  /**
   * Retire un canal de toutes les vues — il n'est plus servi ici (dernier abonné local parti). L'agrégat n'est pas notifié : il disparaît avec le canal.
   */
  dropChannel(channel: string): void {
    for (const pod of this.#pods.values()) {
      const channels = pod.channels;
      if (channels === null) continue;
      channels.delete(channel);
      if (channels.size === 0) pod.channels = null;
    }
  }

  /** Oublie tout, sans notifier les agrégats (arrêt, réinitialisation). */
  clear(): void {
    this.#pods.clear();
    this.#gaps = 0;
    this.#closer = Number.POSITIVE_INFINITY;
  }

  /**
   * Le pair `origin` dans la vie `incarnation`, créé s'il est inconnu ; `null` si le message est d'une vie plus ancienne ou enterrée (compté).
   *
   * @param empty - le message prouve que le pair n'a jamais émis de lot (vue
   *   vide connue sans demande).
   */
  #podFor(
    origin: string,
    incarnation: number,
    empty: boolean,
    now: number,
  ): RemotePod | null {
    let pod = this.#pods.get(origin);
    if (pod !== undefined) {
      if (incarnation === pod.incarnation) {
        if (!pod.ended) return pod;
        this.#staleTotal += 1;
        return null;
      }
      if (incarnation < pod.incarnation) {
        // Une vie plus ancienne ne rafraîchit PAS le signe de vie de la
        // courante : sinon ni l'une ni l'autre ne sortirait jamais.
        this.#staleTotal += 1;
        return null;
      }
      // Vie plus récente (conteneur redémarré sous le même `originId`) :
      // l'ancienne est purgée, la neuve repart d'un trou.
      if (!pod.ended) this.#withdrawPod(pod, now);
      this.#pods.delete(origin);
    }
    pod = new RemotePod(origin, incarnation, this.#interval, now);
    this.#pods.set(origin, pod);
    if (empty) pod.reference = 0;
    else this.#enterGap(pod);
    return pod;
  }

  /** Applique un lot : seulement au numéro attendu, sinon trou (le numéro est retenu). */
  #batch(pod: RemotePod, batch: IPresenceBatch): void {
    const reference = pod.reference;
    if (reference === null) return; // en trou : la réponse d'état réparera
    if (
      classifyNumberedChange(reference, batch.seq, batch.prev) !== "applied"
    ) {
      // `stale` est exclu par `messageSeq` : reste le trou.
      this.#openGap(pod);
      return;
    }
    pod.reference = batch.seq;
    let rejected = false;
    for (const entry of batch.channels) {
      const aggregate = this.#lookup(entry.channel);
      if (aggregate === null) continue;
      if (aggregate === false) {
        rejected = true;
        continue;
      }
      const channels = (pod.channels ??= new Map<string, RemoteChannel>());
      let table = channels.get(entry.channel);
      const set = entry.set;
      if (
        set !== null &&
        (table?.members.size ?? 0) + set.length / 2 > MAX_PRESENCE_MEMBERS
      ) {
        rejected = true;
        continue;
      }
      if (table === undefined) {
        table = new RemoteChannel();
        channels.set(entry.channel, table);
      }
      const members = table.members;
      if (set !== null) {
        for (let i = 0; i < set.length; i += 2) {
          const key = set[i];
          const tabs = set[i + 1];
          if (typeof key !== "string" || typeof tabs !== "number") continue;
          const delta = tabs - (members.get(key) ?? 0);
          members.set(key, tabs);
          if (delta !== 0) aggregate.remoteTabs(key, delta);
        }
      }
      const gone = entry.gone;
      if (gone !== null) {
        for (const key of gone) {
          const tabs = members.get(key);
          if (tabs === undefined) continue;
          members.delete(key);
          aggregate.remoteTabs(key, -tabs);
        }
      }
      const unnamed = entry.unnamed - table.unnamed;
      if (unnamed !== 0) {
        table.unnamed = entry.unnamed;
        aggregate.remoteUnnamed(unnamed);
      }
      if (members.size === 0 && table.unnamed === 0) {
        channels.delete(entry.channel);
        if (channels.size === 0) pod.channels = null;
      }
    }
    if (rejected) this.#rejectedTotal += 1;
  }

  /** Range une part de réponse ; la réponse s'applique d'un bloc à sa dernière part. */
  #part(pod: RemotePod, part: IPresenceStatePart): void {
    let parts = pod.parts;
    if (part.i === 0) {
      pod.partSeq = part.seq;
      pod.partCount = part.n;
      pod.partLast = part.last;
      parts = pod.parts = [part.channels];
    } else {
      if (
        parts === null ||
        part.i !== parts.length ||
        part.seq !== pod.partSeq + part.i ||
        part.n !== pod.partCount ||
        part.last !== pod.partLast
      ) {
        // Une part perdue ou hors suite : la réponse entière est abandonnée,
        // la vue reste telle quelle (RFC 6665 §5.3.1, un état COMPLET ou rien).
        pod.parts = null;
        return;
      }
      parts.push(part.channels);
    }
    if (parts.length < pod.partCount) return;
    pod.parts = null;
    this.#applyState(pod, parts, pod.partLast);
  }

  /** Applique une réponse complète : remplace la vue de chaque canal servi qu'elle nomme, puis ferme le trou si elle couvre la demande. */
  #applyState(
    pod: RemotePod,
    parts: readonly (readonly IPresenceChannelState[])[],
    last: number,
  ): void {
    const reference = pod.reference;
    // Plus ancienne que la vue : impossible dans l'ordre d'un même émetteur,
    // et l'appliquer reculerait des canaux déjà à jour.
    if (reference !== null && last < reference) return;
    // 1. Canaux SERVIS nommés, leur agrégat (résolu une fois) et leur taille —
    //    un canal peut s'étendre sur plusieurs parts. Aucun membre lu ici : le
    //    plafond se juge AVANT de toucher la vue.
    let pending: Map<string, IPendingState> | null = null;
    let rejected = false;
    for (const entries of parts) {
      for (const entry of entries) {
        let state = pending?.get(entry.channel);
        if (state === undefined) {
          const aggregate = this.#lookup(entry.channel);
          if (aggregate === null) continue;
          if (aggregate === false) {
            rejected = true;
            continue;
          }
          state = { aggregate, table: null, count: 0, unnamed: 0 };
          (pending ??= new Map<string, IPendingState>()).set(
            entry.channel,
            state,
          );
        }
        state.count += entry.members.length >> 1;
        state.unnamed = entry.unnamed;
      }
    }
    if (pending !== null) {
      const channels = (pod.channels ??= new Map<string, RemoteChannel>());
      for (const [channel, state] of pending) {
        if (state.count > MAX_PRESENCE_MEMBERS) {
          rejected = true;
          continue;
        }
        let table = channels.get(channel);
        if (table === undefined) {
          table = new RemoteChannel();
          channels.set(channel, table);
        }
        state.table = table;
      }
      // 2. Mise à jour EN PLACE : une lecture par membre, un appel à
      //    l'agrégat seulement si le nombre d'onglets change.
      for (const entries of parts) {
        for (const entry of entries) {
          const state = pending.get(entry.channel);
          if (state?.table == null) continue;
          upsertPairs(state.table, entry.members, state.aggregate);
        }
      }
      // 3. Présents de l'ancienne vue que la réponse ne nomme plus.
      for (const [channel, state] of pending) {
        const table = state.table;
        if (table === null) continue;
        if (table.members.size > state.count)
          dropAbsentIn(table, channel, parts, state.aggregate);
        const unnamed = state.unnamed - table.unnamed;
        if (unnamed !== 0) {
          table.unnamed = state.unnamed;
          state.aggregate.remoteUnnamed(unnamed);
        }
        if (table.members.size === 0 && table.unnamed === 0)
          channels.delete(channel);
      }
      if (channels.size === 0) pod.channels = null;
    }
    if (rejected) this.#rejectedTotal += 1;
    if (reference === null) {
      // Le trou ne se ferme que sur des réponses qui couvrent CE qu'on a
      // demandé : celle d'une demande d'un autre pod peut en nommer moins, et
      // une demande de plus de 4 096 canaux part en tranches que le répondeur
      // peut servir dans deux fenêtres.
      if (covers(pod, parts, last)) this.#close(pod, last);
    } else if (last > reference) {
      // Des lots ont manqué depuis la vue : les canaux non nommés sont en retard.
      this.#openGap(pod);
    }
  }

  #enterGap(pod: RemotePod): void {
    pod.reference = null;
    pod.requestedAt = Number.NEGATIVE_INFINITY;
    pod.asked = null;
    this.#gaps += 1;
    this.#gapTotal += 1;
  }

  #openGap(pod: RemotePod): void {
    if (pod.reference !== null) this.#enterGap(pod);
  }

  #close(pod: RemotePod, last: number): void {
    pod.reference = last;
    pod.asked = null;
    pod.covered = null;
    this.#gaps -= 1;
  }

  /** Une échéance d'oubli neuve : retenue si elle précède celles déjà annoncées au porteur. */
  #closerAt(deadline: number): void {
    if (deadline < this.#closer) this.#closer = deadline;
  }

  /** Retire toutes les contributions d'un pod des agrégats. */
  #withdrawPod(pod: RemotePod, now: number): void {
    if (pod.reference === null) this.#gaps -= 1;
    const channels = pod.channels;
    pod.channels = null;
    pod.parts = null;
    pod.covered = null;
    if (channels === null) return;
    for (const [channel, table] of channels) {
      const aggregate = this.#lookup(channel);
      if (aggregate !== null && aggregate !== false)
        withdraw(table, aggregate, now);
    }
  }

  /** Arrêt propre : présents retirés aussitôt, vie enterrée jusqu'au délai d'oubli. */
  #bury(pod: RemotePod, now: number): void {
    this.#withdrawPod(pod, now);
    this.#endedTotal += 1;
    pod.ended = true;
    pod.reference = 0;
  }
}

/**
 * Les réponses reçues pendant le trou au même `last` nomment-elles, ENSEMBLE, tous les canaux demandés — servis ou non depuis ? Chemin froid : seulement pendant un trou.
 *
 * Deux réponses au même `last` décrivent l'état du pair au même lot : leurs
 * canaux s'additionnent. Un `last` différent repart de zéro — des lots ont
 * changé l'état entre les deux, et ces lots, ignorés pendant le trou, auraient
 * pu toucher les canaux de la première.
 */
function covers(
  pod: RemotePod,
  parts: readonly (readonly IPresenceChannelState[])[],
  last: number,
): boolean {
  let named = pod.covered;
  if (named === null || pod.coveredLast !== last) {
    named = pod.covered = new Set<string>();
    pod.coveredLast = last;
  }
  for (const entries of parts)
    for (const entry of entries) named.add(entry.channel);
  const asked = pod.asked;
  if (asked === null) return false;
  for (const channel of asked) if (!named.has(channel)) return false;
  return true;
}
