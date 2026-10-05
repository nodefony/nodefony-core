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
 *
 * Sur la surface `fullscreen` (ADR-0013 §2, #537), rien ne part dans
 * l'historique natif : l'écran alternatif est redessiné par IMAGES
 * (`renderFrame` → `diffFrame`), au plus une toutes les 16 ms, chacune en UNE
 * écriture. Le clavier passe en mode brut ; ses évènements traversent une
 * chaîne de foyers (§4) — défilement, puis global (Ctrl+C, Ctrl+D).
 */
import { StringDecoder } from "node:string_decoder";
import { BRAILLE_FRAMES, LINE_FRAMES } from "../../cli/progress";
import { isIncompleteControlSequence } from "../../runtime/textWidth";
import { guardTerminal } from "../../runtime/terminalGuard";
import {
  FrameHeights,
  diffFrame,
  frameJournalRows,
  renderFrame,
  scrollAnchor,
  topAnchor,
  type DevPhase,
  type IFrame,
  type IFrameModel,
  type IFrameSize,
  type IScrollAnchor,
} from "./devFrame";
import {
  extractSelection,
  selectionRange,
  type ISelection,
  type ISelectionPoint,
  type ISelectionRange,
  type SelectionUnit,
} from "./devSelection";
import {
  ESCAPE_TIMEOUT_MS,
  InputDecoder,
  type InputEvent,
} from "./inputDecoder";
import {
  TERMINAL_PROBE,
  interpretProbe,
  type IProbeResult,
} from "./terminalCapability";
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
  type IRuntimeSample,
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
  /**
   * Le nom du projet, pour la barre du plein écran AVANT que le serveur ait
   * donné son bilan : pendant un premier build, elle dit déjà la phase.
   */
  project?: string;
  /** Version du framework, pour la barre d'avant le premier bilan. */
  version?: string;
  /**
   * Le plein écran (écran alternatif, clavier en mode brut). Absent : surface
   * `inline`, le rendu de #533.
   */
  fullscreen?: IDevFullscreenOptions;
}

/** Ce que le plein écran exige — rien n'y est deviné. */
export interface IDevFullscreenOptions {
  /** Le clavier : passé en mode brut, ses octets décodés. */
  input: IDevTerminalInput;
  /** La sonde a vu la sortie synchronisée (mode 2026). */
  synchronized: boolean;
  /**
   * Ctrl+C et Ctrl+D : en mode brut, ce ne sont plus des signaux mais des
   * touches. Le propriétaire du processus décide de l'arrêt.
   */
  onQuit: () => void;
  /**
   * Capture de la souris (`--mouse`) : la molette défile partout où la
   * souris est rapportée, glisser sélectionne et copie. Absente : la souris
   * reste au terminal (mode 1007 seul).
   */
  mouse?: boolean;
  /**
   * Copie le texte sélectionné (souris captée, au relâchement) ; rend le
   * message de la barre — « copié », « envoyé au terminal », ou l'échec.
   * Absente : la sélection se surligne, rien n'est copié.
   */
  copy?: (text: string) => Promise<string>;
}

/** Le clavier du terminal, injectable en test. */
export interface IDevTerminalInput {
  setRawMode?: (mode: boolean) => unknown;
  on(event: "data", listener: (chunk: Buffer | string) => void): unknown;
  removeListener(
    event: "data",
    listener: (chunk: Buffer | string) => void,
  ): unknown;
  resume(): unknown;
  pause(): unknown;
}

/** Un foyer de la chaîne de touches (ADR-0013 §4). */
export interface IInputFocus {
  /**
   * @param event - l'évènement décodé.
   * @returns `true` s'il est consommé : la chaîne s'arrête.
   */
  handle(event: InputEvent): boolean;
}

/** La surface d'affichage du terminal. */
export type DevSurface = "inline" | "fullscreen";

/** Effacement d'écran : la seule séquence retirée qui garde un sens. */
const CLEAR = "\x1b[2J";

/** Au plus une image toutes les 16 ms (ADR-0013 §9). */
const FRAME_INTERVAL_MS = 16;

/**
 * Entrée en plein écran : écran alternatif, défilement alterné (mode 1007),
 * collage entre crochets, curseur masqué, page vierge.
 *
 * Le mode 1007 est TOUJOURS posé : le terminal traduit la molette en flèches.
 * Là où la souris est rapportée, la capture (`MOUSE_CAPTURE`) l'emporte sur
 * lui ; là où un réglage la refuse (iTerm2, Terminal.app, Warp), la molette
 * arrive encore — en flèches. Sans capture (`--no-mouse`, le défaut), la
 * souris reste au terminal et la sélection native marche sans touche.
 */
const ENTER_FULLSCREEN =
  "\x1b[?1049h\x1b[?1007h\x1b[?2004h\x1b[?25l\x1b[H\x1b[2J";

