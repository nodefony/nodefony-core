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
 * chaîne de foyers (§4) — défilement, puis global (Ctrl+C, Ctrl+D, Alt+1 à
 * Alt+9). L'écran montre un ONGLET à la fois (§11, #903) : `serveur` (tout
 * canal qu'aucun autre onglet ne retient), `vite` (`vite:*`), et ceux qu'un
 * producteur ouvre à la volée ({@link DevTerminal.addView}) ; la ligne
 * d'onglets n'apparaît que quand un second a quelque chose à montrer.
 */
import { StringDecoder } from "node:string_decoder";
import { BRAILLE_FRAMES, LINE_FRAMES } from "../../cli/progress";
import { isIncompleteControlSequence } from "../../runtime/textWidth";
import { guardTerminal } from "../../runtime/terminalGuard";
import {
  StatusBarCache,
  diffFrame,
  diffFrameScrolled,
  frameJournalRows,
  renderFrame,
  scrollAnchor,
  topAnchor,
  type DevPhase,
  type IFrame,
  type IFrameModel,
  type IFramePrompt,
  type IFrameSize,
  type IFrameTabs,
  type IScrollAnchor,
} from "./devFrame";
import {
  extractSelection,
  zoneAt,
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
  channelKey,
  sanitizeTerminalText,
  type ITranscriptEntry,
} from "./devTranscript";
import { DevHistory, type IDevHistoryOptions } from "./devHistory";
import { DevView, type IDevViewHandle, type IDevViewSpec } from "./devView";
import { helpBand, screenGestures, type IDevBand } from "./devBand";
import { buildHelpPanel } from "./devHelpPanel";
import {
  PromptMenuBand,
  promptMenuStepsAside,
  type IPromptMenu,
} from "./devMenuBand";
import { HistorySearchBand } from "./devHistorySearch";
import { CompletionBand } from "./devCompletionBand";
import type { ICliManifest } from "../../cli/completion";
import { PanelCursor, type IPanelSpec } from "./devPanel";
import type { ProcessOutputStream } from "./heldChannel";
import { CLEAR_SCREEN, type DevPaint } from "./outputMode";
import {
  renderStatusBar,
  type IRuntimeSample,
  type IStartupView,
  type IStatusContext,
  type ScreenCharset,
} from "./startupScreen";
import { StatusLine, type IStatusStream } from "./statusLine";
import { brandMiniMark } from "../../cli/brand";
import { LineEditor, type IPromptRenderOptions } from "./lineEditor";
import {
  PromptHistoryFile,
  describeHistorySkip,
  type PromptHistoryEntry,
} from "./promptHistory";
import {
  describeUnmatchedInput,
  PROMPT_COMMAND_PREFIX,
  type IPromptAction,
  type IPromptIO,
} from "./promptAction";

