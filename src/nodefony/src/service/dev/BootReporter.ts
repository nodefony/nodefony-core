import readline from "node:readline";
import type Kernel from "../../kernel/Kernel";
import Syslog from "../../syslog/Syslog";

/** Frames braille du spinner (rotation fluide, 10 étapes). */
const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const CYAN = "\x1b[36m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

/** Une phase de boot = l'event Kernel qui la CLÔT + son libellé affiché. */
interface BootPhase {
  event: string;
  label: string;
}

/**
 * Phases du boot dans l'ordre chronologique. Chaque phase se ferme quand son
 * event Kernel fire (le spinner se fige en `✓` + durée, puis la suivante démarre).
 * `onStart` clôt « Application » → couvre `loadApp()` (le gros import des modules,
 * ~1.2 s, sinon un écran figé sans feedback — cf audit boot 2026-06-01).
 */
const PHASES: readonly BootPhase[] = [
  { event: "onStart", label: "Application" },
  { event: "onRegister", label: "Modules" },
  { event: "onBoot", label: "Configuration" },
  { event: "onReady", label: "Services & ORM" },
  { event: "onServersReady", label: "Serveurs" },
];

/**
 * Affichage « boot de rêve » du serveur en développement : une checklist animée
 * (spinner + `✓`/`✗` par phase de boot) à la place du mur de logs `INFO`/`MODULE ADD`.
 *
 * **Dev-only** : instancié uniquement par `DevCommand`, côté enfant supervisé
 * (`NODEFONY_DEV_CHILD=1`). En prod/cluster : jamais (logs structurés cloud-native).
 *
 * **Backplane-safe** : le spinner s'écrit DIRECTEMENT sur `process.stdout`, jamais via
 * le Syslog. Le mute pendant le boot = {@link Syslog.setSinkEnabled} (coupe le sink
 * texte écran) ; les transports d'écriture (`_transports` : file/cluster/loki) ET le
 * ring buffer reçoivent TOUS les logs → rien perdu, le Log Backplane intact.
 *
 * Trois modes (tous dev-only) :
 * - **TTY normal** : spinner animé + console mutée (logs → buffer/backplane).
 * - **`--debug`** : pas d'animation, pas de mute → marqueurs `✓` de phase entre les logs
 *   bruts complets (structure sans rien cacher).
 * - **non-TTY** (CI/redirection) : marqueurs statiques, zéro séquence `\r`.
 */
class BootReporter {
  readonly #kernel: Kernel;
  /** true = spinner animé + mute (TTY non-debug) ; false = marqueurs statiques. */
  readonly #animated: boolean;
  #frame = 0;
  #phaseIndex = 0;
  #bootStart = 0;
  #phaseStart = 0;
  #timer: NodeJS.Timeout | null = null;
  #done = false;

  constructor(kernel: Kernel, opts: { debug: boolean; tty: boolean }) {
    this.#kernel = kernel;
    // Animation + mute SEULEMENT en TTY non-debug. En debug ou hors TTY → statique,
    // logs bruts visibles (debug = tout voir ; fichier/CI = pas de séquence `\r`).
    this.#animated = opts.tty && !opts.debug;
  }

  /**
   * Branche les hooks de phase sur le Kernel + démarre l'affichage.
   * À appeler depuis `DevCommand.onKernelPreStart` (après le splash, avant `loadApp`).
   */
  attach(): void {
    this.#bootStart = this.#phaseStart = performance.now();
    if (this.#animated) {
      // Mute écran (backplane + ring buffer intacts). Le spinner a stdout pour lui seul.
      Syslog.setSinkEnabled(false);
      this.#render();
      this.#timer = setInterval(() => this.#render(), 80);
      this.#timer.unref?.();
    }
    for (const phase of PHASES) {
      this.#kernel.once(phase.event, () => this.#phaseDone(phase.label));
    }
    this.#kernel.once("onPostReady", () => this.#finish());
    this.#kernel.once("onTerminate", (_k: unknown, code?: number) =>
      this.#abort(typeof code === "number" ? code : 0),
    );
  }

  /** Libellé de la phase courante (ou « Finalisation » au-delà des phases connues). */
  #label(): string {
    return PHASES[this.#phaseIndex]?.label ?? "Finalisation";
  }

  /** Réécrit la ligne courante avec la frame de spinner suivante (TTY animé). */
  #render(): void {
    this.#frame = (this.#frame + 1) % FRAMES.length;
    readline.clearLine(process.stdout, 0);
    readline.cursorTo(process.stdout, 0);
    process.stdout.write(
      `  ${CYAN}${FRAMES[this.#frame]}${RESET} ${this.#label()}${DIM}…${RESET}`,
    );
  }

  /** Fige une ligne de phase terminée : `mark label (durée)`. */
  #freeze(mark: string, label: string, ms: number): void {
    if (this.#animated) {
      readline.clearLine(process.stdout, 0);
      readline.cursorTo(process.stdout, 0);
    }
    const dt =
      ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${Math.round(ms)}ms`;
    process.stdout.write(`  ${mark} ${label} ${DIM}(${dt})${RESET}\n`);
  }

  /** Une phase vient de se clôturer (son event Kernel a fire). */
  #phaseDone(label: string): void {
    if (this.#done) return;
    const now = performance.now();
    this.#freeze(`${GREEN}✓${RESET}`, label, now - this.#phaseStart);
    this.#phaseStart = now;
    this.#phaseIndex++;
  }

  /** Boot complet (`onPostReady`) : récap + rend la main au Syslog. */
  #finish(): void {
    if (this.#done) return;
    this.#done = true;
    this.#stopTimer();
    if (this.#animated) Syslog.setSinkEnabled(true);
    const dt = ((performance.now() - this.#bootStart) / 1000).toFixed(2);
    process.stdout.write(
      `\n  ${GREEN}✓ Prêt${RESET} ${DIM}en ${dt}s${RESET}\n\n`,
    );
  }

  /** Boot interrompu (`onTerminate`) : marque `✗`, rend la main, déverse les erreurs. */
  #abort(code: number): void {
    if (this.#done) return;
    this.#done = true;
    this.#stopTimer();
    if (this.#animated) {
      this.#freeze(
        `${RED}✗${RESET}`,
        this.#label(),
        performance.now() - this.#phaseStart,
      );
      Syslog.setSinkEnabled(true);
      this.#dumpErrors();
    }
    // code 0 = arrêt volontaire (commande one-shot) → pas une erreur de boot.
    if (code !== 0) {
      process.stdout.write(
        `  ${RED}✗ Boot interrompu${RESET} ${DIM}(code ${code})${RESET}\n`,
      );
    }
  }

  /** Déverse les ERROR/CRITIC/ALERT/EMERGENCY restés dans le ring buffer pendant le mute. */
  #dumpErrors(): void {
    const sys = this.#kernel.syslog;
    if (!sys) return;
    for (const pdu of sys.ringStack) {
      if (pdu.severity >= 0 && pdu.severity <= 3) {
        process.stdout.write(`  ${pdu.toString()}\n`);
      }
    }
  }

  #stopTimer(): void {
    if (this.#timer) {
      clearInterval(this.#timer);
      this.#timer = null;
    }
  }
}

export default BootReporter;
