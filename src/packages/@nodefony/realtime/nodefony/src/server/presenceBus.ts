import { Buffer } from "node:buffer";
import { PLATFORM_BUS_CHANNELS } from "nodefony";
import {
  MAX_PRESENCE_CHANNELS,
  isUnknownPresenceMessage,
  readPresenceAlive,
  readPresenceMessage,
  type IPresenceChannelDelta,
  type IPresenceChannelState,
  type IPresenceRequest,
} from "../backplane/presenceMessage";
import type { ChannelPresence } from "./channelPresence";
import { RemotePresence } from "./remotePresence";

/** Fenêtre des lots, demandes et réponses entre pods (ms) — ADR-0025 P2. */
export const PRESENCE_BATCH_MS = 50;

/** Intervalle local de la preuve de vie (ms), annoncé aux pairs — ADR-0025 P2, « Oubli ». */
export const PRESENCE_INTERVAL_MS = 5000;

/** Délai d'oubli d'un pair muet, en intervalles ANNONCÉS (≥ 2) — ADR-0025 P2. */
export const PRESENCE_FORGET_FACTOR = 3;

/** Octets UTF-8 au plus par message (estimés à l'encodage JSON), sous les 64 Ko de l'ADR. */
const PRESENCE_MESSAGE_BYTES = 60_000;

/** Coût fixe estimé d'une entrée de canal (clés, ponctuation, `unnamed`). */
const ENTRY_BYTES = 48;

const EMPTY_PAIRS: readonly (string | number)[] = Object.freeze([]);

/**
 * Ce que la présence répartie demande au hub qui la porte — le bus, et les canaux à présence DIFFUSÉS qu'il sert.
 */
export interface IPresenceBusHost {
  /** `originId` de ce pod (celui de son backplane). */
  readonly originId: string;
  /** Publie sur le bus (la file d'envoi tranche : la preuve de vie passe hors quota). */
  publish(channel: string, payload: object): void;
  /**
   * Résout un canal reçu : sa présence s'il est servi et diffusé ici, `null` s'il déclare la présence sans être servi, `false` s'il ne la déclare pas (refus compté).
   */
  lookup(channel: string): ChannelPresence | null | false;
  /** Présence d'un canal servi et diffusé ici, `null` sinon. */
  served(channel: string): ChannelPresence | null;
  /** Les présences servies et diffusées ici — itérées aux seules transitions. */
  servedPresences(): Iterable<ChannelPresence>;
  /** Nombre de présences servies et diffusées ici. */
  servedCount(): number;
  /**
   * Échos de ses propres messages comptés par le pilote (`IBackplaneInfo.echoTotal`), `undefined` s'il n'en expose pas — l'oubli reste alors normal.
   */
  echoTotal(): number | undefined;
}

/** Réglages de la présence répartie (défauts de l'ADR). */
export interface IPresenceBusOptions {
  /** Intervalle de la preuve de vie (ms). */
  readonly interval?: number;
  /** Délai d'oubli, en intervalles annoncés (≥ 2). */
  readonly factor?: number;
  /** Tirage dans [0, 1) — incarnation et gigue ; injecté par les tests. */
  readonly random?: () => number;
  /** Horloge murale (ms) — incarnation seulement ; injectée par les tests. */
  readonly wallClock?: () => number;
}

/** Coût estimé d'une paire `[identité, onglets]` sur le fil. */
function pairBytes(key: unknown): number {
  return (typeof key === "string" ? Buffer.byteLength(key, "utf8") : 0) + 10;
}

/**
 * Découpe des entrées de canal en parts d'au plus {@link PRESENCE_MESSAGE_BYTES} octets estimés et {@link MAX_PRESENCE_CHANNELS} entrées ; une entrée trop grosse s'étend sur plusieurs parts (ses paires s'additionnent, valeurs absolues).
 *
 * @param pairsOf - les paires d'une entrée ; `rebuild` en fait une entrée
 *   réduite à une tranche de ces paires (`last` : la dernière tranche, qui
 *   garde ce qui n'est pas découpé).
 */
