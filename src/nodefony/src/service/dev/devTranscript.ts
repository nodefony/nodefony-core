/**
 * L'historique de ce que le terminal de développement a montré : des lignes
 * logiques, assainies, bornées en nombre ET en octets — sans terminal.
 *
 * Le superviseur y verse la sortie du serveur, la sienne, celle des commandes
 * lancées depuis l'invite et celle de l'assistant ; l'écran (`devFrame.ts`)
 * en lit une fenêtre par index à chaque image. Cf ADR-0013 §3.
 *
 * Trois règles portent le module :
 * - **la découpe se fait sur le `Buffer`**, une ligne décodée à la fois :
 *   décoder un paquet entier puis le découper produirait des chaînes qui
 *   retiennent chacune le paquet parent ; un caractère UTF-8 coupé entre deux
 *   paquets est recomposé par un `StringDecoder` par couple (source, flux) ;
 * - **une ligne en cours par couple (source, flux)** : le serveur et
 *   l'assistant écrivent des fragments en même temps ; `\r` réinitialise la
 *   ligne en cours (un indicateur d'attente réécrit sa ligne, il n'empile pas
 *   cent entrées) ;
 * - **toute source est assainie** ({@link sanitizeTerminalText}) : une ligne de
 *   journal ne pilote pas le terminal du développeur.
 */
import { StringDecoder } from "node:string_decoder";
import { CircularBuffer } from "../../runtime/CircularBuffer";
import { controlSequenceLength } from "../../runtime/textWidth";

/** Qui a produit une ligne de l'historique. */
export type TranscriptSource =
  "server" | "supervisor" | "command" | "user" | "assistant";

/** Le flux d'origine d'une ligne. */
export type TranscriptStream = "out" | "err";

/** Une ligne logique de l'historique — objet plat, sérialisable en JSON. */
export interface ITranscriptEntry {
  /** Numéro monotone : un lecteur reprend « depuis seq N », même après éviction. */
  readonly seq: number;
  readonly source: TranscriptSource;
  readonly stream: TranscriptStream;
  /** UNE ligne, assainie, sans `\n`, bornée (cf `maxEntryBytes`). */
  readonly text: string;
  /** `Date.now()` à la réception de la fin de ligne. */
  readonly at: number;
  /** Relie une saisie (`user`) à la sortie qu'elle a produite (`command`). */
  readonly run?: number;
}

/** Réglages de l'historique — les défauts sont ceux de l'ADR-0013. */
export interface IDevTranscriptOptions {
  /** Nombre maximal d'entrées retenues (défaut 10 000). */
  maxEntries?: number;
  /** Octets UTF-8 retenus au plus, toutes entrées confondues (défaut 8 Mio). */
  maxBytes?: number;
  /** Octets UTF-8 au plus par entrée, au-delà tronquée avec marque (défaut 16 Kio). */
  maxEntryBytes?: number;
  /** Horloge, injectable en test. */
  now?: () => number;
  /**
   * Appelé quand une source efface l'écran (`ESC[2J`) : la séquence n'entre
   * pas dans l'historique, son SENS est décidé par qui affiche.
   */
  onClear?: (source: TranscriptSource) => void;
}

/** Ce qui remplace la fin d'une ligne trop longue. */
export const TRUNCATION_MARK = " … [ligne tronquée]";

/** Effacement d'écran — le seul que l'historique transforme en évènement. */
const CLEAR = "\x1b[2J";

/** Largeur d'une tabulation, rendue en espaces (une tabulation déplace le curseur). */
const TAB = "    ";

