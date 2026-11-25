/**
 * L'historique du superviseur, PAR CANAL : un anneau `DevTranscript` par
 * canal, une numérotation commune, un plafond global (ADR-0013 §3, amendement
 * #903).
 *
 * Les canaux sont le modèle de données du SUPERVISEUR, pas de l'écran : le
 * terminal en est un lecteur (une vue lit un ou plusieurs canaux, fusionnés
 * par {@link MergedTranscript}), l'assistant un autre.
 * Ne pas confondre avec `devChannel.ts`, le canal IPC superviseur ⇄ serveur.
 */
import type { ProcessOutputStream } from "./heldChannel";
import {
  DevTranscript,
  type IDevTranscriptOptions,
  type ITranscriptEntry,
} from "./devTranscript";

/**
 * Ce qu'un lecteur voit d'un canal : lire, jamais écrire ni vider — toute
 * écriture passe par {@link DevHistory}, qui tient le plafond global et la
 * version.
 */
export type IChannelReader = Pick<
  DevTranscript,
  | "length"
  | "bytes"
  | "lastSeq"
  | "at"
  | "indexOf"
  | "countAfter"
  | "since"
  | "partial"
>;

/** Réglages de l'historique par canal. */
export interface IDevHistoryOptions {
  /**
   * Mémoire retenue au plus, TOUS canaux confondus (défaut 8 Mio) — estimée
   * par `transcriptEntryCost`.
   */
  maxBytes?: number;
  /**
   * Plafonds d'UN canal : entrées (défaut 10 000), octets (défaut : le
   * plafond global), octets par entrée (défaut 16 Kio).
   */
  channel?: Pick<
    IDevTranscriptOptions,
    "maxEntries" | "maxBytes" | "maxEntryBytes"
  >;
  /** Horloge, injectable en test. */
  now?: () => number;
  /** Appelé quand un canal efface l'écran (`ESC[2J`). */
  onClear?: (channel: string) => void;
}

/**
 * Un historique par canal, sous une numérotation commune et un plafond
 * global.
 *
 * - **Canal à identifiant OUVERT** (`server`, `supervisor`, `vite:<nom>`,
 *   `run:<n>`, `agent:<id>`), créé au premier paquet : aucun anneau alloué
 *   d'avance, et un producteur neuf ne rouvre pas le modèle.
 * - **`seq` global et monotone** : {@link DevHistory.since} rend le fil
 *   FUSIONNÉ de tous les canaux, et un lecteur reprend sans savoir combien il
 *   y en a.
 * - **Plafond global** : dépassé, il évince dans le canal le plus GROS — une
 *   rafale de Vite n'évince jamais la pile d'un crash du serveur tant que
 *   Vite pèse davantage.
 */
export class DevHistory {
  readonly #maxBytes: number;
  readonly #channelOptions: IDevTranscriptOptions;
  /** Les canaux, par identifiant — ouverts à la volée, lus à chaque image. */
  readonly #channels = new Map<string, DevTranscript>();
  #seq = 0;
  #bytes = 0;
  /** Change à chaque écriture, fermeture ou effacement — ce qu'un lecteur fusionné surveille. */
  #version = 0;
  /** Change quand un canal s'ouvre ou se ferme — un lecteur fusionné ne refait sa liste qu'alors. */
  #layout = 0;
  /** Change à chaque `clear` ou `drop` : une écriture qui en a vu un ne reporte pas son delta. */
  #resets = 0;