function split<E extends { readonly channel: string }>(
  entries: readonly E[],
  pairsOf: (entry: E) => readonly (string | number)[],
  rebuild: (entry: E, pairs: readonly (string | number)[], last: boolean) => E,
): E[][] {
  const parts: E[][] = [];
  let part: E[] = [];
  let size = 0;
  for (const entry of entries) {
    const head = Buffer.byteLength(entry.channel, "utf8") + ENTRY_BYTES;
    if (
      part.length >= MAX_PRESENCE_CHANNELS ||
      (part.length > 0 && size + head > PRESENCE_MESSAGE_BYTES)
    ) {
      parts.push(part);
      part = [];
      size = 0;
    }
    const pairs = pairsOf(entry);
    let from = 0;
    let cost = head;
    for (let i = 0; i < pairs.length; i += 2) {
      const bytes = pairBytes(pairs[i]);
      if (size + cost + bytes > PRESENCE_MESSAGE_BYTES && i > from) {
        part.push(rebuild(entry, pairs.slice(from, i), false));
        parts.push(part);
        part = [];
        size = 0;
        from = i;
        cost = head;
      }
      cost += bytes;
    }
    part.push(from === 0 ? entry : rebuild(entry, pairs.slice(from), true));
    size += cost;
  }
  if (part.length > 0 || parts.length === 0) parts.push(part);
  return parts;
}

/**
 * Présence répartie d'UN pod (ADR-0025 P2) — ce qu'il émet sur le bus (lots de 50 ms, demandes d'état, réponses, preuve de vie) et ce qu'il en reçoit (vue des pairs, {@link RemotePresence}).
 *
 * Sans minuteur ni horloge : le hub la fait avancer à son tic UNIQUE
 * ({@link PresenceBus.tick}) et arme ce tic sur {@link PresenceBus.due}, O(1).
 * Elle ne parle qu'à `IBackplane` par son hôte : un pilote neuf (Kafka,
 * NATS…) n'écrit rien pour la présence.
 *
 * Coût : rien n'existe tant qu'aucun canal à présence n'est diffusé ; un
 * changement local = un ajout dans un `Set` ; un lot = un parcours des seuls
 * canaux changés.
 */
export class PresenceBus {
  /** Vue des pairs. */
  readonly remote: RemotePresence;
  /** Vie de ce processus : `Date.now() × 1024 + aléa sur 10 bits` (entier sûr jusqu'en 2248). */
  readonly incarnation: number;
  readonly #host: IPresenceBusHost;
  readonly #interval: number;
  readonly #random: () => number;
  #seq = 0;
  #lastBatch = 0;
  // Présences dont la part locale a changé depuis le dernier lot.
  #dirty: Set<ChannelPresence> | null = null;
  // Canaux nouvellement servis : demande NON ciblée au prochain lot (S-rt-99).
  #ask: Set<string> | null = null;
  // Canaux à servir dans la réponse groupée → nommés obligatoirement (demande ciblée).
  #answer: Map<string, boolean> | null = null;
  #answerDue = false;
  // Présences à rafraîchir par le hub (agrégat touché, état incomplet changé).
  #touched: Set<ChannelPresence> | null = null;
  // Synchronisations initiales en cours, échéances croissantes (une fenêtre fixe).
  #syncing: ChannelPresence[] | null = null;
  #syncHead = 0;
  #gapped = false;
  #gapTotalSeen = 0;
  #batchAt = Number.POSITIVE_INFINITY;
  #requestAt = Number.POSITIVE_INFINITY;
  #aliveAt = Number.POSITIVE_INFINITY;
  #expireAt = Number.POSITIVE_INFINITY;
  #batchTotal = 0;
  #requestTotal = 0;
  #answerTotal = 0;
  #aliveTotal = 0;
  // Écho : relevé au tic de la preuve de vie (un entier, aucun horodatage par
  // message) ; `-1` = jamais relevé.
  #echoSeen = -1;
  // Une preuve de vie est partie depuis le dernier relevé : son écho est attendu.
  #echoExpected = false;
  // Bus perdu, constaté par l'écho : la vue se fige, aucun pair n'est oublié.
  #busLost = false;
  #busLostTotal = 0;
  #rearmTotal = 0;
  // Arrêt propre émis : plus rien ne part.
  #ended = false;