/** Couleur ou style (SGR). */
const SGR = /^\x1b\[[0-9;:]*m$/;
/** Effacement de ligne (EL : `ESC[K`, `ESC[0K`, `ESC[1K`, `ESC[2K`). */
const ERASE_IN_LINE = /^\x1b\[[012]?K$/;
/** Hyperlien OSC 8 : `ESC]8;params;URI` puis `ESC\` ou BEL. */
const OSC8 = /^\x1b\]8;[\x20-\x7e]*?;([\x20-\x7e]*)(?:\x1b\\|\x07)$/;
/** Schémas qu'un hyperlien a le droit de porter. */
const LINK_SCHEMES = /^(?:https?|file):/i;

/**
 * Dit si une séquence de contrôle a le droit de rester dans l'historique :
 * couleurs, effacement de ligne, hyperliens `http`/`https`/`file` (et la
 * séquence vide qui ferme un hyperlien).
 *
 * @param sequence - une séquence complète commençant par `ESC`.
 * @returns `true` si elle est gardée.
 */
function isAllowedSequence(sequence: string): boolean {
  if (SGR.test(sequence) || ERASE_IN_LINE.test(sequence)) return true;
  const link = OSC8.exec(sequence);
  if (!link) return false;
  const uri = link[1] ?? "";
  return uri === "" || LINK_SCHEMES.test(uri);
}

/**
 * Assainit un texte destiné au terminal : garde les couleurs, l'effacement
 * de ligne et les hyperliens `http`/`https`/`file` ; retire tout le reste —
 * déplacement de curseur, titre de fenêtre, presse-papiers (OSC 52),
 * changement d'écran, contrôles C0 et C1. Les tabulations deviennent des
 * espaces. Ne traite NI `\r` NI `\n` : c'est le découpage qui leur donne un
 * sens.
 *
 * @param text - le texte brut, d'une source quelconque.
 * @returns le texte sans aucune séquence qui piloterait le terminal.
 */
export function sanitizeTerminalText(text: string): string {
  let out = "";
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    const isControl =
      code < 0x20 || code === 0x7f || (code >= 0x80 && code <= 0x9f);
    if (!isControl || code === 0x0d || code === 0x0a) continue;
    out += text.slice(start, i);
    if (code === 0x1b) {
      const length = controlSequenceLength(text, i) || 1;
      const sequence = text.slice(i, i + length);
      if (isAllowedSequence(sequence)) out += sequence;
      i += length - 1;
    } else if (code === 0x09) {
      out += TAB;
    }
    start = i + 1;
  }
  return start === 0 ? text : out + text.slice(start);
}

/** La ligne en cours d'un couple (source, flux). */
interface IPendingLine {
  decoder: StringDecoder;
  text: string;
  /** La ligne a déjà été tronquée : la suite est ignorée jusqu'au `\r` ou au `\n`. */
  truncated: boolean;
  /**
   * Le dernier fragment finissait par `\r` : la ligne repart de zéro au
   * prochain texte — sauf si c'est la fin de ligne (`\r\n`, Windows).
   */
  carriageReturn: boolean;
}

let encoder: TextEncoder | null = null;
let scratch: Uint8Array | null = null;

/**
 * Coupe un texte à `maxBytes` octets UTF-8 sans couper un caractère.
 *
 * @param text - le texte.
 * @param maxBytes - octets au plus.
 * @returns le préfixe qui tient.
 */
function cutToBytes(text: string, maxBytes: number): string {
  encoder ??= new TextEncoder();
  if (scratch === null || scratch.length < maxBytes) {
    scratch = new Uint8Array(maxBytes);
  }
  const { read } = encoder.encodeInto(text, scratch.subarray(0, maxBytes));
  return text.slice(0, read);
}

/**
 * L'historique borné d'un terminal de développement.
 *
 * Coût : un objet par ligne logique, rien par paquet reçu au-delà des
 * tranches décodées ; l'éviction est en O(1) par entrée (anneau).
 */
