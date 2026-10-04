/**
 * Le terminal de `nodefony development`, côté superviseur — son SEUL
 * écrivain (ADR-0013 §1 et §5).
 *
 * Le serveur écrit dans des tubes ; le superviseur y verse aussi ses propres
 * lignes `[dev]` et son indicateur de build. Tout passe par
 * {@link DevTerminal.ingest}, qui fait deux choses de chaque paquet :
 *
 * - il l'**inscrit** dans l'historique (`DevTranscript`), qui nourrira le plein
 *   écran (#537), l'invite (#538) et la console d'administration ;
 * - il l'**affiche** sur la surface `inline` — le rendu de #533 : le texte part
 *   dans l'historique natif du terminal, et la barre d'état est redessinée en
 *   dernières lignes (`StatusLine`).
 *
 * Tout ce qui s'affiche est ASSAINI (`sanitizeTerminalText`) : une ligne de
 * journal ne pilote pas le terminal du développeur. Deux séquences gardent un
 * SENS : `ESC[2J` devient {@link DevTerminal.clear} (la page propre du serveur
 * prêt), et le retour en colonne 1 (`ESC[G`, ce qu'émet `readline.cursorTo`)
 * devient `\r`.
 */
import { StringDecoder } from "node:string_decoder";
import { isIncompleteControlSequence } from "../../runtime/textWidth";
import type { DevPhase } from "./devFrame";
import {
  DevTranscript,
  sanitizeTerminalText,
  type IDevTranscriptOptions,
  type ITranscriptEntry,
  type TranscriptSource,
  type TranscriptStream,
} from "./devTranscript";
import { CLEAR_SCREEN } from "./outputMode";
import {
  renderStatusBar,
  type IStartupView,
  type IStatusContext,
  type ScreenCharset,
} from "./startupScreen";
import { StatusLine, type IStatusStream } from "./statusLine";

/** Un flux de sortie du terminal, injectable en test. */
export interface IDevTerminalStream extends IStatusStream {
  rows?: number | undefined;
}

/** Réglages du terminal de développement. */
export interface IDevTerminalOptions {
  /** La sortie standard du superviseur — elle porte la barre. */
  stdout: IDevTerminalStream;
  /** Sa sortie d'erreur ; la sortie standard si absente. */
  stderr?: IDevTerminalStream;
  /** Couleurs de la barre. */
  color: boolean;
  /** Jeu de caractères de la barre. */
  charset: ScreenCharset;
  /** Les lignes de la marque (`brandMark`). */
  mark: readonly string[];
  /** Plafonds de l'historique. */
  transcript?: Omit<IDevTranscriptOptions, "onClear">;
}

/** Effacement d'écran : la seule séquence retirée qui garde un sens. */
const CLEAR = "\x1b[2J";