/** Un flux de sortie du terminal, injectable en test. */
export interface IDevTerminalStream extends IStatusStream {
  rows?: number | undefined;
  /**
   * Le flux a vidé son tampon : `write` avait rendu `false`. Absent (flux
   * de test), le plein écran ne retient jamais d'image.
   */
  once?(event: "drain", listener: () => void): unknown;
  removeListener?(event: "drain", listener: () => void): unknown;
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
  /** Plafonds de l'historique, global et par canal. */
  history?: Omit<IDevHistoryOptions, "onClear">;
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

/** L'invite du plein écran (#538) : ce que {@link DevTerminal.attachPrompt} reçoit. */
export interface IDevPromptOptions {
  /** La racine du projet : l'historique y vit (`var/prompt-history.jsonl`). */
  readonly root: string;
  /** Les actions qu'Entrée sait lancer, essayées dans l'ordre. */
  readonly actions: readonly IPromptAction[];
  /**
   * Le manifeste des commandes du CLI, relu à chaque ouverture de l'aide
   * (`/help`, F1) : ses rubriques le RENDENT, jamais une copie (D10).
   */
  readonly cliManifest?: () => ICliManifest | null;
  /**
   * Le menu de la bande `/nodefony`, relu à chaque ouverture : la bande
   * s'ouvre dès qu'une saisie commence par `/` (D9, D10). Absent : pas de
   * bande.
   */
  readonly menu?: () => IPromptMenu;
}

/**
 * Une rafale de flèches identiques (↑ ou ↓, sans modificateur) dans UN
 * paquet : ce qu'envoie un cran de molette traduit par le terminal.
 *
 * @param events - les évènements d'un paquet.
 * @returns `true` pour au moins deux flèches identiques et rien d'autre.
 */
function isArrowBurst(events: readonly InputEvent[]): boolean {
  if (events.length < 2) return false;
  let key: string | null = null;
  for (const event of events) {
    if (
      event.kind !== "key" ||
      event.ctrl ||
      event.alt ||
      event.shift ||
      (event.key !== "up" && event.key !== "down") ||
      (key !== null && event.key !== key)
    ) {
      return false;
    }
    key = event.key;
  }
  return true;
}

/** Le canal où l'invite écrit : l'écho de la saisie et la sortie des actions. */
const PROMPT_CHANNEL = "prompt";

/** L'état de l'invite branchée. Forme fixe, posée par `attachPrompt`. */
interface IPromptState {
  readonly history: PromptHistoryFile;
  readonly actions: readonly IPromptAction[];
  /** Un éditeur par onglet (ADR-0013 §11) : le brouillon survit au changement d'onglet. */
  readonly editors: Map<string, LineEditor>;
  readonly render: IPromptRenderOptions;
  /** La marque réduite (`brandMiniMark`) : la barre se resserre sous l'invite. */
  readonly mark: readonly string[];
  /** L'historique a été demandé — à la première frappe, jamais au démarrage. */
  loading: boolean;
  /** La suggestion grisée, calculée pour `suggestionOf` à sa version `suggestionVersion`. */
  suggestionOf: LineEditor | null;
  suggestionVersion: number;
  suggestion: string;
  /** L'image de l'invite, filet compris, tirée de `frameSource` à `frameWidth`. */
  frameSource: IFramePrompt | null;
  frame: IFramePrompt | null;
  frameWidth: number;
  /** L'action en cours, qu'un Ctrl+C interrompt. */
  running: AbortController | null;
  /**
   * L'invite a le focus : ↑/↓ y parcourent l'historique. Au journal (clic,
   * molette, PgUp/PgDn), ils le font défiler ; la frappe le rend à l'invite.
   */
  focused: boolean;
  /** Le focus de l'image `frame`. */
  frameFocused: boolean;
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
  /**
   * Comment une image passe à l'écran : `"scroll"` (le défaut) fait défiler
   * la région du journal par le terminal (`DECSTBM` + `SU`/`SD`) et n'écrit
   * que les lignes neuves ; `"diff"` réécrit chaque ligne changée ;
   * `"full"` repeint toute l'image — là où les écritures positionnées
   * laissent des fragments (ConPTY, ADR-0013 D3).
   */
  paint?: DevPaint;
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

/** Le filtre d'un onglet sans canal (un panneau). */
const noChannel = (): boolean => false;

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
  "\x1b[r\x1b[?1006l\x1b[?1002l\x1b[?1000l\x1b[?2004l\x1b[?1007l\x1b[?25h\x1b[?1049l";

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

/**
 * Le rang d'onglet (1 à 9) qu'une touche tapée avec Alt désigne, ou 0.
 *
 * Le chiffre, ou son symbole avec Maj sur un clavier AMÉRICAIN (`!` à `(`) :
 * avec `macOptionIsMeta`, le terminal de VS Code (xterm.js) traduit par la
 * POSITION de la touche sur ce clavier, si bien que Maj+Option+1 d'un clavier
 * français y arrive en `ESC !` — quand Terminal.app et iTerm2 envoient
 * `ESC 1`. Les deux mènent au même onglet.
 */
function tabRank(key: string): number {
  if (key.length !== 1) return 0;
  const digit = TAB_DIGITS.indexOf(key);
  return digit >= 0 ? digit + 1 : TAB_SHIFTED_DIGITS.indexOf(key) + 1;
}

/** Les chiffres des onglets, et leurs symboles avec Maj (clavier américain). */
const TAB_DIGITS = "123456789";
const TAB_SHIFTED_DIGITS = "!@#$%^&*(";

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
  paint: DevPaint;
  /**
   * `write` a rendu `false` : aucune image ne part avant `drain`. Les
   * changements s'accumulent dans le modèle ; l'image d'après les rend tous.
   */
  awaitingDrain: boolean;
  /** L'unique écouteur `drain`, posé une fois par attente, retiré à la sortie. */
  onDrain: () => void;
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
  /** Les onglets de la ligne à l'écran, dans son ordre — ce qu'un clic vise. */
  tabViews: readonly DevView[];
  statusBar: StatusBarCache;
  /** La chaîne de foyers, du premier servi au dernier. */
  foci: IInputFocus[];
  /**
   * Le paquet en cours est une RAFALE de flèches identiques : un cran de
   * molette que le terminal a traduit (mode 1007, souris non captée) — une
   * touche, même répétée, arrive une par paquet.
   */
  wheelBurst: boolean;
  /**
   * Ce que le terminal a montré de la souris : `reported` dès qu'un
   * évènement souris arrive ; `refused` quand, capture demandée, la molette
   * arrive traduite en flèches — le terminal ne rapporte pas la souris.
   */
  mouseState: "unknown" | "reported" | "refused";
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

/** Ce qui reste d'un paquet, par couple (canal, flux), pour le suivant. */
interface IEchoState {
  decoder: StringDecoder;
  /** Une séquence de contrôle coupée par la fin du paquet. */
  carry: string;
}

/** Les services Vite : leur onglet (ADR-0013 §11, N4). */
function isVite(channel: string): boolean {
  return channel.startsWith("vite:");
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
  /** L'historique, un anneau par canal. */
  readonly #history: DevHistory;
  /** Les onglets, dans leur ordre ; le premier (`serveur`) est toujours montré. */
  readonly #views: DevView[];
  /**
   * L'onglet `serveur` : tout canal qu'aucun autre ne retient — serveur,
   * superviseur, autres services portés. Aucun canal ne reste sans onglet.
   */
  readonly #server: DevView;
  /** L'onglet à l'écran. */
  #active: DevView;
  /** Les onglets montrés, rebâtis seulement quand leur ensemble change. */
  #shown: readonly DevView[] = [];
  /** Les bandes ouvertes ; la dernière est à l'écran et reçoit les évènements. */
  readonly #bands: IDevBand[] = [];
  /** La fermeture de l'aide (`?`), `null` quand elle est fermée. */
  #closeHelp: (() => void) | null = null;
  readonly #status: StatusLine;
  /** États d'affichage par couple (canal, flux) — une dizaine de clés au plus. */
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

  /** L'invite, une fois branchée (`attachPrompt`) — `null` sinon. */
  #prompt: IPromptState | null = null;
  /** Le foyer de la bande : l'invite se pose JUSTE APRÈS lui (D9). */
  #bandHandle: IInputFocus | null = null;
  /** Le foyer du panneau (#538, D9) — l'invite se range APRÈS lui. */
  #panelHandle: IInputFocus | null = null;
  /** Le lecteur du manifeste du CLI, posé par `attachPrompt`. */
  #cliManifest: (() => ICliManifest | null) | null = null;
  /** Le menu de la bande `/nodefony` — `null` : pas de bande. */
  #menuSource: (() => IPromptMenu) | null = null;
  /** La bande `/nodefony` ouverte, et sa fermeture. */
  #menu: { readonly band: PromptMenuBand; readonly close: () => void } | null =
    null;
  /** L'éditeur dont la bande a été retirée par Échap, jusqu'à une saisie hors `/`. */
  #menuDismissed: LineEditor | null = null;
  /**
   * Le menu lu à l'entrée sous `/`, gardé tant que la saisie y reste : le
   * manifeste ne se relit pas à chaque frappe.
   */
  #menuData: IPromptMenu | null = null;
  /** Les propositions de Tab ouvertes, et leur fermeture. */
  #completion: {
    readonly band: CompletionBand;
    readonly close: () => void;
  } | null = null;
  /** La recherche Ctrl+R ouverte, et sa fermeture. */
  #search: {
    readonly band: HistorySearchBand;
    readonly close: () => void;
  } | null = null;

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
    this.#history = new DevHistory(options.history);
    const server = new DevView(
      this.#history,
      "server",
      "serveur",
      (channel) => !this.#claimed(channel),
    );
    this.#server = server;
    this.#views = [server, new DevView(this.#history, "vite", "vite", isVite)];
    this.#active = server;
    // Les DEUX flux sont surveillés : une écriture sur la sortie d'erreur
    // efface aussi la barre avant elle, sinon elle s'y collerait.
    this.#status = new StatusLine(
      this.#stderr === this.#stdout
        ? [this.#stdout]
        : [this.#stdout, this.#stderr],
    );
    if (options.fullscreen) this.#enterFullscreen(options.fullscreen);
  }

  /** L'historique par canal, en lecture. */
  get history(): DevHistory {
    return this.#history;
  }

  /** La surface courante — `inline` après la sortie du plein écran. */
  get surface(): DevSurface {
    return this.#surface;
  }

  /** L'ancre du journal de l'onglet à l'écran, `null` en direct. */
  get anchor(): IScrollAnchor | null {
    return this.#full === null ? null : this.#active.anchor;
  }

  /** L'onglet à l'écran (`server`, `vite`, ou celui d'un onglet ouvert à la volée). */
  get activeView(): string {
    return this.#active.id;
  }

  /** La phase courante du serveur. */
  get phase(): DevPhase {
    return this.#phase;
  }