/**
 * Capture de la souris : clics (1000), glisser bouton enfoncé (1002),
 * coordonnées SGR (1006). Jamais 1003 (tout mouvement : une inondation) ni
 * 1004 (focus).
 */
const MOUSE_CAPTURE = "\x1b[?1000h\x1b[?1002h\x1b[?1006h";

/**
 * Sortie : tout l'inverse, curseur rendu, écran d'avant restauré. Les modes
 * de souris sont coupés même s'ils n'ont pas été posés — un mode qu'on n'a
 * pas posé se coupe sans effet, un mode oublié laisse le shell recevoir des
 * séquences à chaque clic.
 */
const LEAVE_FULLSCREEN =
  "\x1b[?1006l\x1b[?1002l\x1b[?1000l\x1b[?2004l\x1b[?1007l\x1b[?25h\x1b[?1049l";

/**
 * Lignes par cran de molette captée : ce qu'envoie un cran traduit par le
 * terminal en mode 1007 (trois flèches) — capturée ou non, la molette défile
 * pareil.
 */
const WHEEL_LINES = 3;

/** Cadence du tourniquet de la barre — celle de l'indicateur du superviseur. */
const SPIN_INTERVAL_MS = 80;

/**
 * L'image courante du tourniquet, tirée de l'horloge : aucun compteur à
 * tenir, et deux images d'une même seconde concordent. Les jeux d'images
 * sont ceux de `cli/progress.ts`.
 */
function spinnerFrame(charset: ScreenCharset): string {
  const frames = charset === "ascii" ? LINE_FRAMES : BRAILLE_FRAMES;
  return (
    frames[Math.floor(Date.now() / SPIN_INTERVAL_MS) % frames.length] ?? ""
  );
}

/** Délai entre deux clics au même endroit pour un double (ou triple) clic. */
const MULTI_CLICK_MS = 400;

/** Simple, double, triple clic. */
const CLICK_UNITS: readonly SelectionUnit[] = ["char", "word", "line"];

/** Glisser au bord du journal : lignes par pas, et cadence (patron Textual). */
const EDGE_LINES = 3;
const EDGE_INTERVAL_MS = 60;

/** Durée d'affichage d'un message passager dans la barre. */
const NOTICE_MS = 3000;

/** Dimensions de repli d'un flux qui n'en déclare pas. */
const FALLBACK_SIZE: IFrameSize = { columns: 80, rows: 24 };