/** Retour en colonne 1 (`CHA`) : un `\r` qui ne dit pas son nom. */
const COLUMN_ONE = /\x1b\[[01]?G/g;

/**
 * Au-delà, une séquence qui ne se termine pas n'en est pas une : elle est
 * rendue telle quelle (et l'assainissement la retire) au lieu d'être retenue
 * indéfiniment. Couvre un hyperlien OSC 8 à l'URL longue.
 */
const MAX_PENDING_SEQUENCE = 4096;

/** Ce qui reste d'un paquet, par couple (source, flux), pour le suivant. */
interface IEchoState {
  decoder: StringDecoder;
  /** Une séquence de contrôle coupée par la fin du paquet. */
  carry: string;
}

/**
 * Le terminal de développement : historique + surface `inline` + barre
 * d'état, sous un seul propriétaire.
 */
export class DevTerminal {
  readonly #stdout: IDevTerminalStream;
  readonly #stderr: IDevTerminalStream;
  readonly #color: boolean;
  readonly #charset: ScreenCharset;
  readonly #mark: readonly string[];
  readonly #transcript: DevTranscript;
  readonly #status: StatusLine;
  /** États d'affichage par couple (source, flux) — une dizaine de clés au plus. */
  readonly #echo: Record<string, IEchoState> = Object.create(null) as Record<
    string,
    IEchoState
  >;
  #view: IStartupView | null = null;
  #context: IStatusContext | null = null;
  #phase: DevPhase = "booting";
  #closed = false;

  /**
   * @param options - flux, rendu de la barre, plafonds de l'historique.
   */
  constructor(options: IDevTerminalOptions) {
    this.#stdout = options.stdout;
    this.#stderr = options.stderr ?? options.stdout;
    this.#color = options.color;
    this.#charset = options.charset;
    this.#mark = options.mark;
    this.#transcript = new DevTranscript(options.transcript);
    // Les DEUX flux sont surveillés : une écriture sur la sortie d'erreur
    // efface aussi la barre avant elle, sinon elle s'y collerait.
    this.#status = new StatusLine(
      this.#stderr === this.#stdout
        ? [this.#stdout]
        : [this.#stdout, this.#stderr],
    );
  }

  /** L'historique, en lecture. */
  get transcript(): DevTranscript {
    return this.#transcript;
  }

  /** La phase courante du serveur. */
  get phase(): DevPhase {
    return this.#phase;
  }

  /**
   * Verse un paquet d'une source : inscrit dans l'historique, affiché sur la
   * surface `inline`. Une séquence coupée entre deux paquets attend la suite.
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
    if (this.#closed) return;
    const state = this.#echoOf(source, stream);
    let text =
      state.carry +
      (typeof chunk === "string"
        ? chunk
        : state.decoder.write(
            Buffer.isBuffer(chunk)
              ? chunk
              : Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength),
          ));
    state.carry = "";
    const cut = incompleteTail(text);
    if (cut !== -1) {
      state.carry = text.slice(cut);
      text = text.slice(0, cut);
    }
    if (text.length === 0) return;
    text = text.replace(COLUMN_ONE, "\r");
    const target = stream === "err" ? this.#stderr : this.#stdout;
    let start = 0;
    let clear = text.indexOf(CLEAR);
    while (clear !== -1) {
      this.#show(source, stream, target, text.slice(start, clear), run);
      this.clear();
      start = clear + CLEAR.length;
      clear = text.indexOf(CLEAR, start);
    }
    this.#show(source, stream, target, text.slice(start), run);
  }

  /**
   * Une source se tait (le serveur s'est arrêté) : sa ligne en cours entre
   * dans l'historique, et ce qu'elle retenait est oublié — le prochain
   * serveur repart d'un décodeur neuf.
   *
   * @param source - la source qui s'arrête.
   */
  flush(source: TranscriptSource): void {
    this.#transcript.flush(source);
    for (const key of Object.keys(this.#echo)) {
      if (key.startsWith(`${source}:`)) Reflect.deleteProperty(this.#echo, key);
    }
  }

  /**
   * Le bilan du serveur et la phase. La barre ne s'affiche que serveur prêt,
   * avec un bilan : pendant un build ou un redémarrage, elle n'aurait rien de
   * vrai à dire, et le rendu de #533 n'en montrait pas.
   *
   * @param view - le bilan, ou `null` (le serveur n'a rien dit).
   * @param context - projet, heure, rechargements, ou `null`.
   * @param phase - où en est le serveur.
   */
  setStatus(
    view: IStartupView | null,
    context: IStatusContext | null,
    phase: DevPhase,
  ): void {
    this.#view = view;
    this.#context = context;
    this.setPhase(phase);
  }

  /**
   * Change la phase en gardant le dernier bilan.
   *
   * @param phase - où en est le serveur.
   */
  setPhase(phase: DevPhase): void {
    this.#phase = phase;
    this.#renderStatus();
  }

  /** Le terminal a changé de taille : la barre est recomposée. */
  resize(): void {
    this.#renderStatus();
  }

  /**
   * Le sens de `ESC[2J` : sur la surface `inline`, l'écran visible est remis
   * à zéro (l'historique du terminal reste) — la page propre de #533.
   */
  clear(): void {
    if (this.#closed) return;
    this.#stdout.write(CLEAR_SCREEN);
  }

  /**
   * Les entrées postérieures à `seq` — cf `DevTranscript.since`.
   *
   * @param seq - le dernier numéro déjà lu.
   * @param limit - nombre maximal d'entrées.
   * @returns une copie bornée.
   */
  since(seq: number, limit?: number): ITranscriptEntry[] {
    return this.#transcript.since(seq, limit);
  }

  /**
   * Rend le terminal : la barre est retirée, les flux retrouvent leur
   * `write`. Idempotent — appelé à l'arrêt puis à `exit`, en filet.
   */
  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#transcript.flush();
    this.#status.release();
  }

  /** Inscrit et affiche un segment sans `ESC[2J`. */
  #show(
    source: TranscriptSource,
    stream: TranscriptStream,
    target: IDevTerminalStream,
    segment: string,
    run: number | undefined,
  ): void {
    if (segment.length === 0) return;
    this.#transcript.ingest(source, stream, segment, run);
    const safe = sanitizeTerminalText(segment);
    if (safe.length > 0) target.write(safe);
  }

  /** Dessine ou retire la barre selon la phase. */
  #renderStatus(): void {
    if (this.#closed) return;
    if (
      this.#phase !== "ready" ||
      this.#view === null ||
      this.#context === null
    ) {
      this.#status.hide();
      return;
    }
    this.#status.show(
      renderStatusBar(
        this.#view,
        this.#context,
        {
          color: this.#color,
          columns: this.#stdout.columns,
          rows: this.#stdout.rows,
          charset: this.#charset,
        },
        this.#mark,
      ),
    );
  }

  /** L'état d'affichage d'un couple, créé au premier paquet. */
  #echoOf(source: TranscriptSource, stream: TranscriptStream): IEchoState {
    const key = `${source}:${stream}`;
    let state = this.#echo[key];
    if (state === undefined) {
      state = { decoder: new StringDecoder("utf8"), carry: "" };
      this.#echo[key] = state;
    }
    return state;
  }
}

/**
 * Position de la première séquence de contrôle COUPÉE par la fin du texte.
 *
 * @param text - le texte reçu.
 * @returns sa position, ou `-1` si le texte se termine proprement.
 */
function incompleteTail(text: string): number {
  let esc = text.indexOf(
    "\x1b",
    Math.max(0, text.length - MAX_PENDING_SEQUENCE),
  );
  while (esc !== -1) {
    if (isIncompleteControlSequence(text, esc)) return esc;
    esc = text.indexOf("\x1b", esc + 1);
  }
  return -1;
}