  /**
   * Verse un paquet d'un canal : inscrit dans l'historique, affiché sur la
   * surface `inline`. Une séquence coupée entre deux paquets attend la suite.
   *
   * @param channel - le canal qui écrit (`server`, `supervisor`,
   *   `vite:<nom>`…) : chacun garde son reste de séquence et sa ligne en
   *   cours, sans quoi la fin coupée de l'un se collerait à la ligne de l'autre.
   * @param stream - sur quel flux.
   * @param chunk - le paquet, octets bruts ou texte.
   */
  ingest(
    channel: string,
    stream: ProcessOutputStream,
    chunk: Buffer | Uint8Array | string,
  ): void {
    if (this.#closed) return;
    const state = this.#echoOf(channel, stream);
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
    // Seul le SERVEUR tourne la page (ADR-0030 §D6) : un service porté, une
    // commande lancée, n'effacent pas ce que le développeur est en train de
    // lire — la séquence est retirée, jamais exécutée ni recopiée.
    if (channel !== "server") {
      if (text.includes(CLEAR)) text = text.replaceAll(CLEAR, "");
      this.#show(channel, stream, target, text);
      return;
    }
    let start = 0;
    let clear = text.indexOf(CLEAR);
    while (clear !== -1) {
      this.#show(channel, stream, target, text.slice(start, clear));
      this.clear();
      start = clear + CLEAR.length;
      clear = text.indexOf(CLEAR, start);
    }
    this.#show(channel, stream, target, text.slice(start));
  }

  /**
   * Un canal se tait (le serveur s'est arrêté) : sa ligne en cours entre
   * dans l'historique, et ce qu'il retenait est oublié — le prochain
   * serveur repart d'un décodeur neuf.
   *
   * @param channel - le canal qui s'arrête.
   */
  flush(channel: string): void {
    this.#history.flush(channel);
    // Clés exactes : un préfixe `vite:` effacerait aussi `vite:admin`.
    Reflect.deleteProperty(this.#echo, channelKey(channel, "out"));
    Reflect.deleteProperty(this.#echo, channelKey(channel, "err"));
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
      // La page propre est celle de l'onglet qui montre le serveur.
      for (const view of this.#views) {
        if (view.match("server")) view.floorSeq = view.transcript.lastSeq;
      }
      this.#scheduleFrame();
      return;
    }
    this.#stdout.write(CLEAR_SCREEN);
  }

  /**
   * Insère un foyer EN TÊTE de la chaîne : il voit les touches avant la
   * bande, l'invite, le défilement et l'arrêt. L'invite, elle, passe par
   * {@link DevTerminal.attachPrompt}, qui la pose après la bande.
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
   * Branche l'invite (#538) : un éditeur par onglet, l'historique du projet,
   * et les actions qu'Entrée lance. Son foyer passe APRÈS celui de la bande
   * (une bande ouverte garde le clavier, D9) et avant le défilement ; la
   * barre se resserre sous elle. Sans plein écran : rien — aucun clavier
   * n'est lu en surface `inline`.
   *
   * @param options - racine du projet et actions.
   * @returns son retrait.
   */
  attachPrompt(options: IDevPromptOptions): () => void {
    const full = this.#full;
    if (!full || this.#prompt !== null) return () => {};
    const state: IPromptState = {
      history: new PromptHistoryFile(options.root, (error) =>
        this.#notify(
          full,
          `historique de l'invite non écrit : ${error instanceof Error ? error.message : String(error)}`,
        ),
      ),
      actions: options.actions,
      editors: new Map(),
      render: {
        sigil: this.#charset === "ascii" ? "> " : "❯ ",
        placeholder: `${options.actions.map((action) => `${PROMPT_COMMAND_PREFIX}${action.id}`).join(" · ")} — ? aide · Alt+Entrée saut de ligne`,
        color: this.#color,
      },
      mark: brandMiniMark(this.#charset, this.#color),
      loading: false,
      suggestionOf: null,
      suggestionVersion: -1,
      suggestion: "",
      frameSource: null,
      frame: null,
      frameWidth: -1,
      running: null,
      focused: true,
      frameFocused: true,
    };
    this.#prompt = state;
    this.#cliManifest = options.cliManifest ?? null;
    this.#menuSource = options.menu ?? null;
    const focus = this.#promptFocus(full, state);
    // Après la bande ET le panneau : une bande ouverte garde le clavier
    // (D9), et le panneau de l'onglet affiché prend ses touches avant elle.
    const before = this.#panelHandle ?? this.#bandHandle;
    const at = before === null ? -1 : full.foci.indexOf(before);
    full.foci.splice(at + 1, 0, focus);
    this.#scheduleFrame();
    return () => {
      if (this.#prompt !== state) return;
      state.running?.abort();
      this.#prompt = null;
      this.#cliManifest = null;
      this.#menuSource = null;
      this.#menu?.close();
      this.#menu = null;
      this.#menuDismissed = null;
      this.#menuData = null;
      this.#search?.close();
      this.#search = null;
      this.#completion?.close();
      this.#completion = null;
      const index = full.foci.indexOf(focus);
      if (index !== -1) full.foci.splice(index, 1);
      this.#scheduleFrame();
    };
  }

  /**
   * La fin des écritures de l'historique de l'invite — à attendre avant de
   * quitter.
   *
   * @returns la promesse de la dernière écriture.
   */
  flushPrompt(): Promise<void> {
    return this.#prompt?.history.flush() ?? Promise.resolve();
  }

  /**
   * Vide l'onglet AFFICHÉ (le verbe `clear`) : le direct ne montre plus rien
   * d'antérieur ; remonter le journal le retrouve, comme après `ESC[2J`.
   */
  clearView(): void {
    if (this.#closed || !this.#full) return;
    this.#active.floorSeq = this.#active.transcript.lastSeq;
    this.#scheduleFrame();
  }

  /**
   * Ouvre un panneau à rubriques dans un onglet à la volée (#538, D9) et le
   * montre. Déjà ouvert sous ce même identifiant : son contenu est remplacé
   * — `/status` relancé montre l'état du moment — et la rubrique affichée
   * est gardée si elle existe encore. Échap le referme. Sans plein écran :
   * rien, aucun clavier n'est lu en surface `inline`.
   *
   * @param spec - identifiant, libellé et rubriques.
   */
  openPanel(spec: IPanelSpec): void {
    const full = this.#full;
    if (!full) return;
    const cursor = new PanelCursor(spec, {
      color: this.#color,
      charset: this.#charset,
    });
    let view = this.#views.find((candidate) => candidate.id === spec.id);
    if (view === undefined) {
      // Aucun canal : l'onglet ne montre que son panneau.
      view = new DevView(this.#history, spec.id, spec.label, noChannel, true);
      this.#views.push(view);
    } else if (view.panel !== null) {
      cursor.page = Math.min(view.panel.page, spec.pages.length - 1);
    } else {
      throw new Error(`onglet déjà ouvert sans panneau : ${spec.id}`);
    }
    view.panel = cursor;
    this.#selectView(full, view);
    this.#scheduleFrame();
  }

  /**
   * Ouvre l'aide (`/help`, F1). Invite branchée : l'aide COMPLÈTE en
   * panneau à rubriques — l'invite, ses gestes, puis le CLI ; sinon la bande
   * des gestes. `?` sur une invite vide garde la bande, l'aide-mémoire.
   */
  showHelp(): void {
    const full = this.#full;
    if (!full) return;
    if (this.#prompt === null) {
      this.#openHelp(full);
      return;
    }
    this.openPanel(
      buildHelpPanel({
        gestures: screenGestures({
          charset: this.#charset,
          mouse: full.mouse,
          prompt: true,
        }),
        manifest: this.#cliManifest?.() ?? null,
      }),
    );
  }

  /**
   * Ouvre un onglet à la volée — un sous-agent, une commande (ADR-0013 §11,
   * N8). Il montre les canaux qu'il retient, que l'onglet `serveur` lui
   * cède, et paraît dès son ouverture, même vide.
   *
   * @param spec - identifiant, libellé, canaux.
   * @returns sa poignée : `finish` marque l'issue (✓ / ✗), `close` le
   *   referme et libère l'historique de ses canaux. Un producteur qui écrit
   *   encore après la fermeture rouvre son canal, dans l'onglet `serveur`.
   * @throws Si l'identifiant est déjà pris.
   */
  addView(spec: IDevViewSpec): IDevViewHandle {
    if (this.#views.some((view) => view.id === spec.id)) {
      throw new Error(`onglet déjà ouvert : ${spec.id}`);
    }
    const only = spec.channels;
    const view = new DevView(
      this.#history,
      spec.id,
      spec.title,
      typeof only === "string" ? (channel) => channel === only : only,
      true,
    );
    this.#views.push(view);
    this.#server.transcript.refresh();
    this.#scheduleFrame();
    let closed = false;
    return {
      finish: (outcome) => {
        if (closed) return;
        view.outcome = outcome;
        this.#scheduleFrame();
      },
      close: () => {
        if (closed) return;
        closed = true;
        this.#removeView(view);
      },
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
    return this.#history.since(seq, limit);
  }

  /**
   * Rend le terminal : la barre est retirée, les flux retrouvent leur
   * `write`. Idempotent — appelé à l'arrêt puis à `exit`, en filet.
   */
  close(): void {
    if (this.#closed) return;
    this.leaveFullscreen();
    this.#closed = true;
    this.#history.flush();
    this.#status.release();
  }

  /** Inscrit et affiche un segment sans `ESC[2J`. */
  #show(
    channel: string,
    stream: ProcessOutputStream,
    target: IDevTerminalStream,
    segment: string,
  ): void {
    if (segment.length === 0) return;
    this.#history.ingest(channel, stream, segment);
    if (this.#full) {
      // Une erreur dans un onglet caché : son compteur passe au rouge.
      if (stream === "err") {
        for (const view of this.#views) {
          if (view !== this.#active && view.match(channel)) view.alert = true;
        }
      }
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
      paint: options.paint ?? "scroll",
      awaitingDrain: false,
      onDrain: () => {
        full.awaitingDrain = false;
        // Fermé entre-temps : `#scheduleFrame` ne trouve plus de plein écran.
        this.#scheduleFrame();
      },
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
      tabViews: [],
      statusBar: new StatusBarCache(),
      foci: [],
      wheelBurst: false,
      mouseState: "unknown",
      releaseGuard: () => {},
    };
    if (full.mouse) full.foci.push(this.#mouseFocus(full));
    full.foci.push(this.#scrollFocus(full), this.#globalFocus(full));
    const band = this.#bandFocus(full);
    this.#bandHandle = band;
    const panel = this.#panelFocus();
    this.#panelHandle = panel;
    full.foci.unshift(band, panel);
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
    if (full.awaitingDrain) {
      full.awaitingDrain = false;
      this.#stdout.removeListener?.("drain", full.onDrain);
    }
    full.input.removeListener("data", full.onData);
    full.input.setRawMode?.(false);
    full.input.pause();
    this.#stdout.write(LEAVE_FULLSCREEN);
  }

  /**
   * CONSTATE si le terminal rapporte la souris (une capacité ne se déduit
   * pas) : capture demandée mais molette reçue en flèches — un réglage du
   * terminal l'a refusée (iTerm2 : « Enable mouse reporting »). Dit une fois,
   * pour qu'un clic d'onglet sans effet ait son explication.
   */
  #observeMouse(full: IFullscreenState, events: readonly InputEvent[]): void {
    if (full.mouseState !== "unknown" || !full.mouse) return;
    for (const event of events) {
      if (event.kind === "mouse" || event.kind === "wheel") {
        full.mouseState = "reported";
        return;
      }
    }
    if (!full.wheelBurst) return;
    full.mouseState = "refused";
    this.#notify(
      full,
      "le terminal ne rapporte pas la souris : clic d'onglet indisponible — Alt+1…9 (iTerm2 : Profiles › Terminal › Enable mouse reporting)",
    );
  }

  /** Octets du clavier → évènements → chaîne de foyers. */
  #onInput(chunk: Buffer | string): void {
    const full = this.#full;
    if (!full) return;
    if (full.escapeTimer) {
      clearTimeout(full.escapeTimer);
      full.escapeTimer = null;
    }
    const events = full.decoder.feed(chunk);
    full.wheelBurst = isArrowBurst(events);
    this.#observeMouse(full, events);
    for (const event of events) this.dispatch(event);
    full.wheelBurst = false;
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
   * l'efface aussi. Hors du journal, un clic sur une zone (une adresse de la
   * barre) la copie — cf {@link #clickZone}. Les autres boutons sont avalés :
   * la souris est à nous.
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
          const tab = this.#tabAt(full, event.row, event.column);
          if (tab !== null) {
            this.#selectView(full, tab);
            return true;
          }
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
          if (point === null && clicks === 1) {
            this.#clickZone(full, event.row, event.column);
          }
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
    if (range === null) return;
    const text = extractSelection(this.#active.transcript, range);
    if (text.length === 0) return;
    this.#copyText(full, text);
  }

  /**
   * Clic hors du journal (barre d'état, indicateur) : une zone sous le
   * pointeur — une adresse — part au presse-papiers, comme une sélection. La
   * souris reste captée : la molette et le glisser du journal sont intacts.
   *
   * @param full - l'état du plein écran.
   * @param row - ligne du clic, depuis 1.
   * @param column - colonne du clic, depuis 1.
   */
  #clickZone(full: IFullscreenState, row: number, column: number): void {
    const frame = full.frame;
    const text = frame?.lines[row - 1];
    if (frame === null || text === undefined) return;
    // Une ligne du journal se sélectionne, elle ne se clique pas.
    if ((frame.origins?.[row - 1] ?? null) !== null) return;
    const zone = zoneAt(text, column - 1);
    if (zone === null) return;
    if (zone.truncated) {
      this.#notify(full, "adresse raccourcie à l'écran — élargis le terminal");
      return;
    }
    this.#copyText(full, zone.value);
  }

  /**
   * Envoie un texte au presse-papiers, les copies l'une après l'autre, et
   * dit le résultat dans la barre.
   */
  #copyText(full: IFullscreenState, text: string): void {
    const copy = full.copy;
    if (copy === null) return;
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
    const view = this.#active;
    const before = view.anchor;
    this.#scrollBy(full, edge.direction * EDGE_LINES);
    if (view.anchor === before) {
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
   * mode 1007), PgUp, PgDn, Début, Fin. Invite branchée, ↑/↓ lui reviennent
   * (l'historique) : la molette captée — le défaut sous macOS et Linux —
   * arrive en `wheel`, jamais en flèche ; souris laissée au terminal, une
   * flèche venue de la molette est indiscernable d'une flèche tapée.
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
          this.#setAnchor(topAnchor(this.#model(full), size));
        } else if (event.key === "end") this.#setAnchor(null);
        else return false;
        return true;
      },
    };
  }

  /**
   * Foyer global : Ctrl+C et Ctrl+D demandent l'arrêt au propriétaire ;
   * `?` et F1 ouvrent l'aide des gestes ; Alt+1 à Alt+9 montrent l'onglet
   * de ce rang (`Ctrl+Tab` n'atteint pas
   * l'application dans la plupart des terminaux).
   */
  #globalFocus(full: IFullscreenState): IInputFocus {
    return {
      handle: (event) => {
        if (event.kind === "text" && event.text === "?") {
          this.#openHelp(full);
          return true;
        }
        if (event.kind !== "key") return false;
        if (event.ctrl && (event.key === "c" || event.key === "d")) {
          full.onQuit();
          return true;
        }
        if (event.key === "f1" && !event.ctrl && !event.alt) {
          this.showHelp();
          return true;
        }
        const rank = event.alt && !event.ctrl ? tabRank(event.key) : 0;
        if (rank > 0) {
          const view = this.#shownViews()[rank - 1];
          if (view !== undefined) this.#selectView(full, view);
          return true;
        }
        return false;
      },
    };
  }

  /**
   * Ouvre une bande modale entre la ligne d'onglets et l'invite — menu,
   * complétion, confirmation, aide (ADR-0013 §11). La dernière ouverte est
   * à l'écran et reçoit le clavier avant le défilement ; un clic sur elle ne
   * traverse pas.
   *
   * @param band - la bande.
   * @returns sa fermeture, sans effet la 2ᵉ fois.
   */
  openBand(band: IDevBand): () => void {
    this.#bands.push(band);
    this.#scheduleFrame();
    return () => {
      const index = this.#bands.indexOf(band);
      if (index === -1) return;
      this.#bands.splice(index, 1);
      this.#scheduleFrame();
    };
  }

  /** La bande à l'écran, ou `null`. */
  get band(): IDevBand | null {
    return this.#bands.at(-1) ?? null;
  }

  /** L'éditeur de l'onglet affiché — alloué à sa première frappe ou image. */
  #editorOf(state: IPromptState): LineEditor {
    const id = this.#active.id;
    let editor = state.editors.get(id);
    if (editor === undefined) {
      editor = new LineEditor();
      state.editors.set(id, editor);
    }
    return editor;
  }

  /**
   * Foyer du panneau de l'onglet affiché : ←→ rubrique, ↑↓ PgUp PgDn Début
   * Fin et la molette défilent, Échap referme — tant que la saisie de
   * l'onglet est VIDE. Dès qu'on tape, les flèches reviennent à l'éditeur
   * (le même partage que Début/Fin, D4) ; l'historique reste à Ctrl+P/N.
   */
  #panelFocus(): IInputFocus {
    return {
      handle: (event) => {
        const view = this.#active;
        const panel = view.panel;
        if (panel === null) return false;
        if (event.kind !== "wheel" && !this.#activeDraftEmpty()) return false;
        const verdict = panel.handle(event);
        if (verdict === "pass") return false;
        if (verdict === "close") this.#removeView(view);
        else this.#scheduleFrame();
        return true;
      },
    };
  }

  /**
   * Tab sur l'invite (D12) : les actions proposent les saisies entières qui
   * prolongent la saisie — un seul candidat la remplace, plusieurs la
   * prolongent de leur début commun, sinon la barre les nomme. Une action
   * peut répondre plus tard (promesse) : sa réponse ne s'applique que si la
   * saisie n'a pas bougé entre-temps. Curseur ailleurs qu'en fin, saisie sur
   * plusieurs lignes ou pièce jointe : rien.
   */
  #complete(full: IFullscreenState, state: IPromptState): void {
    const editor = this.#editorOf(state);
    const prefix = editor.text;
    if (editor.hasAttachment || !editor.atEnd || prefix.includes("\n")) return;
    // Tab parcourt déjà la liste de la bande : il continue.
    const menu = this.#menu?.band ?? null;
    if (menu?.cycling(prefix) === true) {
      menu.cycle(1);
      this.#scheduleFrame();
      return;
    }
    const version = editor.version;
    const answers: (readonly string[] | Promise<readonly string[]>)[] = [];
    let pending = false;
    for (const action of state.actions) {
      const answer = action.complete?.(prefix);
      if (answer === undefined) continue;
      if (answer instanceof Promise) pending = true;
      answers.push(answer);
    }
    const apply = (lists: readonly (readonly string[])[]): void => {
      if (
        this.#prompt !== state ||
        this.#editorOf(state) !== editor ||
        editor.version !== version
      ) {
        return;
      }
      const seen = new Set<string>();
      for (const list of lists) for (const c of list) seen.add(c);
      const candidates = [...seen];
      const only = candidates.length === 1 ? candidates[0] : undefined;
      if (only !== undefined) {
        editor.setText(only.endsWith(" ") ? only : `${only} `);
      } else if (candidates.length === 0) {
        this.#notify(full, "Tab : rien à compléter");
        return;
      } else {
        // Mot en cours vide (`/nodefony build `) : rien à prolonger, on
        // MONTRE ; sinon le début commun s'écrit s'il avance.
        const common =
          /\s$/.test(prefix) || prefix === ""
            ? prefix
            : commonPrefix(candidates);
        if (common.length > prefix.length) editor.setText(common);
        else {
          // La bande `/nodefony` est ouverte : Tab parcourt SA liste, au lieu
          // d'en ouvrir une seconde.
          if (this.#menu?.band.cycle(1) === true) {
            this.#scheduleFrame();
            return;
          }
          this.#openCompletion(full, state, candidates);
          return;
        }
      }
      this.#scheduleFrame();
      this.#syncMenu(full, state);
    };
    if (!pending) {
      const lists: (readonly string[])[] = [];
      for (const answer of answers)
        if (!(answer instanceof Promise)) lists.push(answer);
      apply(lists);
      return;
    }
    Promise.all(answers.map((answer) => Promise.resolve(answer))).then(
      apply,
      (error: unknown) =>
        this.#notify(
          full,
          `complétion impossible : ${error instanceof Error ? error.message : String(error)}`,
        ),
    );
  }