export class DevTranscript {
  readonly #maxEntries: number;
  readonly #maxBytes: number;
  readonly #maxEntryBytes: number;
  readonly #now: () => number;
  readonly #onClear: ((source: TranscriptSource) => void) | null;
  readonly #ring: CircularBuffer<ITranscriptEntry>;
  /** Octets UTF-8 retenus, par entrée — même ordre que l'anneau. */
  readonly #sizes: CircularBuffer<number>;
  /** Lignes en cours, par source puis par flux — une dizaine de clés au plus. */
  readonly #pending: Record<string, IPendingLine> = Object.create(
    null,
  ) as Record<string, IPendingLine>;
  #bytes = 0;
  #seq = 0;

  /**
   * @param options - plafonds, horloge, et qui prévenir d'un effacement d'écran.
   */
  constructor(options: IDevTranscriptOptions = {}) {
    this.#maxEntries = options.maxEntries ?? 10_000;
    this.#maxBytes = options.maxBytes ?? 8 * 1024 * 1024;
    this.#maxEntryBytes = options.maxEntryBytes ?? 16 * 1024;
    this.#now = options.now ?? Date.now;
    this.#onClear = options.onClear ?? null;
    this.#ring = new CircularBuffer<ITranscriptEntry>(this.#maxEntries);
    this.#sizes = new CircularBuffer<number>(this.#maxEntries);
  }

  /** Nombre d'entrées retenues. */
  get length(): number {
    return this.#ring.length;
  }

  /** Octets UTF-8 retenus, toutes entrées confondues. */
  get bytes(): number {
    return this.#bytes;
  }

  /** Numéro de la dernière entrée écrite (`0` tant que rien ne l'a été). */
  get lastSeq(): number {
    return this.#seq;
  }

  /**
   * Lit une entrée par position, la plus ancienne retenue en `0`.
   *
   * @param index - position, négative pour compter depuis la fin.
   * @returns l'entrée, ou `undefined` hors bornes.
   */
  at(index: number): ITranscriptEntry | undefined {
    return this.#ring.at(index);
  }

  /**
   * Position actuelle d'une entrée dans l'historique.
   *
   * @param seq - son numéro.
   * @returns sa position, ou `-1` si elle a été évincée ou n'existe pas encore.
   */
  indexOf(seq: number): number {
    const first = this.#ring.at(0);
    if (!first) return -1;
    const index = seq - first.seq;
    return index >= 0 && index < this.#ring.length ? index : -1;
  }

  /**
   * Les entrées postérieures à `seq`, dans l'ordre — de quoi reprendre une
   * lecture interrompue. Ce qui a été évincé entre-temps est perdu : la
   * première entrée rendue dit d'où l'on repart.
   *
   * @param seq - le dernier numéro déjà lu (`0` pour tout lire).
   * @param limit - nombre maximal d'entrées rendues.
   * @returns une copie bornée.
   */
  since(seq: number, limit = Number.POSITIVE_INFINITY): ITranscriptEntry[] {
    const first = this.#ring.at(0);
    if (!first) return [];
    const from = Math.max(0, seq - first.seq + 1);
    const to = Math.min(this.#ring.length, from + limit);
    const out: ITranscriptEntry[] = [];
    for (let i = from; i < to; i++) {
      const entry = this.#ring.at(i);
      if (entry) out.push(entry);
    }
    return out;
  }

  /**
   * Verse un paquet reçu d'une source. Les lignes complètes entrent dans
   * l'historique ; la fin sans `\n` reste en cours pour ce couple (source,
   * flux), jusqu'au paquet suivant ou à {@link DevTranscript.flush}.
   *
   * @param source - qui écrit.
   * @param stream - sur quel flux.
   * @param chunk - le paquet, octets bruts ou texte.
   * @param run - l'exécution que ces lignes accompagnent, s'il y en a une.
   */
  ingest(
    source: TranscriptSource,
    stream: TranscriptStream,
    chunk: Buffer | Uint8Array | string,
    run?: number,
  ): void {
    const pending = this.#pendingOf(source, stream);
    if (typeof chunk === "string") {
      let start = 0;
      let nl = chunk.indexOf("\n");
      while (nl !== -1) {
        this.#append(pending, source, chunk.slice(start, nl));
        this.#commit(pending, source, stream, run);
        start = nl + 1;
        nl = chunk.indexOf("\n", start);
      }
      if (start < chunk.length)
        this.#append(pending, source, chunk.slice(start));
      return;
    }
    const buf = Buffer.isBuffer(chunk)
      ? chunk
      : Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    let start = 0;
    let nl = buf.indexOf(0x0a);
    while (nl !== -1) {
      this.#append(
        pending,
        source,
        pending.decoder.write(buf.subarray(start, nl)),
      );
      this.#commit(pending, source, stream, run);
      start = nl + 1;
      nl = buf.indexOf(0x0a, start);
    }
    if (start < buf.length) {
      this.#append(pending, source, pending.decoder.write(buf.subarray(start)));
    }
  }

  /**
   * Termine les lignes en cours (une source qui s'arrête sans `\n` final) et
   * les verse dans l'historique.
   *
   * @param source - la source à terminer ; toutes si absente.
   */
  flush(source?: TranscriptSource): void {
    for (const key of Object.keys(this.#pending)) {
      const [owner, stream] = key.split(":") as [
        TranscriptSource,
        TranscriptStream,
      ];
      if (source !== undefined && owner !== source) continue;
      const pending = this.#pending[key];
      if (!pending) continue;
      this.#append(pending, owner, pending.decoder.end());
      if (pending.text.length > 0 || pending.truncated) {
        this.#commit(pending, owner, stream, undefined);
      }
      Reflect.deleteProperty(this.#pending, key);
    }
  }

  /** Vide l'historique et les lignes en cours ; la numérotation continue. */
  clear(): void {
    this.#ring.clear();
    this.#sizes.clear();
    this.#bytes = 0;
    for (const key of Object.keys(this.#pending)) {
      Reflect.deleteProperty(this.#pending, key);
    }
  }

  /** La ligne en cours d'un couple, créée au premier paquet. */
  #pendingOf(source: TranscriptSource, stream: TranscriptStream): IPendingLine {
    const key = `${source}:${stream}`;
    let pending = this.#pending[key];
    if (pending === undefined) {
      pending = {
        decoder: new StringDecoder("utf8"),
        text: "",
        truncated: false,
        carriageReturn: false,
      };
      this.#pending[key] = pending;
    }
    return pending;
  }

  /**
   * Ajoute un fragment décodé à la ligne en cours : `ESC[2J` devient un
   * évènement, `\r` repart de zéro, et la ligne ne dépasse jamais son plafond.
   */
  #append(
    pending: IPendingLine,
    source: TranscriptSource,
    fragment: string,
  ): void {
    if (fragment.length === 0) return;
    let text = fragment;
    let clear = text.indexOf(CLEAR);
    while (clear !== -1) {
      this.#extend(pending, text.slice(0, clear));
      this.#onClear?.(source);
      text = text.slice(clear + CLEAR.length);
      clear = text.indexOf(CLEAR);
    }
    this.#extend(pending, text);
  }

  /** Prolonge la ligne en cours, `\r` compris, sous le plafond par entrée. */
  #extend(pending: IPendingLine, fragment: string): void {
    if (fragment.length === 0) return;
    let text = fragment;
    // Un `\r` final ne sait pas encore s'il précède `\n` : il attend.
    const trailing = text.endsWith("\r");
    if (trailing) text = text.slice(0, -1);
    const cr = text.lastIndexOf("\r");
    if (pending.carriageReturn || cr !== -1) {
      pending.text = "";
      pending.truncated = false;
      if (cr !== -1) text = text.slice(cr + 1);
    }
    pending.carriageReturn = trailing;
    if (pending.truncated || text.length === 0) return;
    const next = pending.text + text;
    // Plafond par entrée, compté en octets ; `length` minore les octets UTF-8.
    if (
      next.length * 3 > this.#maxEntryBytes &&
      Buffer.byteLength(next) > this.#maxEntryBytes
    ) {
      const room = this.#maxEntryBytes - Buffer.byteLength(TRUNCATION_MARK);
      pending.text = cutToBytes(next, Math.max(0, room)) + TRUNCATION_MARK;
      pending.truncated = true;
      return;
    }
    pending.text = next;
  }

  /** Verse la ligne en cours dans l'historique, sous les deux plafonds. */
  #commit(
    pending: IPendingLine,
    source: TranscriptSource,
    stream: TranscriptStream,
    run: number | undefined,
  ): void {
    const text = sanitizeTerminalText(pending.text);
    pending.text = "";
    pending.truncated = false;
    pending.carriageReturn = false;
    const size = Buffer.byteLength(text);
    while (
      this.#ring.length > 0 &&
      (this.#ring.length >= this.#maxEntries ||
        this.#bytes + size > this.#maxBytes)
    ) {
      this.#ring.shift();
      this.#bytes -= this.#sizes.shift() ?? 0;
    }
    const entry: ITranscriptEntry =
      run === undefined
        ? { seq: ++this.#seq, source, stream, text, at: this.#now() }
        : { seq: ++this.#seq, source, stream, text, at: this.#now(), run };
    this.#ring.push(entry);
    this.#sizes.push(size);
    this.#bytes += size;
  }
}