/** Retour en colonne 1 (`CHA`) : un `\r` qui ne dit pas son nom. */
const COLUMN_ONE = /\x1b\[[01]?G/g;

/**
 * Au-delà, une séquence qui ne se termine pas n'en est pas une : elle est
 * rendue telle quelle (et l'assainissement la retire) au lieu d'être retenue
 * indéfiniment. Couvre un hyperlien OSC 8 à l'URL longue.
 */
const MAX_PENDING_SEQUENCE = 4096;

/**
 * Délai d'attente de la sonde. Un terminal local répond en quelques
 * millisecondes ; au-delà, il est déclaré muet. ⚠️ Une réponse arrivée APRÈS
 * le délai tombe sur un clavier repassé en mode cuit, qui l'affiche : le
 * délai doit couvrir une session distante, pas seulement le poste.
 */
export const PROBE_TIMEOUT_MS = 500;

/**
 * Interroge le terminal : passe le clavier en mode brut, envoie
 * `TERMINAL_PROBE`, lit les réponses jusqu'à la sentinelle (position du
 * curseur) ou au délai, puis rend le clavier tel qu'il était. Le mode brut
 * est gardé par `guardTerminal` le temps de la sonde.
 *
 * @param input - le clavier.
 * @param output - le terminal.
 * @param timeoutMs - délai au-delà duquel le terminal est déclaré muet.
 * @returns ce que la sonde a établi.
 */
export async function probeTerminal(
  input: IDevTerminalInput,
  output: { write(chunk: string): unknown },
  timeoutMs = PROBE_TIMEOUT_MS,
): Promise<IProbeResult> {
  const decoder = new InputDecoder();
  const events: InputEvent[] = [];
  const cooked = (): void => {
    input.setRawMode?.(false);
  };
  const release = guardTerminal(cooked);
  input.setRawMode?.(true);
  try {
    return await new Promise<IProbeResult>((resolve) => {
      const finish = (): void => {
        clearTimeout(timer);
        input.removeListener("data", onData);
        input.pause();
        resolve(interpretProbe(events));
      };
      const onData = (chunk: Buffer | string): void => {
        events.push(...decoder.feed(chunk));
        if (interpretProbe(events).complete) finish();
      };
      const timer = setTimeout(finish, timeoutMs);
      input.on("data", onData);
      input.resume();
      output.write(TERMINAL_PROBE);
    });
  } finally {
    release();
    cooked();
  }
}

/** Ce que possède le plein écran, de l'entrée à la restauration. */
interface IFullscreenState {
  input: IDevTerminalInput;
  synchronized: boolean;
  mouse: boolean;
  copy: ((text: string) => Promise<string>) | null;
  /** La sélection à la souris — `null` sans sélection. */
  selection: ISelection | null;
  /** Le bouton est tenu depuis un `press` dans le journal. */
  selecting: boolean;
  /** La souris a bougé depuis le `press` : un simple clic ne sélectionne rien. */
  dragged: boolean;
  /** Le dernier `press`, pour reconnaître double et triple clic. */
  lastPress: { at: number; row: number; column: number; clicks: number } | null;
  /** Message passager de la barre (résultat d'une copie). */
  notice: string | null;
  noticeTimer: NodeJS.Timeout | null;
  /** Glisser au bord du journal : sens (1 = remonter) et point du bord. */
  edge: { direction: 1 | -1; row: number; column: number } | null;
  edgeTimer: NodeJS.Timeout | null;
  /** Anime le tourniquet de la barre pendant une phase active. */
  spinTimer: NodeJS.Timeout | null;
  /** Ligne du dernier évènement du glisser — le bord haut s'arme à l'ARRIVÉE. */
  dragRow: number;
  /**
   * Les copies, l'une après l'autre : un triple clic suit toujours un double
   * clic qui a déjà copié le mot — en parallèle, le presse-papiers garderait
   * celui qui finit le dernier, et deux OSC 52 partiraient en rafale.
   */
  copying: Promise<void>;
  /** La sélection normalisée, calculée une fois par sélection. */
  range: { of: ISelection; value: ISelectionRange | null } | null;
  onQuit: () => void;
  onData: (chunk: Buffer | string) => void;
  decoder: InputDecoder;
  escapeTimer: NodeJS.Timeout | null;
  frameTimer: NodeJS.Timeout | null;
  lastFrameAt: number;
  /** L'image à l'écran — `null` : tout redessiner. */
  frame: IFrame | null;
  heights: FrameHeights;
  anchor: IScrollAnchor | null;
  floorSeq: number | undefined;
  /** La chaîne de foyers, du premier servi au dernier. */
  foci: IInputFocus[];
  releaseGuard: () => void;
}

/**
 * Le curseur après le dessin : sur l'invite quand elle existe (visible),
 * masqué sinon.
 */
function cursorSequence(frame: IFrame): string {
  if (frame.cursor === null) return "";
  return `\x1b[${frame.cursor.row + 1};${frame.cursor.column + 1}H\x1b[?25h`;
}

/**
 * Hauteur du journal dans l'image affichée : jusqu'à sa dernière ligne
 * d'origine connue — en dessous, indicateur, invite et barre.
 */
function journalRowsOf(frame: IFrame | null): number {
  const origins = frame?.origins;
  if (origins === undefined) return 0;
  for (let i = origins.length - 1; i >= 0; i--) {
    if (origins[i] !== null) return i + 1;
  }
  return 0;
}

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
  readonly #project: string | null;
  readonly #version: string | null;
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
  /** Début de la phase courante — la durée affichée en part. */
  #phaseSince = Date.now();
  /** L'étape de la phase en cours et sa progression (build, démarrage). */
  #step: string | null = null;
  #progress: { done: number; total: number } | null = null;
  /** Un problème qui persiste serveur prêt (build en échec, serveur conservé). */
  #issue: string | null = null;
  /** Le dernier échantillon runtime du serveur — `null` hors serveur prêt. */
  #runtime: IRuntimeSample | null = null;
  #closed = false;
  #surface: DevSurface = "inline";
  /** Tout ce que le plein écran possède — `null` sur la surface `inline`. */
  #full: IFullscreenState | null = null;

  /**
   * @param options - flux, rendu de la barre, plafonds de l'historique, et
   *   le plein écran s'il est demandé.
   */
  constructor(options: IDevTerminalOptions) {
    this.#stdout = options.stdout;
    this.#stderr = options.stderr ?? options.stdout;
    this.#color = options.color;
    this.#charset = options.charset;
    this.#mark = options.mark;
    this.#project = options.project ?? null;
    this.#version = options.version ?? null;
    this.#transcript = new DevTranscript(options.transcript);
    // Les DEUX flux sont surveillés : une écriture sur la sortie d'erreur
    // efface aussi la barre avant elle, sinon elle s'y collerait.
    this.#status = new StatusLine(
      this.#stderr === this.#stdout
        ? [this.#stdout]
        : [this.#stdout, this.#stderr],
    );
    if (options.fullscreen) this.#enterFullscreen(options.fullscreen);
  }

  /** L'historique, en lecture. */
  get transcript(): DevTranscript {
    return this.#transcript;
  }

  /** La surface courante — `inline` après la sortie du plein écran. */
  get surface(): DevSurface {
    return this.#surface;
  }

  /** L'ancre du journal en plein écran, `null` en direct. */
  get anchor(): IScrollAnchor | null {
    return this.#full?.anchor ?? null;
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
    if (phase !== this.#phase) {
      this.#phaseSince = Date.now();
      this.#step = null;
      this.#progress = null;
      // Les mesures d'un serveur qui s'arrête ne disent plus rien de vrai.
      if (phase !== "ready") this.#runtime = null;
    }
    this.#phase = phase;
    this.#syncSpinner();
    this.#renderStatus();
  }

  /**
   * L'étape en cours de la phase — ce que la partie centrale de la barre
   * dit, avec sa progression quand elle est connue (étapes du noyau, bundles
   * Vite). Remise à zéro par un changement de phase.
   *
   * @param step - le libellé, ou `null` pour l'effacer.
   * @param progress - unités faites sur le total, si on le sait.
   */
  setActivity(
    step: string | null,
    progress?: { done: number; total: number },
  ): void {
    this.#step = step;
    this.#progress = progress ?? null;
    if (this.#full) this.#scheduleFrame();
  }

  /**
   * Le dernier échantillon runtime du serveur prêt (mémoire, CPU, boucle) —
   * la barre du plein écran le montre ; la surface `inline` l'ignore, pour ne
   * pas réécrire ses dernières lignes toutes les deux secondes.
   *
   * @param sample - l'échantillon.
   */
  setRuntime(sample: IRuntimeSample): void {
    if (this.#phase !== "ready") return;
    this.#runtime = sample;
    if (this.#full) this.#scheduleFrame();
  }

  /**
   * Un problème qui PERSISTE serveur prêt — un build en échec, le serveur
   * précédent conservé : la ligne d'état le dit au lieu de « prêt ».
   *
   * @param issue - le message, ou `null` quand il est levé.
   */
  setIssue(issue: string | null): void {
    if (issue === this.#issue) return;
    this.#issue = issue;
    this.#renderStatus();
  }

  /**
   * Le tourniquet de la barre n'anime que pendant une phase ACTIVE, en plein
   * écran : une image toutes les 80 ms, aucun minuteur serveur prêt.
   */
  #syncSpinner(): void {
    const full = this.#full;
    if (!full) return;
    const busy =
      this.#phase === "building" ||
      this.#phase === "booting" ||
      this.#phase === "restarting";
    if (busy && full.spinTimer === null) {
      full.spinTimer = setInterval(
        () => this.#scheduleFrame(),
        SPIN_INTERVAL_MS,
      );
      full.spinTimer.unref();
    } else if (!busy && full.spinTimer !== null) {
      clearInterval(full.spinTimer);
      full.spinTimer = null;
    }
  }

  /**
   * Le terminal a changé de taille : la barre est recomposée ; en plein
   * écran, l'image entière est redessinée (hauteurs repliées invalidées par
   * la nouvelle largeur), la fenêtre restant ancrée sur la même entrée.
   */
  resize(): void {
    if (this.#full) {
      this.#full.frame = null;
      this.#scheduleFrame();
      return;
    }
    this.#renderStatus();
  }

  /**
   * Le sens de `ESC[2J` : sur la surface `inline`, l'écran visible est remis
   * à zéro (l'historique du terminal reste) — la page propre de #533. En
   * plein écran, le direct ne montre plus rien d'antérieur ; remonter le
   * journal le retrouve.
   */
  clear(): void {
    if (this.#closed) return;
    if (this.#full) {
      this.#full.floorSeq = this.#transcript.lastSeq;
      this.#scheduleFrame();
      return;
    }
    this.#stdout.write(CLEAR_SCREEN);
  }

  /**
   * Insère un foyer EN TÊTE de la chaîne : il voit les touches avant le
   * défilement et l'arrêt (l'invite de #538 s'y branche).
   *
   * @param focus - le foyer.
   * @returns son retrait.
   */
  addFocus(focus: IInputFocus): () => void {
    const full = this.#full;
    if (!full) return () => {};
    full.foci.unshift(focus);
    return () => {
      const index = full.foci.indexOf(focus);
      if (index !== -1) full.foci.splice(index, 1);
    };
  }

  /**
   * Fait traverser la chaîne de foyers à un évènement — atteignable hors
   * clavier : une entrée venue d'ailleurs y entre sans rien rouvrir.
   *
   * @param event - l'évènement décodé.
   * @returns `true` si un foyer l'a consommé.
   */
  dispatch(event: InputEvent): boolean {
    const full = this.#full;
    if (!full) return false;
    for (const focus of full.foci) {
      if (focus.handle(event)) return true;
    }
    return false;
  }

  /**
   * Quitte le plein écran : le terminal est rendu (écran d'avant, mode cuit,
   * défilement alterné et collage coupés, curseur visible), puis les dernières lignes du
   * journal y sont recopiées — l'erreur lue avant Ctrl+C reste dans
   * l'historique du shell. La suite s'affiche en `inline`. Idempotent.
   */
  leaveFullscreen(): void {
    const full = this.#full;
    if (!full) return;
    full.releaseGuard();
    const size = this.#size();
    const live = { ...this.#model(full), anchor: null };
    const journal = renderFrame(live, size).lines.slice(
      0,
      frameJournalRows(live, size),
    );
    this.#restoreTerminal(full);
    // Le remplissage n'est pas du journal : ni en tête (remonté), ni en fin
    // (page en direct alignée en haut) il ne part dans l'historique du shell.
    while (journal.length > 0 && journal[0] === "") journal.shift();
    while (journal.length > 0 && journal.at(-1) === "") journal.pop();
    if (journal.length > 0) this.#stdout.write(`${journal.join("\n")}\n`);
    this.#renderStatus();
  }

  /**
   * Écrit une séquence brute sur le terminal — en plein écran SEULEMENT :
   * hors de lui, la barre `inline` intercepte les écritures, et une séquence
   * sans fin de ligne l'effacerait jusqu'au prochain `\n`. Sert l'OSC 52 du
   * presse-papiers.
   *
   * @param sequence - la séquence, déjà formée.
   * @returns `false` si le plein écran est quitté (rien n'est écrit).
   */
  writeRaw(sequence: string): boolean {
    if (this.#full === null) return false;
    this.#stdout.write(sequence);
    return true;
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
    this.leaveFullscreen();
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
    if (this.#full) {
      this.#scheduleFrame();
      return;
    }
    const safe = sanitizeTerminalText(segment);
    if (safe.length > 0) target.write(safe);
  }

  /** Dessine ou retire la barre selon la phase. */
  #renderStatus(): void {
    if (this.#closed) return;
    if (this.#full) {
      this.#scheduleFrame();
      return;
    }
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

  /**
   * Passe en plein écran : séquences d'entrée, clavier en mode brut, garde
   * de restauration posée AVANT tout dessin — un terminal dans cet état doit
   * être rendu sur tous les chemins de sortie.
   */
  #enterFullscreen(options: IDevFullscreenOptions): void {
    const full: IFullscreenState = {
      input: options.input,
      synchronized: options.synchronized,
      mouse: options.mouse === true,
      copy: options.copy ?? null,
      selection: null,
      selecting: false,
      dragged: false,
      lastPress: null,
      edge: null,
      edgeTimer: null,
      spinTimer: null,
      dragRow: 0,
      copying: Promise.resolve(),
      range: null,
      notice: null,
      noticeTimer: null,
      onQuit: options.onQuit,
      onData: (chunk) => this.#onInput(chunk),
      decoder: new InputDecoder(),
      escapeTimer: null,
      frameTimer: null,
      lastFrameAt: 0,
      frame: null,
      heights: new FrameHeights(),
      anchor: null,
      floorSeq: undefined,
      foci: [],
      releaseGuard: () => {},
    };
    if (full.mouse) full.foci.push(this.#mouseFocus(full));
    full.foci.push(this.#scrollFocus(full), this.#globalFocus(full));
    this.#full = full;
    this.#surface = "fullscreen";
    full.releaseGuard = guardTerminal(() => this.#restoreTerminal(full));
    this.#stdout.write(
      full.mouse ? ENTER_FULLSCREEN + MOUSE_CAPTURE : ENTER_FULLSCREEN,
    );
    full.input.setRawMode?.(true);
    full.input.on("data", full.onData);
    full.input.resume();
    this.#syncSpinner();
    this.#scheduleFrame();
  }

  /** Rend le terminal — idempotent, appelé par l'arrêt OU par la garde. */
  #restoreTerminal(full: IFullscreenState): void {
    if (this.#full !== full) return;
    this.#full = null;
    this.#surface = "inline";
    if (full.frameTimer) clearTimeout(full.frameTimer);
    if (full.escapeTimer) clearTimeout(full.escapeTimer);
    if (full.noticeTimer) clearTimeout(full.noticeTimer);
    if (full.edgeTimer) clearInterval(full.edgeTimer);
    if (full.spinTimer) clearInterval(full.spinTimer);
    full.input.removeListener("data", full.onData);
    full.input.setRawMode?.(false);
    full.input.pause();
    this.#stdout.write(LEAVE_FULLSCREEN);
  }

  /** Octets du clavier → évènements → chaîne de foyers. */
  #onInput(chunk: Buffer | string): void {
    const full = this.#full;
    if (!full) return;
    if (full.escapeTimer) {
      clearTimeout(full.escapeTimer);
      full.escapeTimer = null;
    }
    for (const event of full.decoder.feed(chunk)) this.dispatch(event);
    // Un Échap seul est indiscernable d'un début de séquence : il attend un
    // court instant sans octet avant d'être rendu.
    if (full.decoder.pending) {
      full.escapeTimer = setTimeout(() => {
        full.escapeTimer = null;
        for (const event of full.decoder.flush()) this.dispatch(event);
      }, ESCAPE_TIMEOUT_MS);
    }
  }

  /**
   * Foyer de la souris captée : enfoncer le bouton gauche dans le journal
   * pose l'ancre, glisser étend, relâcher copie. Double clic = mot, triple
   * = ligne. Un simple clic efface la sélection sans rien copier ; Échap
   * l'efface aussi. Les autres boutons sont avalés : la souris est à nous.
   */
  #mouseFocus(full: IFullscreenState): IInputFocus {
    return {
      handle: (event) => {
        if (event.kind === "key") {
          if (event.key !== "escape" || full.selection === null) return false;
          this.#setSelection(full, null);
          return true;
        }
        if (event.kind !== "mouse") return false;
        if (event.button !== 0) return true;
        if (event.action === "press") {
          // Un clic hors du journal (barre, indicateur) ne vise aucune ligne.
          const point = this.#pointAt(full, event.row, event.column, true);
          const now = Date.now();
          const last = full.lastPress;
          const clicks =
            last !== null &&
            now - last.at < MULTI_CLICK_MS &&
            last.row === event.row &&
            last.column === event.column
              ? (last.clicks % 3) + 1
              : 1;
          full.lastPress = {
            at: now,
            row: event.row,
            column: event.column,
            clicks,
          };
          full.selecting = point !== null;
          full.dragged = false;
          full.dragRow = event.row;
          this.#setSelection(
            full,
            point === null
              ? null
              : {
                  anchor: point,
                  head: point,
                  unit: CLICK_UNITS[clicks - 1] ?? "char",
                },
          );
          return true;
        }
        if (!full.selecting || full.selection === null) return true;
        if (event.action === "drag") {
          this.#followEdge(full, event.row, event.column);
          const head = this.#pointAt(full, event.row, event.column);
          if (head !== null) {
            full.dragged = true;
            this.#setSelection(full, { ...full.selection, head });
          }
          return true;
        }
        if (event.action === "release") {
          full.selecting = false;
          this.#stopEdge(full);
          this.#finishSelection(full);
        }
        return true;
      },
    };
  }

  /**
   * Fin du glisser : un simple clic ne laisse rien ; une vraie sélection
   * reste surlignée et part au presse-papiers.
   */
  #finishSelection(full: IFullscreenState): void {
    const selection = full.selection;
    if (selection === null) return;
    if (selection.unit === "char" && !full.dragged) {
      this.#setSelection(full, null);
      return;
    }
    const range = this.#range(full);
    const copy = full.copy;
    if (range === null || copy === null) return;
    const text = extractSelection(this.#transcript, range);
    if (text.length === 0) return;
    // Dans la chaîne, un `copy` qui lèverait SYNCHRONEMENT est rattrapé aussi.
    full.copying = full.copying
      .then(() => copy(text))
      .then(
        (message) => this.#notify(full, message),
        () => this.#notify(full, "copie impossible"),
      );
  }

  /** Affiche un message passager à la place de l'aide de la barre. */
  #notify(full: IFullscreenState, message: string): void {
    if (this.#full !== full) return;
    if (full.noticeTimer) clearTimeout(full.noticeTimer);
    full.notice = message;
    full.noticeTimer = setTimeout(() => {
      full.noticeTimer = null;
      full.notice = null;
      this.#scheduleFrame();
    }, NOTICE_MS);
    this.#scheduleFrame();
  }

  #setSelection(full: IFullscreenState, selection: ISelection | null): void {
    if (full.selection === null && selection === null) return;
    full.selection = selection;
    this.#scheduleFrame();
  }

  /**
   * La cellule de l'historique sous un point de l'écran (coordonnées du
   * terminal, depuis 1), lue sur l'image AFFICHÉE. Hors du journal, la
   * cellule est ramenée au bord le plus proche : glisser jusque dans la
   * barre sélectionne jusqu'au bout de la dernière ligne.
   */
  #pointAt(
    full: IFullscreenState,
    row: number,
    column: number,
    strict = false,
    origins = full.frame?.origins,
  ): ISelectionPoint | null {
    if (origins === undefined) return null;
    const index = Math.min(Math.max(row - 1, 0), origins.length - 1);
    const origin = origins[index] ?? null;
    if (strict && (origin === null || row - 1 !== index)) return null;
    if (origin !== null) {
      return {
        seq: origin.seq,
        column: origin.column + Math.max(0, column - 1),
      };
    }
    for (let i = index - 1; i >= 0; i--) {
      const above = origins[i];
      if (above) return { seq: above.seq, column: Number.MAX_SAFE_INTEGER - 1 };
    }
    for (let i = index + 1; i < origins.length; i++) {
      const below = origins[i];
      if (below) return { seq: below.seq, column: below.column };
    }
    return null;
  }

  /**
   * Glisser sur la première ligne, ou sous le journal (indicateur, barre) :
   * le journal défile tout seul, `EDGE_LINES` lignes toutes les
   * `EDGE_INTERVAL_MS`, et la tête suit le bord — la sélection dépasse
   * l'écran. Revenir dans le journal l'arrête.
   */
  #followEdge(full: IFullscreenState, row: number, column: number): void {
    const rows = journalRowsOf(full.frame);
    // La ligne 1 est DANS le journal : le bord haut ne s'arme que si le
    // pointeur y ARRIVE d'en dessous (ou y reste, déjà armé) — un glisser
    // commencé sur la ligne 1 sélectionne cette ligne, il ne la fait pas fuir.
    const previous = full.dragRow;
    full.dragRow = row;
    const up = row <= 1 && (previous > 1 || full.edge?.direction === 1);
    const direction = up ? 1 : row > rows ? -1 : 0;
    if (direction === 0 || rows === 0) {
      this.#stopEdge(full);
      return;
    }
    full.edge = { direction, row: direction === 1 ? 1 : rows, column };
    full.edgeTimer ??= setInterval(
      () => this.#edgeStep(full),
      EDGE_INTERVAL_MS,
    );
  }

  /** Un pas du défilement au bord : défiler, puis ramener la tête au bord. */
  #edgeStep(full: IFullscreenState): void {
    const edge = full.edge;
    if (this.#full !== full || edge === null || full.selection === null) {
      this.#stopEdge(full);
      return;
    }
    const before = full.anchor;
    this.#scrollBy(full, edge.direction * EDGE_LINES);
    if (full.anchor === before) {
      // Bout de l'historique : plus rien à faire défiler. Le prochain
      // glisser au bord réarme.
      this.#stopEdge(full);
      return;
    }
    // La tête se lit sur l'image À VENIR : celle à l'écran est d'avant le pas.
    const origins = renderFrame(this.#model(full), this.#size()).origins;
    const head = this.#pointAt(full, edge.row, edge.column, false, origins);
    if (head !== null) this.#setSelection(full, { ...full.selection, head });
  }

  #stopEdge(full: IFullscreenState): void {
    if (full.edgeTimer) clearInterval(full.edgeTimer);
    full.edgeTimer = null;
    full.edge = null;
  }

  /**
   * Foyer de défilement : molette captée, flèches (la molette en envoie en
   * mode 1007), PgUp, PgDn, Début, Fin. Une flèche venue de la molette est indiscernable d'une
   * flèche tapée : l'historique de l'invite (#538) prendra Ctrl+P / Ctrl+N.
   */
  #scrollFocus(full: IFullscreenState): IInputFocus {
    return {
      handle: (event) => {
        if (event.kind === "wheel") {
          this.#scrollBy(
            full,
            event.direction === "up" ? WHEEL_LINES : -WHEEL_LINES,
          );
          return true;
        }
        if (event.kind !== "key" || event.ctrl || event.alt) return false;
        const size = this.#size();
        const page = Math.max(1, frameJournalRows(this.#model(full), size) - 1);
        if (event.key === "up") this.#scrollBy(full, 1);
        else if (event.key === "down") this.#scrollBy(full, -1);
        else if (event.key === "pageup") this.#scrollBy(full, page);
        else if (event.key === "pagedown") this.#scrollBy(full, -page);
        else if (event.key === "home") {
          this.#setAnchor(full, topAnchor(this.#model(full), size));
        } else if (event.key === "end") this.#setAnchor(full, null);
        else return false;
        return true;
      },
    };
  }

  /** Foyer global : Ctrl+C et Ctrl+D demandent l'arrêt au propriétaire. */
  #globalFocus(full: IFullscreenState): IInputFocus {
    return {
      handle: (event) => {
        if (
          event.kind === "key" &&
          event.ctrl &&
          (event.key === "c" || event.key === "d")
        ) {
          full.onQuit();
          return true;
        }
        return false;
      },
    };
  }

  /** Défile de `delta` lignes d'écran (positif = remonter). */
  #scrollBy(full: IFullscreenState, delta: number): void {
    this.#setAnchor(full, scrollAnchor(this.#model(full), this.#size(), delta));
  }

  #setAnchor(full: IFullscreenState, anchor: IScrollAnchor | null): void {
    const before = full.anchor;
    if (
      before === anchor ||
      (before !== null &&
        anchor !== null &&
        before.seq === anchor.seq &&
        before.below === anchor.below)
    ) {
      return;
    }
    full.anchor = anchor;
    this.#scheduleFrame();
  }

  /** Ce que l'image lit. */
  #model(full: IFullscreenState): IFrameModel {
    // Avant le premier bilan du serveur (un build peut durer), la barre dit
    // déjà la phase : un écran alternatif vide ressemble à un programme figé.
    const context =
      this.#context ??
      (this.#project === null
        ? null
        : {
            project: this.#project,
            readyAt: "",
            reloads: 0,
            ...(this.#version === null ? {} : { version: this.#version }),
          });
    return {
      transcript: this.#transcript,
      anchor: full.anchor,
      status:
        context === null
          ? null
          : {
              view: this.#view,
              context: {
                ...context,
                ...(this.#runtime === null ? {} : { runtime: this.#runtime }),
                // La dernière ligne du bloc n'accueille qu'un message passager.
                ...(full.notice === null ? {} : { help: full.notice }),
              },
              phase: this.#phase,
              notice: full.notice,
              activity: {
                ...(this.#step === null ? {} : { step: this.#step }),
                ...(this.#progress === null
                  ? {}
                  : { progress: this.#progress }),
                ...(this.#issue === null ? {} : { issue: this.#issue }),
                elapsedMs: Date.now() - this.#phaseSince,
                frame: spinnerFrame(this.#charset),
              },
            },
      color: this.#color,
      charset: this.#charset,
      mark: this.#mark,
      heights: full.heights,
      ...(full.floorSeq === undefined ? {} : { floorSeq: full.floorSeq }),
      // L'indicateur de build du superviseur se réécrit sur place, sans fin
      // de ligne : sans lui, un long build laissait l'écran figé.
      partial: this.#transcript.partial("supervisor", "out"),
      selection:
        full.selection === null ||
        (full.selection.unit === "char" && !full.dragged)
          ? null
          : this.#range(full),
    };
  }

  /**
   * La sélection normalisée — recalculée seulement quand la sélection
   * change : en mot, elle relit deux entrées, et l'image se redessine à
   * chaque ligne qui arrive.
   */
  #range(full: IFullscreenState): ISelectionRange | null {
    const selection = full.selection;
    if (selection === null) return null;
    if (full.range?.of !== selection) {
      full.range = {
        of: selection,
        value: selectionRange(selection, this.#transcript),
      };
    }
    return full.range.value;
  }

  /** Dimensions du terminal, repli 80×24 pour un flux qui ne les déclare pas. */
  #size(): IFrameSize {
    const { columns, rows } = this.#stdout;
    return columns && rows && columns > 0 && rows > 0
      ? { columns, rows }
      : FALLBACK_SIZE;
  }

  /**
   * Programme une image : au plus une toutes les 16 ms. Une rafale de
   * lignes entre deux images n'en coûte qu'une.
   */
  #scheduleFrame(): void {
    const full = this.#full;
    if (full?.frameTimer !== null) return;
    const wait = Math.max(
      0,
      FRAME_INTERVAL_MS - (Date.now() - full.lastFrameAt),
    );
    full.frameTimer = setTimeout(() => {
      full.frameTimer = null;
      this.#drawFrame(full);
    }, wait);
  }

  /**
   * Dessine l'image : seules les lignes changées, en UNE écriture, curseur
   * masqué pendant le dessin, encadrée par la sortie synchronisée quand la
   * sonde l'a vue — jamais d'image à moitié peinte entre deux appels système.
   */
  #drawFrame(full: IFullscreenState): void {
    if (this.#full !== full) return;
    full.lastFrameAt = Date.now();
    const frame = renderFrame(this.#model(full), this.#size());
    const previous = full.frame;
    const changes = diffFrame(previous, frame);
    full.frame = frame;
    const sameCursor =
      previous !== null &&
      (previous.cursor === frame.cursor ||
        (previous.cursor !== null &&
          frame.cursor !== null &&
          previous.cursor.row === frame.cursor.row &&
          previous.cursor.column === frame.cursor.column));
    if (changes.length === 0 && sameCursor) return;
    let out = full.synchronized ? "\x1b[?2026h\x1b[?25l" : "\x1b[?25l";
    if (previous === null) out += "\x1b[H\x1b[2J";
    for (const { row, text } of changes) {
      // Un lien qu'une ligne ouvre sans le fermer ne déborde ni sur les
      // lignes suivantes ni sur ce qu'écrira le shell après nous.
      const close = text.includes("\x1b]8;") ? "\x1b]8;;\x1b\\" : "";
      out += `\x1b[${row + 1};1H${text}${close}\x1b[0m\x1b[K`;
    }
    out += cursorSequence(frame);
    if (full.synchronized) out += "\x1b[?2026l";
    this.#stdout.write(out);
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
