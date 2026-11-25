/**
 * L'historique de ce que le terminal de développement a montré : des lignes
 * logiques, assainies, bornées en nombre ET en octets — sans terminal.
 *
 * Le superviseur y verse la sortie du serveur, la sienne, celle des services
 * qu'il porte et des commandes lancées depuis l'invite ; l'écran
 * (`devFrame.ts`) en lit une fenêtre par index à chaque image. Cf ADR-0013 §3.
 *
 * Chaque ligne appartient à un CANAL, identifiant ouvert (`server`,
 * `supervisor`, `vite:<nom>`, `run:<n>`, `agent:<id>`) : un producteur neuf ne
 * rouvre pas le modèle. Un anneau peut porter un canal ou plusieurs ;
 * `DevHistory` (`devHistory.ts`) en tient un par canal, sous une numérotation
 * commune.
 *
 * Trois règles portent le module :
 * - **la découpe se fait sur le `Buffer`**, une ligne décodée à la fois :
 *   décoder un paquet entier puis le découper produirait des chaînes qui
 *   retiennent chacune le paquet parent ; un caractère UTF-8 coupé entre deux
 *   paquets est recomposé par un `StringDecoder` par couple (canal, flux) ;
 * - **une ligne en cours par couple (canal, flux)** : deux producteurs écrivent
 *   des fragments en même temps ; `\r` réinitialise la ligne en cours (un
 *   indicateur d'attente réécrit sa ligne, il n'empile pas cent entrées) ;
 * - **tout canal est assaini** ({@link sanitizeTerminalText}) : une ligne de
 *   journal ne pilote pas le terminal du développeur.
 */
import { StringDecoder } from "node:string_decoder";
import { CircularBuffer } from "../../runtime/CircularBuffer";
import { controlSequenceLength } from "../../runtime/textWidth";
import type { ProcessOutputStream } from "./heldChannel";

/**
 * La clé de l'état en cours d'un couple (canal, flux) — seule façon de la
 * composer, partagée par l'historique et le terminal.
 *
 * @param channel - le canal qui écrit.
 * @param stream - sur quel flux.
 * @returns `canal:flux`.
 */
export function channelKey(
  channel: string,
  stream: ProcessOutputStream,
): string {
  return `${channel}:${stream}`;
}

/** Une ligne logique de l'historique — objet plat, sérialisable en JSON. */
export interface ITranscriptEntry {
  /**
   * Numéro monotone, commun à tous les canaux d'un même historique : un
   * lecteur reprend « depuis seq N », même après éviction. Deux entrées d'un
   * même anneau ne se suivent donc pas forcément.
   */
  readonly seq: number;
  /** Le canal qui l'a écrite (`server`, `vite:default`, `run:3`…). */
  readonly channel: string;
  readonly stream: ProcessOutputStream;
  /** UNE ligne, assainie, sans `\n`, bornée (cf `maxEntryBytes`). */
  readonly text: string;
  /** `Date.now()` à la réception du paquet qui a fini la ligne. */
  readonly at: number;
}

/** Réglages de l'historique — les défauts sont ceux de l'ADR-0013. */
export interface IDevTranscriptOptions {
  /** Nombre maximal d'entrées retenues (défaut 10 000). */
  maxEntries?: number;
  /**
   * Mémoire retenue au plus, toutes entrées confondues (défaut 8 Mio) —
   * estimée par {@link transcriptEntryCost}, pas comptée en octets UTF-8.
   */
  maxBytes?: number;
  /** Octets UTF-8 au plus par entrée, au-delà tronquée avec marque (défaut 16 Kio). */
  maxEntryBytes?: number;
  /** Horloge, injectable en test. */
  now?: () => number;
  /**
   * Fournit le numéro de la prochaine entrée — partagé par les anneaux d'un
   * même historique ; par défaut, l'anneau numérote seul, à partir de 1.
   */
  nextSeq?: () => number;
  /**
   * Appelé quand un canal efface l'écran (`ESC[2J`) : la séquence n'entre
   * pas dans l'historique, son SENS est décidé par qui affiche.
   */
  onClear?: (channel: string) => void;
}

/** Cases de l'anneau allouées d'emblée ; il double ensuite à la demande. */
const INITIAL_SLOTS = 64;

/**
 * Ce qu'une entrée retient AU-DELÀ de ses caractères : l'objet, la chaîne
 * aplatie et sa tranche, la case de l'anneau. Mesuré sous V8 (100 000
 * entrées) : 141 à 147 octets selon la longueur.
 */
const ENTRY_OVERHEAD = 144;