  /**
   * @param options - plafonds global et par canal, horloge, effacement.
   */
  constructor(options: IDevHistoryOptions = {}) {
    this.#maxBytes = options.maxBytes ?? 8 * 1024 * 1024;
    const nextSeq = (): number => ++this.#seq;
    this.#channelOptions = {
      maxBytes: this.#maxBytes,
      ...options.channel,
      nextSeq,
      ...(options.now === undefined ? {} : { now: options.now }),
      ...(options.onClear === undefined ? {} : { onClear: options.onClear }),
    };
  }

  /** Mémoire retenue, tous canaux confondus. */
  get bytes(): number {
    return this.#bytes;
  }

  /** Numéro de la dernière entrée écrite, tous canaux confondus. */
  get lastSeq(): number {
    return this.#seq;
  }

  /**
   * Change à chaque mutation (écriture, fermeture, effacement) : un lecteur
   * qui a mis une position en cache la sait périmée.
   */
  get version(): number {
    return this.#version;
  }

  /** Change quand un canal s'ouvre ou se ferme. */
  get layout(): number {
    return this.#layout;
  }

  /** Les canaux ouverts, dans leur ordre d'ouverture. */
  channels(): string[] {
    return [...this.#channels.keys()];
  }

  /**
   * Un lecteur qui fusionne, dans l'ordre des numéros, les canaux retenus par
   * `match` — ce qu'une vue lit quand elle montre plusieurs canaux. Un canal
   * ouvert plus tard et retenu par `match` y entre de lui-même.
   *
   * @param match - dit si un canal fait partie de la vue.
   * @returns le lecteur, vivant tant que l'historique l'est.
   */
  merge(match: (channel: string) => boolean): MergedTranscript {
    return new MergedTranscript(this, match);
  }

  /**
   * Les anneaux des canaux retenus, dans l'ordre d'ouverture — remplit
   * `into` (vidé d'abord) pour ne rien allouer.
   *
   * @param match - dit si un canal est retenu.
   * @param into - le tableau à remplir.
   */
  collect(match: (channel: string) => boolean, into: IChannelReader[]): void {
    into.length = 0;
    for (const [id, transcript] of this.#channels) {
      if (match(id)) into.push(transcript);
    }
  }

  /**
   * L'anneau d'un canal — ce qu'une vue lit.
   *
   * @param channel - l'identifiant du canal.
   * @returns son historique, ou `undefined` s'il n'a jamais rien reçu (ou a
   *   été fermé).
   */
  channel(channel: string): IChannelReader | undefined {
    return this.#channels.get(channel);
  }

  /**
   * Verse un paquet dans un canal, ouvert au premier paquet ; le plafond
   * global est tenu au retour. C'est la SEULE porte d'écriture : écrire dans
   * un anneau en direct contournerait le plafond global et la version.
   *
   * @param channel - le canal qui écrit.
   * @param stream - sur quel flux.
   * @param chunk - le paquet, octets bruts ou texte.
   */
  ingest(
    channel: string,
    stream: ProcessOutputStream,
    chunk: Buffer | Uint8Array | string,
  ): void {
    let transcript = this.#channels.get(channel);
    if (transcript === undefined) {
      transcript = new DevTranscript(this.#channelOptions);
      this.#channels.set(channel, transcript);
      this.#layout++;
    }
    const before = transcript.bytes;
    const resets = this.#resets;
    transcript.ingest(channel, stream, chunk);
    this.#version++;
    this.#settle(transcript, before, resets);
  }

  /**
   * Termine les lignes en cours d'un canal, ou de tous.
   *
   * @param channel - le canal ; tous si absent.
   */
  flush(channel?: string): void {
    for (const [id, transcript] of this.#channels) {
      if (channel !== undefined && id !== channel) continue;
      const before = transcript.bytes;
      const resets = this.#resets;
      transcript.flush();
      this.#settle(transcript, before, resets);
    }
    this.#version++;
  }

  /**
   * Ferme un canal et libère son historique — un onglet de sous-agent
   * refermé ne laisse rien derrière lui.
   *
   * @param channel - le canal.
   * @returns `true` s'il existait.
   */
  drop(channel: string): boolean {
    const transcript = this.#channels.get(channel);
    if (transcript === undefined) return false;
    this.#bytes -= transcript.bytes;
    this.#version++;
    this.#layout++;
    this.#resets++;
    return this.#channels.delete(channel);
  }

  /**
   * Les entrées postérieures à `seq`, TOUS canaux fusionnés dans l'ordre des
   * numéros — de quoi reprendre une lecture sans connaître les canaux.
   *
   * @param seq - le dernier numéro déjà lu (`0` pour tout lire).
   * @param limit - nombre maximal d'entrées rendues.
   * @returns une copie bornée.
   */
  since(seq: number, limit = Number.POSITIVE_INFINITY): ITranscriptEntry[] {
    // Une tête de lecture par canal non épuisé ; à chaque tour, la plus
    // petite tête sort. Une dizaine de canaux au plus : un balayage linéaire
    // des têtes bat un tas.
    const rings: DevTranscript[] = [];
    const heads: number[] = [];
    for (const transcript of this.#channels.values()) {
      const at = transcript.length - transcript.countAfter(seq);
      if (at < transcript.length) {
        rings.push(transcript);
        heads.push(at);
      }
    }
    const out: ITranscriptEntry[] = [];
    while (out.length < limit) {
      let pick = -1;
      let best: ITranscriptEntry | undefined;
      for (let i = 0; i < rings.length; i++) {
        const entry = rings[i]?.at(heads[i] ?? 0);
        if (
          entry !== undefined &&
          (best === undefined || entry.seq < best.seq)
        ) {
          best = entry;
          pick = i;
        }
      }
      if (best === undefined) break;
      out.push(best);
      heads[pick] = (heads[pick] ?? 0) + 1;
    }
    return out;
  }

  /** Vide tous les canaux ; la numérotation continue. */
  clear(): void {
    for (const transcript of this.#channels.values()) transcript.clear();
    this.#bytes = 0;
    this.#version++;
    this.#resets++;
  }

  /**
   * Reporte la variation d'un canal, puis tient le plafond global en
   * évinçant dans le canal le plus gros. Un `clear` ou un `drop` survenu
   * PENDANT l'écriture (un `onClear` qui vide l'historique) a remis le
   * compteur à zéro sous le delta : il se recompte alors sur les canaux.
   */
  #settle(transcript: DevTranscript, before: number, resets: number): void {
    if (resets === this.#resets) {
      this.#bytes += transcript.bytes - before;
    } else {
      let sum = 0;
      for (const channel of this.#channels.values()) sum += channel.bytes;
      this.#bytes = sum;
    }
    while (this.#bytes > this.#maxBytes) {
      let largest: DevTranscript | undefined;
      for (const ring of this.#channels.values()) {
        if (largest === undefined || ring.bytes > largest.bytes) {
          largest = ring;
        }
      }
      const freed = largest?.evictOldest() ?? 0;
      if (freed === 0 && (largest?.length ?? 0) === 0) break;
      this.#bytes -= freed;
    }
  }
}

/**
 * Plusieurs canaux lus comme UN historique : les entrées de chaque anneau,
 * fusionnées dans l'ordre des numéros, adressées par position — le contrat
 * que l'image et la sélection lisent (`ITranscriptReader`,
 * `ISelectionReader`).
 *
 * Rien n'est recopié : une position se résout par un curseur — une tête par
 * anneau — qui avance ou recule d'une entrée en O(canaux). L'image lit
 * presque toujours au voisinage de la fin ou de l'ancre, que le curseur
 * rejoint d'un saut ({@link MergedTranscript.indexOf} le pose sur l'ancre).
 * Toute mutation de l'historique le périme ; il repart du bout le plus proche.
 */
export class MergedTranscript {
  readonly #history: DevHistory;
  readonly #match: (channel: string) => boolean;
  /** Les anneaux retenus, rafraîchis quand un canal s'ouvre ou se ferme. */
  readonly #rings: IChannelReader[] = [];
  /**
   * Par anneau, l'index de la première entrée à la position `#position` ou
   * après — entiers denses, dix au plus : `Int32Array`.
   */
  #heads = new Int32Array(0);
  #position = 0;
  #version = -1;
  #layout = -1;
  /** Longueur et dernier numéro, recalculés une fois par mutation, pas par lecture. */
  #length = 0;
  #lastSeq = 0;
  /** L'anneau seul quand la vue n'en lit qu'un : lu en direct, sans curseur. */
  #single: IChannelReader | null = null;

  /**
   * @param history - l'historique lu.
   * @param match - dit si un canal fait partie de la fusion.
   */
  constructor(history: DevHistory, match: (channel: string) => boolean) {
    this.#history = history;
    this.#match = match;
  }

  /** Nombre d'entrées retenues, tous canaux fusionnés. */
  get length(): number {
    this.#sync();
    return this.#length;
  }

  /** Numéro de la dernière entrée écrite dans l'un des canaux fusionnés. */
  get lastSeq(): number {
    this.#sync();
    return this.#lastSeq;
  }

  /**
   * Lit une entrée par position, la plus ancienne en `0`.
   *
   * @param index - position, négative pour compter depuis la fin.
   * @returns l'entrée, ou `undefined` hors bornes.
   */
  at(index: number): ITranscriptEntry | undefined {
    this.#sync();
    if (this.#single !== null) return this.#single.at(index);
    const length = this.#length;
    const i = index < 0 ? length + index : index;
    if (!Number.isInteger(i) || i < 0 || i >= length) return undefined;
    // Le pas arrière (une image se lit de la fin vers le haut) trouve
    // l'entrée en reculant : la rendre, sans rebalayer les têtes.
    if (i === this.#position - 1) {
      const back = this.#largestBeforeHead();
      if (back !== -1) {
        const head = (this.#heads[back] ?? 0) - 1;
        this.#heads[back] = head;
        this.#position = i;
        return this.#rings[back]?.at(head);
      }
    }
    this.#moveTo(i, length);
    const ring = this.#smallestHead();
    return ring === -1
      ? undefined
      : this.#rings[ring]?.at(this.#heads[ring] ?? 0);
  }

  /**
   * Position actuelle d'une entrée ; y pose le curseur.
   *
   * @param seq - son numéro.
   * @returns sa position, ou `-1` si aucun canal fusionné ne la retient.
   */
  indexOf(seq: number): number {
    this.#sync();
    if (this.#single !== null) return this.#single.indexOf(seq);
    let found = false;
    for (const ring of this.#rings) {
      if (ring.indexOf(seq) !== -1) {
        found = true;
        break;
      }
    }
    if (!found) return -1;
    let position = 0;
    for (let r = 0; r < this.#rings.length; r++) {
      const ring = this.#rings[r];
      const head =
        ring === undefined ? 0 : ring.length - ring.countAfter(seq - 1);
      this.#heads[r] = head;
      position += head;
    }
    this.#position = position;
    return position;
  }

  /**
   * Entrées retenues dont le numéro dépasse `seq`, tous canaux fusionnés.
   *
   * @param seq - le numéro de l'ancre.
   * @returns le compte.
   */
  countAfter(seq: number): number {
    this.#sync();
    let count = 0;
    for (const ring of this.#rings) count += ring.countAfter(seq);
    return count;
  }

  /**
   * Périme le curseur si l'historique a changé ; ne refait la liste des
   * anneaux que si un canal s'est ouvert ou fermé.
   */
  #sync(): void {
    const version = this.#history.version;
    if (version === this.#version) return;
    this.#version = version;
    const layout = this.#history.layout;
    if (layout !== this.#layout) {
      this.#layout = layout;
      this.#history.collect(this.#match, this.#rings);
      if (this.#heads.length !== this.#rings.length) {
        this.#heads = new Int32Array(this.#rings.length);
      }
      this.#single = this.#rings.length === 1 ? (this.#rings[0] ?? null) : null;
    }
    this.#heads.fill(0);
    this.#position = 0;
    let length = 0;
    let last = 0;
    for (const ring of this.#rings) {
      length += ring.length;
      if (ring.lastSeq > last) last = ring.lastSeq;
    }
    this.#length = length;
    this.#lastSeq = last;
  }

  /** Amène le curseur à `target`, depuis la position, le début ou la fin. */
  #moveTo(target: number, length: number): void {
    if (Math.abs(target - this.#position) > target) {
      this.#heads.fill(0);
      this.#position = 0;
    }
    if (Math.abs(target - this.#position) > length - target) {
      for (let r = 0; r < this.#rings.length; r++) {
        this.#heads[r] = this.#rings[r]?.length ?? 0;
      }
      this.#position = length;
    }
    while (this.#position < target) {
      const ring = this.#smallestHead();
      if (ring === -1) break;
      this.#heads[ring] = (this.#heads[ring] ?? 0) + 1;
      this.#position++;
    }
    while (this.#position > target) {
      const ring = this.#largestBeforeHead();
      if (ring === -1) break;
      this.#heads[ring] = (this.#heads[ring] ?? 0) - 1;
      this.#position--;
    }
  }

  /** L'anneau dont la tête porte le plus petit numéro — l'entrée à la position. */
  #smallestHead(): number {
    let pick = -1;
    let best = Number.POSITIVE_INFINITY;
    for (let r = 0; r < this.#rings.length; r++) {
      const seq = this.#rings[r]?.at(this.#heads[r] ?? 0)?.seq;
      if (seq !== undefined && seq < best) {
        best = seq;
        pick = r;
      }
    }
    return pick;
  }

  /** L'anneau dont l'entrée juste avant la tête porte le plus grand numéro. */
  #largestBeforeHead(): number {
    let pick = -1;
    let best = Number.NEGATIVE_INFINITY;
    for (let r = 0; r < this.#rings.length; r++) {
      const head = this.#heads[r] ?? 0;
      if (head === 0) continue; // `at(-1)` lirait la FIN de l'anneau
      const seq = this.#rings[r]?.at(head - 1)?.seq;
      if (seq !== undefined && seq > best) {
        best = seq;
        pick = r;
      }
    }
    return pick;
  }
}