  /**
   * @throws RangeError si le délai d'oubli est sous 2 intervalles (cf `RemotePresence`).
   */
  constructor(host: IPresenceBusHost, options: IPresenceBusOptions = {}) {
    this.#host = host;
    this.#interval = options.interval ?? PRESENCE_INTERVAL_MS;
    this.#random = options.random ?? Math.random;
    const wall = options.wallClock ?? Date.now;
    this.incarnation =
      Math.floor(wall()) * 1024 + Math.floor(this.#random() * 1024);
    this.remote = new RemotePresence({
      lookup: (channel) => {
        const presence = host.lookup(channel);
        if (presence !== null && presence !== false) this.#touch(presence);
        return presence;
      },
      factor: options.factor ?? PRESENCE_FORGET_FACTOR,
      interval: this.#interval,
    });
  }

  /** Prochain instant (ms monotone) où le bus a quelque chose à faire — O(1). */
  due(): number {
    let next = this.#batchAt;
    if (this.#requestAt < next) next = this.#requestAt;
    if (this.#aliveAt < next) next = this.#aliveAt;
    if (this.#expireAt < next) next = this.#expireAt;
    const syncing = this.#syncing;
    if (syncing !== null) {
      const head = syncing[this.#syncHead];
      if (head !== undefined && head.syncUntil < next) next = head.syncUntil;
    }
    return next;
  }

  /**
   * Présences à rafraîchir depuis le dernier appel (agrégat changé, état incomplet changé) — `null` si aucune ; le hub les touche.
   */
  takeTouched(): Set<ChannelPresence> | null {
    const touched = this.#touched;
    this.#touched = null;
    return touched;
  }

  /**
   * Un canal à présence diffusé vient d'être servi (premier abonné local) : la vue reste incomplète le temps que la demande d'état groupée soit servie.
   */
  served(presence: ChannelPresence, now: number): void {
    if (this.#ended) return;
    (this.#ask ??= new Set<string>()).add(presence.channel);
    presence.syncUntil = now + PRESENCE_BATCH_MS * 3;
    presence.setPartial(true);
    (this.#syncing ??= []).push(presence);
    this.#armBatch(now);
    this.#activate(now);
  }

  /** La part locale d'une présence a changé : elle part au prochain lot. */
  changed(presence: ChannelPresence, now: number): void {
    if (this.#ended) return;
    (this.#dirty ??= new Set<ChannelPresence>()).add(presence);
    this.#armBatch(now);
    this.#activate(now);
  }

  /**
   * Applique un message du canal des lots, demandes et réponses.
   *
   * @returns `true` si c'est un type de message inconnu de cette version (le
   *   hub le compte dans `ingressUnknownDiscardedTotal`) ; `false` sinon — y
   *   compris refusé, compté ici (`presenceRejectedTotal`).
   */
  receive(origin: string, payload: unknown, now: number): boolean {
    if (this.#ended) return false;
    const message = readPresenceMessage(payload);
    if (message === null) {
      if (isUnknownPresenceMessage(payload)) return true;
      this.remote.countRejected();
      return false;
    }
    const request = this.remote.receive(origin, message, now);
    if (request !== null) this.#queueAnswer(request, now);
    this.#afterReceive(now);
    return false;
  }

  /** Applique une preuve de vie ; une forme fausse est refusée et comptée. */
  receiveAlive(origin: string, payload: unknown, now: number): void {
    if (this.#ended) return;
    const alive = readPresenceAlive(payload);
    if (alive === null) {
      this.remote.countRejected();
      return;
    }
    this.remote.receiveAlive(origin, alive, now);
    this.#afterReceive(now);
  }

  /** Fait avancer la présence répartie à l'instant `now` (tic unique du hub). */
  tick(now: number): void {
    if (this.#ended) return;
    const remote = this.remote;
    // Tic en retard de plus d'un intervalle sur son échéance : c'est CE pod qui
    // a gelé (GC, cgroup étranglé), et les preuves de vie des pairs attendent
    // encore dans son tampon — les minuteurs passent avant la lecture des
    // sockets. Réarmer au lieu d'oublier (Lifeguard).
    if (now - this.due() > this.#interval) this.#rearm(now);
    if (now >= this.#batchAt) {
      this.#batchAt = Number.POSITIVE_INFINITY;
      // Le lot d'abord : `last` des réponses qui suivent le compte.
      this.#flushBatch();
      this.#flushAsk();
      this.#flushAnswers();
    }
    const alive = now >= this.#aliveAt;
    // L'écho se relève AVANT l'oubli : un bus perdu fige la vue au lieu de
    // faire oublier d'un coup tous les pairs vivants (S-rt-102).
    if (alive) this.#checkEcho(now);
    if (now >= this.#expireAt && !this.#busLost) remote.expire(now);
    if (now >= this.#requestAt) {
      this.#requestAt = Number.POSITIVE_INFINITY;
      this.#sendRequests(now);
    }
    if (alive) {
      this.#sendAlive(false);
      this.#aliveAt = this.#active()
        ? now + this.#interval
        : Number.POSITIVE_INFINITY;
    }
    const syncing = this.#syncing;
    if (syncing !== null) {
      let head = this.#syncHead;
      while (head < syncing.length) {
        const presence = syncing[head];
        if (presence === undefined || presence.syncUntil > now) break;
        presence.syncUntil = 0;
        if (presence.live) {
          presence.setPartial(this.#incomplete());
          this.#touch(presence);
        }
        head += 1;
      }
      if (head === syncing.length) {
        this.#syncing = null;
        this.#syncHead = 0;
      } else this.#syncHead = head;
    }
    // Vue figée : aucune échéance d'oubli tant que l'écho ne revient pas.
    this.#expireAt =
      remote.size > 0 && !this.#busLost
        ? remote.nextDeadline()
        : Number.POSITIVE_INFINITY;
    this.#refreshGaps(now);
  }

  /**
   * Arrêt propre (ADR-0025 P5) : le dernier lot part, puis une preuve de vie FINALE — les pairs retirent aussitôt les présents de ce pod, sans attendre le délai d'oubli. Plus rien ne part ensuite ; idempotent.
   *
   * Rien n'est émis si ce pod ne s'est jamais annoncé (aucune preuve de vie
   * émise ni vue des pairs) : personne n'a rien à retirer.
   */
  end(): void {
    if (this.#ended) return;
    const announced = this.#aliveTotal > 0 || this.#active();
    if (announced) {
      this.#flushBatch();
      this.#sendAlive(true);
    }
    this.#ended = true;
    this.#batchAt = Number.POSITIVE_INFINITY;
    this.#requestAt = Number.POSITIVE_INFINITY;
    this.#aliveAt = Number.POSITIVE_INFINITY;
    this.#expireAt = Number.POSITIVE_INFINITY;
    this.#dirty = null;
    this.#ask = null;
    this.#answer = null;
    this.#syncing = null;
    this.#touched = null;
  }

  /** Arrêt propre émis ? */
  get ended(): boolean {
    return this.#ended;
  }

  /** Bus perdu, constaté par l'écho : la vue est figée et `partial` (instantané). */
  get busLost(): boolean {
    return this.#busLost;
  }

  /** Pertes du bus constatées par l'écho. */
  get busLostTotal(): number {
    return this.#busLostTotal;
  }

  /** Réarmements du délai d'oubli (tic en retard, retour de l'écho). */
  get rearmTotal(): number {
    return this.#rearmTotal;
  }

  /** Compteurs de la sonde. */
  get batchTotal(): number {
    return this.#batchTotal;
  }

  /** Demandes d'état émises (ciblées et non ciblées). */
  get requestTotal(): number {
    return this.#requestTotal;
  }

  /** Parts de réponse d'état émises. */
  get answerTotal(): number {
    return this.#answerTotal;
  }

  /** Preuves de vie émises. */
  get aliveTotal(): number {
    return this.#aliveTotal;
  }

  #touch(presence: ChannelPresence): void {
    (this.#touched ??= new Set<ChannelPresence>()).add(presence);
  }

  #armBatch(now: number): void {
    if (this.#batchAt === Number.POSITIVE_INFINITY)
      this.#batchAt = now + PRESENCE_BATCH_MS;
  }

  /** Bat-il ? Dès qu'il sert un canal à présence diffusé OU garde une vue des pairs. */
  #active(): boolean {
    return this.#host.servedCount() > 0 || this.remote.size > 0;
  }

  /** Arme le premier battement, avec une gigue de 0 à 25 % de l'intervalle. */
  #activate(now: number): void {
    if (this.#aliveAt === Number.POSITIVE_INFINITY && this.#active())
      this.#aliveAt = now + this.#interval * 0.25 * this.#random();
  }

  #afterReceive(now: number): void {
    const remote = this.remote;
    // Un trou neuf : demande ciblée au prochain lot, sans attendre l'intervalle.
    if (remote.gapTotal !== this.#gapTotalSeen) {
      this.#gapTotalSeen = remote.gapTotal;
      const at = now + PRESENCE_BATCH_MS;
      if (at < this.#requestAt) this.#requestAt = at;
    }
    // Un pair neuf a pu rapprocher l'échéance d'oubli : relevée au tic suivant
    // au plus tard d'un intervalle local (le battement réveille le tic).
    this.#activate(now);
    this.#refreshGaps(now);
  }

  /** La vue des pairs est-elle incomplète (trou chez un pair) ou figée (bus perdu) ? */
  #incomplete(): boolean {
    return this.remote.gaps > 0 || this.#busLost;
  }

  /**
   * Un trou s'ouvre ou se ferme chez un pair, le bus se perd ou revient : la vue des canaux servis change d'état.
   */
  #refreshGaps(now: number): void {
    if (this.remote.gaps > 0 && this.#requestAt === Number.POSITIVE_INFINITY)
      this.#requestAt = now + this.#interval;
    const incomplete = this.#incomplete();
    if (incomplete === this.#gapped) return;
    this.#gapped = incomplete;
    for (const presence of this.#host.servedPresences()) {
      if (presence.syncUntil !== 0) continue;
      presence.setPartial(incomplete);
      this.#touch(presence);
    }
  }

  /**
   * Relève l'écho au tic de la preuve de vie : une preuve de vie partie au relevé précédent et aucun écho depuis = bus perdu ; l'écho qui revient réarme le délai d'oubli de tous les pairs.
   */
  #checkEcho(now: number): void {
    const total = this.#host.echoTotal();
    if (total === undefined) return;
    if (total !== this.#echoSeen) {
      if (this.#busLost) {
        this.#busLost = false;
        this.#rearm(now);
      }
    } else if (this.#echoExpected && !this.#busLost) {
      this.#busLost = true;
      this.#busLostTotal += 1;
    }
    this.#echoSeen = total;
    this.#echoExpected = true;
  }

  #rearm(now: number): void {
    if (this.remote.size === 0) return;
    this.remote.rearm(now);
    this.#rearmTotal += 1;
  }

  #queueAnswer(request: IPresenceRequest, now: number): void {
    const targeted = request.to !== null;
    if (targeted && request.to !== this.#host.originId) return;
    const answer = (this.#answer ??= new Map<string, boolean>());
    for (const channel of request.channels)
      if (targeted || answer.get(channel) !== true)
        answer.set(channel, targeted);
    if (targeted) this.#answerDue = true;
    this.#armBatch(now);
  }

  #flushBatch(): void {
    const dirty = this.#dirty;
    if (dirty === null) return;
    this.#dirty = null;
    let entries: IPresenceChannelDelta[] | null = null;
    for (const presence of dirty) {
      const entry = presence.takeBusDelta();
      if (entry !== null) (entries ??= []).push(entry);
    }
    if (entries === null) return;
    // Un lot trop gros part en plusieurs lots chaînés : valeurs absolues,
    // appliquées dans l'ordre, une identité coupée entre deux reste exacte.
    const parts = split(
      entries,
      (entry) => entry.set ?? EMPTY_PAIRS,
      // Les départs partent avec la dernière tranche.
      (entry, set, last) =>
        last ? { ...entry, set } : { ...entry, set, gone: null },
    );
    for (const channels of parts) {
      const seq = ++this.#seq;
      this.#host.publish(PLATFORM_BUS_CHANNELS.presence, {
        op: "batch",
        incarnation: this.incarnation,
        seq,
        prev: this.#lastBatch,
        channels,
      });
      this.#lastBatch = seq;
      this.#batchTotal += 1;
    }
  }

  #flushAsk(): void {
    const ask = this.#ask;
    if (ask === null) return;
    this.#ask = null;
    this.#request([...ask], null);
  }

  #sendRequests(now: number): void {
    const remote = this.remote;
    if (remote.gaps === 0) return;
    const channels: string[] = [];
    for (const presence of this.#host.servedPresences())
      channels.push(presence.channel);
    const targets = remote.takeRequests(now, channels);
    if (targets !== null) for (const to of targets) this.#request(channels, to);
    // Trou toujours ouvert : redemandé un intervalle plus tard.
    if (remote.gaps > 0) this.#requestAt = now + this.#interval;
  }

  /** Publie une demande, découpée par {@link MAX_PRESENCE_CHANNELS} canaux. */
  #request(channels: readonly string[], to: string | null): void {
    for (let from = 0; from < channels.length || from === 0;) {
      const slice =
        channels.length <= MAX_PRESENCE_CHANNELS
          ? channels
          : channels.slice(from, from + MAX_PRESENCE_CHANNELS);
      this.#host.publish(PLATFORM_BUS_CHANNELS.presence, {
        op: "request",
        incarnation: this.incarnation,
        seq: ++this.#seq,
        channels: slice,
        to,
      });
      this.#requestTotal += 1;
      from += MAX_PRESENCE_CHANNELS;
    }
  }

  #flushAnswers(): void {
    const answer = this.#answer;
    if (answer === null) return;
    const due = this.#answerDue;
    this.#answer = null;
    this.#answerDue = false;
    const entries: IPresenceChannelState[] = [];
    for (const [channel, named] of answer) {
      const presence = this.#host.served(channel);
      if (presence?.hasLocal === true) entries.push(presence.localState());
      else if (named)
        entries.push({ channel, members: EMPTY_PAIRS, unnamed: 0 });
    }
    // Ciblée : une réponse TOUJOURS, même vide (RFC 6121 §4.3.2).
    if (entries.length === 0 && !due) return;
    const parts = split(
      entries,
      (entry) => entry.members,
      (entry, members) => ({
        channel: entry.channel,
        members,
        unnamed: entry.unnamed,
      }),
    );
    const n = parts.length;
    const last = this.#lastBatch;
    for (let i = 0; i < n; i += 1) {
      this.#host.publish(PLATFORM_BUS_CHANNELS.presence, {
        op: "state",
        incarnation: this.incarnation,
        seq: ++this.#seq,
        last,
        i,
        n,
        channels: parts[i],
      });
      this.#answerTotal += 1;
    }
  }

  #sendAlive(final: boolean): void {
    const incarnation = this.incarnation;
    const seq = ++this.#seq;
    const last = this.#lastBatch;
    const interval = this.#interval;
    // Littéraux construits d'un bloc : `final` n'existe que sur la dernière.
    this.#host.publish(
      PLATFORM_BUS_CHANNELS.presenceAlive,
      final
        ? { incarnation, seq, last, interval, final: true }
        : { incarnation, seq, last, interval },
    );
    this.#aliveTotal += 1;
  }
}