/**
 * Mémoire qu'une ligne retient une fois dans l'historique — ce que le plafond
 * `maxBytes` compte. V8 range une chaîne sur un octet par caractère, ou sur
 * deux dès qu'un caractère sort de Latin-1 (`✓`, `—`, cadres) : compter les
 * octets UTF-8 sous-estimait la mémoire de trois à huit fois. Une ligne qui
 * n'est pas en ASCII est comptée sur deux octets par caractère — majorant pour
 * le Latin-1 accentué, exact au-delà.
 *
 * @param text - la ligne, assainie.
 * @returns les octets estimés.
 */
export function transcriptEntryCost(text: string): number {
  const length = text.length;
  return (
    ENTRY_OVERHEAD +
    (Buffer.byteLength(text, "utf8") === length ? length : 2 * length)
  );
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
 * Fin d'une couleur (`SGR`) ou d'un effacement de ligne (`EL`) qui commence
 * à `index` — les deux séquences gardées les plus fréquentes, reconnues sans
 * expression ni découpe. Rend exactement ce que `controlSequenceLength` puis
 * {@link isAllowedSequence} accepteraient pour elles ; toute autre séquence
 * suit le chemin général.
 *
 * @param text - le texte.
 * @param index - position d'un `ESC`.
 * @returns la position qui suit la séquence, ou `-1`.
 */
function keptSequenceEnd(text: string, index: number): number {
  if (text.charCodeAt(index + 1) !== 0x5b) return -1; // `[`
  let end = index + 2;
  let code = text.charCodeAt(end);
  // Paramètres de `SGR` : chiffres, `:` et `;` (0x30 à 0x3b).
  while (code >= 0x30 && code <= 0x3b) code = text.charCodeAt(++end);
  if (code === 0x6d) return end + 1; // `m`
  const params = end - index - 2;
  return code === 0x4b && // `K`, sans paramètre ou avec 0, 1, 2
    (params === 0 || (params === 1 && text.charCodeAt(index + 2) <= 0x32))
    ? end + 1
    : -1;
}

/** Les contrôles C0 et C1 autres que `ESC`, `\r` et `\n` — tabulation comprise. */
const OTHER_CONTROL = /[\x00-\x09\x0b\x0c\x0e-\x1a\x1c-\x1f\x7f-\x9f]/;

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
  // Voie rapide, la plus fréquente : aucun contrôle hors `ESC`, et chaque
  // `ESC` ouvre une couleur ou un effacement de ligne gardés — le texte
  // revient tel quel, sans boucle par caractère (−10 % sur une rafale, mesuré).
  if (!OTHER_CONTROL.test(text)) {
    let escape = text.indexOf("\x1b");
    while (escape !== -1) {
      const end = keptSequenceEnd(text, escape);
      if (end === -1) return sanitizeSlow(text);
      escape = text.indexOf("\x1b", end);
    }
    return text;
  }
  return sanitizeSlow(text);
}