  /**
   * Les propositions de Tab en bande : plusieurs saisies prolongent l'invite
   * et leur début commun n'avance pas. Elle se referme quand la frappe n'en
   * laisse plus aucune ({@link DevTerminal.#syncCompletion}).
   */
  #openCompletion(
    full: IFullscreenState,
    state: IPromptState,
    candidates: readonly string[],
  ): void {
    this.#completion?.close();
    const band = new CompletionBand(
      candidates,
      { color: this.#color, charset: this.#charset },
      {
        draft: () => this.#editorOf(state).text,
        fill: (text) => {
          this.#editorOf(state).setText(text);
          this.#scheduleFrame();
          this.#syncMenu(full, state);
        },
        close: () => {
          this.#completion?.close();
          this.#completion = null;
        },
      },
    );
    this.#completion = { band, close: this.openBand(band) };
  }

  /** Referme les propositions de Tab que la saisie ne prolonge plus. */
  #syncCompletion(): void {
    if (this.#completion?.band.shown().length === 0) {
      this.#completion.close();
      this.#completion = null;
    }
  }

  /**
   * Ctrl+R (D11) : la recherche dans l'historique, en bande au-dessus de
   * l'invite. Entrée reprend l'entrée choisie dans la saisie de l'onglet
   * affiché, sans l'envoyer.
   */
  #openSearch(full: IFullscreenState, state: IPromptState): void {
    if (this.#search !== null) return;
    const band = new HistorySearchBand(
      { color: this.#color, charset: this.#charset },
      {
        search: (term) => state.history.history.search(term, Date.now()),
        revision: () => state.history.history.length,
        pick: (text) => {
          this.#editorOf(state).setText(text);
          this.#setPromptFocus(state, true);
          this.#scheduleFrame();
          this.#syncMenu(full, state);
        },
        close: () => {
          this.#search?.close();
          this.#search = null;
        },
      },
    );
    this.#search = { band, close: this.openBand(band) };
  }

  /**
   * Ouvre ou referme la bande `/nodefony` selon la saisie de l'onglet
   * affiché : ouverte tant qu'elle commence par `/`, sur une ligne et sans
   * pièce jointe, sauf retirée par Échap — jusqu'à ce que la saisie quitte
   * le `/`.
   */
  #syncMenu(full: IFullscreenState, state: IPromptState): void {
    const source = this.#menuSource;
    if (source === null) return;
    const editor = this.#editorOf(state);
    const text = editor.text;
    const under =
      text.trimStart().startsWith(PROMPT_COMMAND_PREFIX) &&
      !text.includes("\n") &&
      !editor.hasAttachment;
    if (!under) {
      if (this.#menuDismissed === editor) this.#menuDismissed = null;
      this.#menuData = null;
    } else {
      this.#menuData ??= source();
    }
    const menu = this.#menuData;
    // Passé la commande (`/nodefony build `), la ligne est à Tab.
    const open =
      menu !== null &&
      this.#menuDismissed !== editor &&
      !promptMenuStepsAside(menu, text);
    if (open && this.#menu === null) {
      const band = new PromptMenuBand(
        menu,
        { color: this.#color, charset: this.#charset },
        {
          draft: () => this.#editorOf(state).text,
          fill: (value) => {
            this.#editorOf(state).setText(value);
            this.#scheduleFrame();
            this.#syncMenu(full, state);
          },
          submit: () => {
            this.#submit(full, state, this.#editorOf(state));
            this.#syncMenu(full, state);
          },
          dismiss: () => {
            this.#menuDismissed = this.#editorOf(state);
            this.#syncMenu(full, state);
          },
        },
      );
      this.#menu = { band, close: this.openBand(band) };
    } else if (!open && this.#menu !== null) {
      this.#menu.close();
      this.#menu = null;
    }
  }

  /** La saisie de l'onglet affiché est vide (ou l'invite absente). */
  #activeDraftEmpty(): boolean {
    const editor = this.#prompt?.editors.get(this.#active.id);
    return editor === undefined || editor.empty;
  }

  /**
   * Foyer de l'invite : la frappe, le collage et les touches d'édition vont à
   * l'éditeur de l'onglet affiché. ↑/↓ et Ctrl+P/Ctrl+N restent à l'invite
   * — l'historique — même sans rien à rappeler : la molette captée arrive en
   * évènement `wheel`, jamais en flèche. Le reste passe : PgUp/PgDn au
   * défilement, Ctrl+C/Ctrl+D sur une invite vide à l'arrêt, `?` sur une
   * invite vide à l'aide.
   */
  #promptFocus(full: IFullscreenState, state: IPromptState): IInputFocus {
    return {
      handle: (event) => {
        // La souris décide du focus, sans rien consommer : le clic sélectionne
        // ou montre un onglet comme avant, la molette défile.
        if (event.kind === "wheel") {
          this.#setPromptFocus(state, false);
          return false;
        }
        if (event.kind === "mouse") {
          if (event.action === "press" && event.button === 0) {
            const origin = full.frame?.origins?.[event.row - 1] ?? null;
            this.#setPromptFocus(state, origin === null);
          }
          return false;
        }
        if (
          event.kind !== "text" &&
          event.kind !== "paste" &&
          event.kind !== "key"
        ) {
          return false;
        }
        if (event.kind === "key" && !event.ctrl && !event.alt) {
          const arrow = event.key === "up" || event.key === "down";
          if (arrow && (full.wheelBurst || !state.focused)) {
            // Un cran de molette traduit, ou le focus au journal : il défile.
            this.#setPromptFocus(state, false);
            return false;
          }
          if (event.key === "pageup" || event.key === "pagedown") {
            this.#setPromptFocus(state, false);
            return false;
          }
        }
        if (
          event.kind === "key" &&
          event.ctrl &&
          !event.alt &&
          event.key === "c" &&
          state.running !== null &&
          // Un second Ctrl+C retombe sur l'éditeur puis l'arrêt : une action
          // qui ignore le signal ne prend pas le terminal en otage.
          !state.running.signal.aborted
        ) {
          state.running.abort();
          return true;
        }
        if (!state.loading) {
          state.loading = true;
          void this.#loadPromptHistory(state);
        }
        if (
          event.kind === "key" &&
          event.key === "tab" &&
          event.shift &&
          !event.ctrl &&
          !event.alt
        ) {
          // Maj+Tab : revenir dans la liste que Tab parcourt.
          const band = this.#menu?.band ?? null;
          if (band?.cycling(this.#editorOf(state).text) === true) {
            band.cycle(-1);
            this.#scheduleFrame();
          }
          return true;
        }
        if (event.kind === "key" && !event.alt && !event.shift) {
          if (event.ctrl && event.key === "r") {
            this.#openSearch(full, state);
            return true;
          }
          if (!event.ctrl && event.key === "tab") {
            this.#setPromptFocus(state, true);
            this.#complete(full, state);
            return true;
          }
        }
        const editor = this.#editorOf(state);
        const result = editor.handle(
          event,
          state.history.history.source(this.#active.id),
        );
        if (result === "submit") {
          this.#completion?.close();
          this.#completion = null;
          this.#setPromptFocus(state, true);
          this.#submit(full, state, editor);
          this.#syncMenu(full, state);
          return true;
        }
        if (result === "changed") {
          this.#setPromptFocus(state, true);
          this.#scheduleFrame();
          this.#syncCompletion();
          this.#syncMenu(full, state);
          return true;
        }
        // Début/Fin sur une invite vide : la navigation du journal.
        if (
          event.kind === "key" &&
          (event.key === "home" || event.key === "end")
        ) {
          this.#setPromptFocus(state, false);
        }
        return (
          event.kind === "key" &&
          !event.alt &&
          !event.shift &&
          (event.ctrl
            ? event.key === "p" || event.key === "n"
            : event.key === "up" || event.key === "down")
        );
      },
    };
  }

  /** Donne le focus à l'invite (`true`) ou au journal ; l'image suit. */
  #setPromptFocus(state: IPromptState, focused: boolean): void {
    if (state.focused === focused) return;
    state.focused = focused;
    this.#scheduleFrame();
  }

  /** L'historique lu (première frappe) : la suggestion est à recalculer. */
  async #loadPromptHistory(state: IPromptState): Promise<void> {
    await state.history.load();
    state.suggestionVersion = -1;
    this.#scheduleFrame();
  }

  /**
   * Entrée : la saisie part — écho dans le journal, historique, puis l'action
   * qui la reconnaît. Envoyer ramène le journal au direct. Une seule action à
   * la fois : la saisie reste dans le tampon tant qu'une autre tourne.
   */
  #submit(
    full: IFullscreenState,
    state: IPromptState,
    editor: LineEditor,
  ): void {
    if (state.running !== null) {
      this.#notify(full, "une commande tourne encore — Ctrl+C l'interrompt");
      return;
    }
    const shown = editor.display;
    const text = editor.take();
    this.#setAnchor(null);
    this.#scheduleFrame();
    if (text.trim() === "") return;
    this.ingest(PROMPT_CHANNEL, "out", `${state.render.sigil}${shown}\n`);
    const kept = state.history.remember(text, this.#active.id, Date.now());
    if (!kept.kept && kept.reason !== "empty") {
      this.#notify(full, describeHistorySkip(kept.reason));
    }
    const action = state.actions.find((candidate) => candidate.matches(text));
    if (action === undefined) {
      // 127 : « commande introuvable », la convention des shells.
      if (kept.kept) state.history.settle(kept.entry, 127, null);
      this.ingest(PROMPT_CHANNEL, "err", describeUnmatchedInput(text));
      return;
    }
    const controller = new AbortController();
    state.running = controller;
    void this.#runAction(
      state,
      action,
      text,
      controller,
      kept.kept ? kept.entry : null,
    );
  }

  /** Lance une action ; son code et sa durée rejoignent l'entrée d'historique. */
  async #runAction(
    state: IPromptState,
    action: IPromptAction,
    text: string,
    controller: AbortController,
    entry: PromptHistoryEntry | null,
  ): Promise<void> {
    const started = performance.now();
    const io: IPromptIO = {
      write: (chunk, stream = "out") =>
        this.ingest(PROMPT_CHANNEL, stream, chunk),
      // Confirmer et prêter le terminal arrivent avec les commandes du CLI
      // (lot 2) : aucun verbe du superviseur n'en a besoin.
      confirm: () =>
        Promise.reject(new Error("confirmation indisponible dans l'invite")),
      suspend: () =>
        Promise.reject(new Error("le terminal ne se prête pas encore")),
      columns: this.#size().columns,
    };
    let code = 1;
    try {
      code = await action.run(text, io, controller.signal);
    } catch (error) {
      this.ingest(
        PROMPT_CHANNEL,
        "err",
        `${action.id} : ${error instanceof Error ? error.message : String(error)}\n`,
      );
    } finally {
      if (state.running === controller) state.running = null;
    }
    if (entry !== null) {
      state.history.settle(
        entry,
        code,
        Math.round(performance.now() - started),
      );
    }
  }

  /**
   * L'image de l'invite de l'onglet affiché, son filet au-dessus — `null`
   * sans invite. Rejouée tant que ni l'éditeur ni la largeur n'ont bougé :
   * `#model` la redemande à chaque image.
   */
  #promptFrame(): IFramePrompt | null {
    const state = this.#prompt;
    if (state === null) return null;
    const editor = this.#editorOf(state);
    if (
      state.suggestionOf !== editor ||
      state.suggestionVersion !== editor.version
    ) {
      state.suggestionOf = editor;
      state.suggestionVersion = editor.version;
      state.suggestion = editor.suggestion(
        state.history.history.source(this.#active.id),
      );
    }
    const width = Math.max(1, this.#size().columns - 1);
    const drawn = editor.render(width, state.render, state.suggestion);
    if (
      state.frame !== null &&
      state.frameSource === drawn &&
      state.frameWidth === width &&
      state.frameFocused === state.focused
    ) {
      return state.frame;
    }
    const rule = "─".repeat(width);
    // Le même objet tant que rien ne change : `renderFrame` ne le réajuste
    // qu'une fois (`fittedPromptLines`).
    const lines = [state.render.color ? `\x1b[2m${rule}\x1b[0m` : rule];
    for (const line of drawn.lines) lines.push(line);
    state.frame = {
      lines,
      cursor: { row: drawn.cursor.row + 1, column: drawn.cursor.column },
      hidden: !state.focused,
    };
    state.frameSource = drawn;
    state.frameWidth = width;
    state.frameFocused = state.focused;
    return state.frame;
  }

  /**
   * Foyer de la bande, en tête de chaîne : le clavier va à la bande ouverte,
   * sauf Ctrl+C et Ctrl+D ; la souris seulement sur son rectangle, en
   * coordonnées locales, et jamais plus loin. Un évènement qu'elle prend
   * demande une image : son état a pu changer (un choix, un terme), et rien
   * d'autre ne la redessinerait avant l'évènement suivant.
   */
  #bandFocus(full: IFullscreenState): IInputFocus {
    return {
      handle: (event) => {
        const band = this.#bands.at(-1);
        if (band === undefined) return false;
        if (event.kind === "mouse" || event.kind === "wheel") {
          const region = full.frame?.band;
          const row = event.row - 1 - (region?.row ?? 0);
          if (region === undefined || row < 0 || row >= region.height) {
            return false;
          }
          band.handle({ ...event, row: row + 1 });
          this.#scheduleFrame();
          return true;
        }
        if (
          event.kind === "key" &&
          event.ctrl &&
          (event.key === "c" || event.key === "d")
        ) {
          return false;
        }
        const taken = band.handle(event);
        if (taken) this.#scheduleFrame();
        return taken;
      },
    };
  }

  /**
   * Ouvre l'aide des gestes. Ouverte, elle reçoit `?` et F1 avant ce foyer
   * et se referme elle-même ; sous une autre bande, elle n'est pas rouverte.
   */
  #openHelp(full: IFullscreenState): void {
    if (this.#closeHelp !== null) return;
    const close = this.openBand(
      helpBand({
        charset: this.#charset,
        color: this.#color,
        mouse: full.mouse,
        prompt: this.#prompt !== null,
        close: () => this.#closeHelp?.(),
      }),
    );
    this.#closeHelp = () => {
      this.#closeHelp = null;
      close();
    };
  }

  /** Un autre onglet que `serveur` retient ce canal. */
  #claimed(channel: string): boolean {
    for (let i = 1; i < this.#views.length; i++) {
      if (this.#views[i]?.match(channel) === true) return true;
    }
    return false;
  }

  /**
   * Retire un onglet et libère les canaux que plus aucun autre ne retient ;
   * s'il était à l'écran, `serveur` le remplace.
   */
  #removeView(view: DevView): void {
    const index = this.#views.indexOf(view);
    if (index <= 0) return;
    this.#views.splice(index, 1);
    // Son brouillon part avec lui.
    this.#prompt?.editors.delete(view.id);
    this.#prompt?.history.history.forget(view.id);
    for (const channel of this.#history.channels()) {
      if (view.match(channel) && !this.#claimed(channel)) {
        this.#history.drop(channel);
      }
    }
    this.#server.transcript.refresh();
    if (this.#active === view) {
      const full = this.#full;
      if (full) this.#selectView(full, this.#server);
      else this.#active = this.#server;
    }
    this.#scheduleFrame();
  }

  /**
   * Montre un onglet. Celui qu'on quitte garde sa position de lecture et
   * compte ce que sa dernière image n'a pas montré ; la sélection, faite sur
   * l'autre texte, est effacée.
   */
  #selectView(full: IFullscreenState, view: DevView): void {
    // Un clic lu sur l'image précédente peut viser un onglet refermé depuis.
    if (view === this.#active || !this.#views.includes(view)) return;
    this.#active = view;
    if (this.#prompt !== null) this.#syncMenu(full, this.#prompt);
    full.selecting = false;
    this.#stopEdge(full);
    full.selection = null;
    full.range = null;
    this.#scheduleFrame();
  }

  /** L'onglet sous un point de l'écran (depuis 1), lu sur l'image affichée. */
  #tabAt(full: IFullscreenState, row: number, column: number): DevView | null {
    const tabs = full.frame?.tabs;
    if (tabs?.row !== row - 1) return null;
    for (const span of tabs.spans) {
      if (column - 1 >= span.start && column - 1 < span.end) {
        return full.tabViews[span.index] ?? null;
      }
    }
    return null;
  }

  /**
   * Les onglets montrés : `serveur` toujours, l'actif, un onglet ouvert à la
   * volée, et tout onglet qui a quelque chose à montrer. Le tableau n'est
   * rebâti que quand cet ensemble change — une image le lit, une touche de
   * défilement aussi ; une image passée garde le sien (ce qu'un clic vise).
   */
  #shownViews(): readonly DevView[] {
    const shown = this.#shown;
    let count = 0;
    let same = true;
    for (let i = 0; i < this.#views.length; i++) {
      const view = this.#views[i];
      if (view === undefined || !this.#isShown(view, i)) continue;
      if (shown[count] !== view) same = false;
      count++;
    }
    if (same && count === shown.length) return shown;
    this.#shown = this.#views.filter((view, i) => this.#isShown(view, i));
    return this.#shown;
  }

  /** Un onglet a sa place sur la ligne. */
  #isShown(view: DevView, index: number): boolean {
    return (
      index === 0 ||
      view === this.#active ||
      view.alwaysShown ||
      view.transcript.length > 0
    );
  }

  /** La ligne d'onglets de l'image — `null` quand un seul est montré. */
  #tabs(views: readonly DevView[]): IFrameTabs | null {
    if (views.length < 2) return null;
    const active = this.#active;
    return {
      active: views.indexOf(active),
      items: views.map((view) =>
        view === active
          ? {
              title: view.title,
              unseen: 0,
              alert: false,
              outcome: view.outcome,
            }
          : {
              title: view.title,
              unseen: view.unseen,
              alert: view.alert,
              outcome: view.outcome,
            },
      ),
    };
  }

  /** Défile de `delta` lignes d'écran (positif = remonter). */
  #scrollBy(full: IFullscreenState, delta: number): void {
    this.#setAnchor(scrollAnchor(this.#model(full), this.#size(), delta));
  }

  #setAnchor(anchor: IScrollAnchor | null): void {
    const view = this.#active;
    const before = view.anchor;
    if (
      before === anchor ||
      (before !== null &&
        anchor !== null &&
        before.seq === anchor.seq &&
        before.below === anchor.below)
    ) {
      return;
    }
    view.anchor = anchor;
    this.#scheduleFrame();
  }

  /** Ce que l'image lit : l'onglet à l'écran, la barre, la ligne d'onglets. */
  #model(
    full: IFullscreenState,
    views: readonly DevView[] = this.#shownViews(),
  ): IFrameModel {
    const view = this.#active;
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
      transcript: view.transcript,
      anchor: view.anchor,
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
      // Sous l'invite, la barre se resserre : la marque réduite le lui dit.
      mark: this.#prompt?.mark ?? this.#mark,
      heights: view.heights,
      statusBar: full.statusBar,
      ...(view.floorSeq === undefined ? {} : { floorSeq: view.floorSeq }),
      // L'indicateur de build du superviseur se réécrit sur place, sans fin
      // de ligne : sans lui, un long build laissait l'écran figé.
      partial: view.match("supervisor")
        ? (this.#history.channel("supervisor")?.partial("supervisor", "out") ??
          "")
        : "",
      tabs: this.#tabs(views),
      band: this.#bands.at(-1) ?? null,
      panel: view.panel,
      prompt: this.#promptFrame(),
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
        value: selectionRange(selection, this.#active.transcript),
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
    if (full?.frameTimer !== null || full.awaitingDrain) return;
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
    const views = this.#shownViews();
    const frame = renderFrame(this.#model(full, views), this.#size());
    const previous = full.frame;
    const { shift, changes } =
      full.paint === "scroll"
        ? diffFrameScrolled(previous, frame)
        : {
            shift: 0,
            changes: diffFrame(full.paint === "full" ? null : previous, frame),
          };
    full.frame = frame;
    full.tabViews = views;
    this.#active.markSeen();
    const sameCursor =
      previous !== null &&
      (previous.cursor === frame.cursor ||
        (previous.cursor !== null &&
          frame.cursor !== null &&
          previous.cursor.row === frame.cursor.row &&
          previous.cursor.column === frame.cursor.column));
    if (changes.length === 0 && shift === 0 && sameCursor) return;
    let out = full.synchronized ? "\x1b[?2026h\x1b[?25l" : "\x1b[?25l";
    if (previous === null) out += "\x1b[H\x1b[2J";
    else if (shift !== 0) {
      // Attributs remis AVANT : les lignes libérées prennent le fond par
      // défaut, celui que le diff leur suppose. Les marges ne survivent pas
      // à l'image — aucun état laissé au terminal entre deux écritures.
      const rows = frame.journalRows ?? 0;
      out += `\x1b[0m\x1b[1;${rows}r\x1b[${shift > 0 ? `${shift}S` : `${-shift}T`}\x1b[r`;
    }
    for (const { row, text } of changes) {
      // Un lien qu'une ligne ouvre sans le fermer ne déborde ni sur les
      // lignes suivantes ni sur ce qu'écrira le shell après nous.
      const close = text.includes("\x1b]8;") ? "\x1b]8;;\x1b\\" : "";
      out += `\x1b[${row + 1};1H${text}${close}\x1b[0m\x1b[K`;
    }
    out += cursorSequence(frame);
    if (full.synchronized) out += "\x1b[?2026l";
    // Le terminal ne suit pas (SSH lent, console Windows) : l'image est
    // partie dans le tampon, les suivantes attendent qu'il se vide — le relais
    // des enfants reste vivant, au lieu d'empiler des images que personne ne
    // verra (ADR-0013, D6).
    if (!this.#stdout.write(out) && this.#stdout.once !== undefined) {
      full.awaitingDrain = true;
      this.#stdout.once("drain", full.onDrain);
    }
  }

  /** L'état d'affichage d'un couple (canal, flux), créé au premier paquet. */
  #echoOf(channel: string, stream: ProcessOutputStream): IEchoState {
    const key = channelKey(channel, stream);
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
/** Le plus long début commun à des saisies (au moins une). */
function commonPrefix(texts: readonly string[]): string {
  let common = texts[0] ?? "";
  for (const text of texts) {
    let i = 0;
    while (i < common.length && i < text.length && common[i] === text[i]) i++;
    common = common.slice(0, i);
  }
  return common;
}

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