/** {@link sanitizeTerminalText}, caractère par caractère. */
function sanitizeSlow(text: string): string {
  let out = "";
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    const isControl =
      code < 0x20 || code === 0x7f || (code >= 0x80 && code <= 0x9f);
    if (!isControl || code === 0x0d || code === 0x0a) continue;
    if (code === 0x1b) {
      // Couleur ou effacement de ligne : gardés tels quels, ils restent dans
      // la tranche en cours — une ligne qui n'a qu'eux revient intacte.
      const end = keptSequenceEnd(text, i);
      if (end !== -1) {
        i = end - 1;
        continue;
      }
    }
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

/** La ligne en cours d'un couple (canal, flux). */
interface IPendingLine {
  readonly channel: string;
  readonly stream: ProcessOutputStream;
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

/**
 * Une entrée retenue : forme fixe, déclarée au constructeur, et son coût
 * mémoire en champ PRIVÉ — ni sérialisé, ni visible des lecteurs, qui ne
 * voient qu'un {@link ITranscriptEntry}.
 */
class TranscriptEntry implements ITranscriptEntry {
  readonly seq: number;
  readonly channel: string;
  readonly stream: ProcessOutputStream;
  readonly text: string;
  readonly at: number;
  readonly #cost: number;

  constructor(
    seq: number,
    channel: string,
    stream: ProcessOutputStream,
    text: string,
    at: number,
    cost: number,
  ) {
    this.seq = seq;
    this.channel = channel;
    this.stream = stream;
    this.text = text;
    this.at = at;
    this.#cost = cost;
  }

  /** Le coût mémoire retenu pour une entrée (cf {@link transcriptEntryCost}). */
  static cost(entry: TranscriptEntry): number {
    return entry.#cost;
  }
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
 * L'historique borné d'un terminal de développement — un anneau.
 *
 * Coût : un objet par ligne logique, rien par paquet reçu au-delà des
 * tranches décodées et d'UNE lecture d'horloge ; l'éviction est en O(1) par
 * entrée (anneau), et l'anneau part de {@link INITIAL_SLOTS} cases. Le coût
 * mémoire d'une entrée est retenu DANS l'entrée (champ privé) : le recompter
 * à l'éviction relisait la chaîne une seconde fois.
 *
 * Les numéros (`seq`) croissent mais ne se suivent pas forcément quand
 * plusieurs anneaux partagent la numérotation ({@link IDevTranscriptOptions.nextSeq}) :
 * {@link DevTranscript.indexOf} et {@link DevTranscript.since} cherchent par
 * dichotomie, jamais par différence.
 */
export class DevTranscript {
  readonly #maxEntries: number;
  readonly #maxBytes: number;
  readonly #maxEntryBytes: number;
  readonly #now: () => number;
  readonly #nextSeq: () => number;
  readonly #onClear: ((channel: string) => void) | null;
  readonly #ring: CircularBuffer<TranscriptEntry>;
  /** Lignes en cours, par couple (canal, flux) — une dizaine de clés au plus. */
  readonly #pending: Record<string, IPendingLine> = Object.create(
    null,
  ) as Record<string, IPendingLine>;
  #bytes = 0;
  /** Numéro de la dernière entrée écrite DANS cet anneau. */
  #lastSeq = 0;
  /** L'heure du paquet en cours, lue à sa première ligne finie ; `-1` = pas encore lue. */
  #stamp = -1;

  /**
   * @param options - plafonds, horloge, numérotation, et qui prévenir d'un
   *   effacement d'écran.
   */
  constructor(options: IDevTranscriptOptions = {}) {
    this.#maxEntries = options.maxEntries ?? 10_000;
    this.#maxBytes = options.maxBytes ?? 8 * 1024 * 1024;
    this.#maxEntryBytes = options.maxEntryBytes ?? 16 * 1024;
    this.#now = options.now ?? Date.now;
    if (options.nextSeq !== undefined) {
      this.#nextSeq = options.nextSeq;
    } else {
      let seq = 0;
      this.#nextSeq = () => ++seq;
    }
    this.#onClear = options.onClear ?? null;
    this.#ring = new CircularBuffer<TranscriptEntry>(
      this.#maxEntries,
      INITIAL_SLOTS,
    );
  }

  /**
   * La ligne EN COURS d'un couple (canal, flux) — écrite sans fin de ligne,
   * comme l'indicateur de build qui se réécrit sur place. Un terminal la
   * montre déjà ; l'historique ne l'inscrit qu'à son `\n`.
   *
   * @param channel - le canal.
   * @param stream - sur quel flux.
   * @returns la ligne en cours, assainie, ou `""`.
   */
  partial(channel: string, stream: ProcessOutputStream): string {
    const pending = this.#pending[channelKey(channel, stream)];
    return pending === undefined || pending.text === ""
      ? ""
      : sanitizeTerminalText(pending.text);
  }

  /** Nombre d'entrées retenues. */
  get length(): number {
    return this.#ring.length;
  }

  /** Mémoire retenue, toutes entrées confondues (cf {@link transcriptEntryCost}). */
  get bytes(): number {
    return this.#bytes;
  }

  /**
   * Numéro de la dernière entrée écrite dans cet anneau (`0` tant que rien ne
   * l'a été) — gardé après {@link DevTranscript.clear} et après éviction.
   */
  get lastSeq(): number {
    return this.#lastSeq;
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
   * Position actuelle d'une entrée dans l'historique, par dichotomie.
   *
   * @param seq - son numéro.
   * @returns sa position, ou `-1` si elle a été évincée, n'existe pas encore,
   *   ou appartient à un autre anneau.
   */
  indexOf(seq: number): number {
    const index = this.#firstAfter(seq - 1);
    return this.#ring.at(index)?.seq === seq ? index : -1;
  }

  /**
   * Nombre d'entrées retenues dont le numéro dépasse `seq` — ce qu'un lecteur
   * ancré sur `seq` n'a pas encore vu.
   *
   * @param seq - le numéro de l'ancre.
   * @returns le compte, `0` à `length`.
   */
  countAfter(seq: number): number {
    return this.#ring.length - this.#firstAfter(seq);
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
    const from = this.#firstAfter(seq);
    const to = Math.min(this.#ring.length, from + limit);
    const out: ITranscriptEntry[] = [];
    for (let i = from; i < to; i++) {
      const entry = this.#ring.at(i);
      if (entry) out.push(entry);
    }
    return out;
  }

  /**
   * Verse un paquet reçu d'un canal. Les lignes complètes entrent dans
   * l'historique ; la fin sans `\n` reste en cours pour ce couple (canal,
   * flux), jusqu'au paquet suivant ou à {@link DevTranscript.flush}.
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
    const pending = this.#pendingOf(channel, stream);
    this.#stamp = -1;
    if (typeof chunk === "string") {
      let start = 0;
      let nl = chunk.indexOf("\n");
      while (nl !== -1) {
        this.#append(pending, chunk.slice(start, nl));
        this.#commit(pending);
        start = nl + 1;
        nl = chunk.indexOf("\n", start);
      }
      if (start < chunk.length) this.#append(pending, chunk.slice(start));
      return;
    }
    const buf = Buffer.isBuffer(chunk)
      ? chunk
      : Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    let start = 0;
    let nl = buf.indexOf(0x0a);
    while (nl !== -1) {
      this.#append(pending, pending.decoder.write(buf.subarray(start, nl)));
      this.#commit(pending);
      start = nl + 1;
      nl = buf.indexOf(0x0a, start);
    }
    if (start < buf.length) {
      this.#append(pending, pending.decoder.write(buf.subarray(start)));
    }
  }

  /**
   * Termine les lignes en cours (un canal qui s'arrête sans `\n` final) et
   * les verse dans l'historique.
   *
   * @param channel - le canal à terminer ; tous si absent.
   */
  flush(channel?: string): void {
    this.#stamp = -1;
    for (const key of Object.keys(this.#pending)) {
      const pending = this.#pending[key];
      if (!pending) continue;
      if (channel !== undefined && pending.channel !== channel) continue;
      this.#append(pending, pending.decoder.end());
      if (pending.text.length > 0 || pending.truncated) this.#commit(pending);
      Reflect.deleteProperty(this.#pending, key);
    }
  }

  /**
   * Évince l'entrée la plus ancienne — pour un plafond tenu au-dessus de
   * l'anneau (le plafond global de `DevHistory`).
   *
   * @returns la mémoire libérée, `0` si l'anneau est vide.
   */
  evictOldest(): number {
    const entry = this.#ring.shift();
    if (entry === undefined) return 0;
    const cost = TranscriptEntry.cost(entry);
    this.#bytes -= cost;
    return cost;
  }

  /** Vide l'historique et les lignes en cours ; la numérotation continue. */
  clear(): void {
    this.#ring.clear();
    this.#bytes = 0;
    for (const key of Object.keys(this.#pending)) {
      Reflect.deleteProperty(this.#pending, key);
    }
  }

  /**
   * Première position dont le numéro dépasse `seq` (`length` s'il n'y en a
   * pas) — dichotomie : les numéros croissent, sans se suivre.
   */
  #firstAfter(seq: number): number {
    let low = 0;
    let high = this.#ring.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if ((this.#ring.at(middle)?.seq ?? 0) > seq) high = middle;
      else low = middle + 1;
    }
    return low;
  }

  /** La ligne en cours d'un couple, créée au premier paquet. */
  #pendingOf(channel: string, stream: ProcessOutputStream): IPendingLine {
    const key = channelKey(channel, stream);
    let pending = this.#pending[key];
    if (pending === undefined) {
      pending = {
        channel,
        stream,
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
  #append(pending: IPendingLine, fragment: string): void {
    if (fragment.length === 0) return;
    let text = fragment;
    let clear = text.indexOf(CLEAR);
    while (clear !== -1) {
      this.#extend(pending, text.slice(0, clear));
      this.#onClear?.(pending.channel);
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
    // `lastIndexOf` est lent sous V8 ; `includes` dit d'abord s'il y a lieu.
    const cr = text.includes("\r") ? text.lastIndexOf("\r") : -1;
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
  #commit(pending: IPendingLine): void {
    // Recopie à plat, une fois par ligne : la ligne en cours est faite de
    // tranches (`slice`) qui RETIENNENT leur chaîne mère dans V8 — une ligne
    // courte découpée d'un paquet de 60 Ko garderait les 60 Ko vivants, et
    // `#maxBytes` ne bornerait plus que des chiffres. Concaténer puis
    // découper force V8 à aplatir dans une chaîne NEUVE, seule retenue par
    // la tranche — une copie, là où un aller-retour par un tampon en faisait
    // deux et allouait le tampon.
    const text = (" " + sanitizeTerminalText(pending.text)).slice(1);
    const cost = transcriptEntryCost(text);
    pending.text = "";
    pending.truncated = false;
    pending.carriageReturn = false;
    while (
      this.#ring.length > 0 &&
      (this.#ring.length >= this.#maxEntries ||
        this.#bytes + cost > this.#maxBytes)
    ) {
      this.evictOldest();
    }
    const seq = this.#nextSeq();
    this.#lastSeq = seq;
    if (this.#stamp === -1) this.#stamp = this.#now();
    this.#ring.push(
      new TranscriptEntry(
        seq,
        pending.channel,
        pending.stream,
        text,
        this.#stamp,
        cost,
      ),
    );
    this.#bytes += cost;
  }
}
