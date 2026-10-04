import readline from "node:readline";
import { stripVTControlCharacters } from "node:util";
import type Kernel from "../../kernel/Kernel";
import Syslog, { STDERR_LOG_SINK } from "../../syslog/Syslog";
import { readLastBoot, type ILastBoot } from "../../kernel/checks/lastBoot";
import { shouldColorize } from "../../kernel/checks/report";
import {
  discoverDevProcesses,
  splitByProject,
  type DevProcessInfo,
} from "./devProcess";
import type { IFirewallZoneView } from "./firewallZones";
import {
  CLEAR_SCREEN,
  reloadCount,
  type StartupOutputMode,
} from "./outputMode";
import { brandMark, resolveBrandCharset } from "../../cli/brand";
import { StatusLine } from "./statusLine";
import { onTerminalResize, terminalSize } from "../../runtime/isTerminal";
import { DEV_CHANNEL, sendToSupervisor } from "./devChannel";
import {
  buildStartupView,
  diffReload,
  formatSeconds,
  renderReloadHuman,
  renderReloadPlain,
  renderStartupHuman,
  renderStartupPlain,
  renderStatusBar,
  SCREEN_SYMBOLS,
  supportsHyperlinks,
  type IScreenSymbols,
  type ScreenCharset,
  type IStartupView,
} from "./startupScreen";

/** Frames braille du spinner (rotation fluide, 10 étapes). */
const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;
/** Spinner ASCII — la console Windows classique n'a pas le braille. */
const ASCII_FRAMES = ["|", "/", "-", "\\"] as const;
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
 * Charge utile de l'event pont `onFrontendReady` (émis par `FrontendService`).
 * `ready` = nombre d'instances Vite (familles) réellement en état `ready` :
 * 0 → échec total (`✗`), ≥ 1 → bundles servis (`✓`).
 */
interface IFrontendReadyPayload {
  bundles: number;
  names: string[];
  ready: number;
}

/**
 * Phases du boot dans l'ordre chronologique. Chaque phase se ferme quand son
 * event Kernel fire (le spinner se fige en `✓` + durée, puis la suivante démarre).
 * `onStart` clôt « Application » → couvre `loadApp()` (le gros import des modules,
 * ~1.2 s, sinon un écran figé sans feedback — cf audit boot 2026-06-01).
 */
/** Phase du canal de boot où `@nodefony/frontend` décrit ses instances. */
const FRONTEND_PHASE = "Frontend (Vite)";

const PHASES: readonly BootPhase[] = [
  { event: "onStart", label: "Application" },
  { event: "onRegister", label: "Modules" },
  { event: "onBoot", label: "Configuration" },
  { event: "onReady", label: "Services & ORM" },
  { event: "onServersReady", label: "Serveurs" },
];

/**
 * L'écran de démarrage du serveur de développement : une checklist par phase
 * de boot pendant qu'il démarre, puis LE bilan ({@link buildStartupView}),
 * rendu selon le mode demandé — `human`, `plain` ou `json` (cf `outputMode.ts`).
 *
 * **Dev-only** : instancié uniquement par `DevCommand`, côté serveur (enfant
 * supervisé, ou `--no-watch`). En production : jamais (journal structuré).
 *
 * **Backplane-safe** : l'écran s'écrit DIRECTEMENT sur `process.stdout`, jamais
 * via le Syslog. Pendant le boot, le sink texte écran est coupé
 * ({@link Syslog.setSinkEnabled}) ; les transports (fichier, cluster, loki) et
 * le ring buffer reçoivent TOUS les journaux — rien n'est perdu, `--debug`
 * les montre tous.
 *
 * Les modes :
 * - **human + terminal** : spinner animé, phases figées en `✓`, écran final ;
 * - **human hors terminal** (forcé) : marqueurs statiques, journaux visibles ;
 * - **plain** : une ligne `boot:` par phase entre les lignes du journal, puis
 *   le bilan machine — 0 ANSI de l'écran ;
 * - **json** : rien pendant le boot, puis UNE ligne JSON par démarrage ;
 * - **--debug** : tout le journal, marqueurs de phase entre les lignes.
 *
 * Quand le démarrage RÉUSSIT (humain, terminal, hors --debug), l'écran est
 * remis à zéro, la bannière reposée en haut et le bilan rendu dessous — au
 * premier démarrage comme à chaque rechargement. Sur un **rechargement**
 * (`NF_DEV_RELOAD=1`, posé par le superviseur), une ligne `↻` précède le bilan
 * et dit ce qui a changé ; les rendus machine ne disent QUE ce qui a changé.
 * Les processus n'y sont pas relevés (un `lsof` par processus).
 */
class BootReporter {
  readonly #kernel: Kernel;
  readonly #mode: StartupOutputMode;
  /** Spinner animé (human + terminal, hors --debug). */
  readonly #animated: boolean;
  /** Sink écran coupé pendant le boot (tout rendu dédié, hors --debug). */
  readonly #muted: boolean;
  readonly #color: boolean;
  readonly #hyperlinks: boolean;
  /** Ce démarrage est-il un rechargement à chaud ? */
  readonly #reload: boolean;
  /** Rechargement automatique (superviseur) — sinon `--no-watch`. */
  readonly #supervised: boolean;
  /** URL du débogueur, ou `null`. */
  readonly #inspector: string | null;
  /**
   * Jeu de caractères de l'écran — la règle du logo (`resolveBrandCharset`),
   * une seule pour toute la sortie de développement.
   */
  readonly #charset: ScreenCharset;
  readonly #symbols: IScreenSymbols;
  /** Bilan du démarrage précédent — lu AVANT que celui-ci ne l'écrase. */
  #previous: ILastBoot | null = null;
  #frame = 0;
  #phaseIndex = 0;
  #bootStart = 0;
  #phaseStart = 0;
  #timer: NodeJS.Timeout | null = null;
  #done = false;
  /** Vite compile encore (`onFrontendStart` reçu, `onFrontendReady` pas encore). */
  #frontendPending = false;
  /** `performance.now()` au démarrage de la compilation Vite. */
  #frontendStart = 0;
  /** Libellé dynamique de la phase Vite (prend le pas sur `#label()`). */
  #frontendLabel: string | null = null;
  /** `onPostReady` est arrivé pendant la compilation Vite → bilan en attente. */
  #finishDeferred = false;
  /** Total de bundles Vite (jauge) — posé à `onFrontendStart`. */
  #frontendTotal = 0;
  /** Bundles Vite résolus — incrémenté à `onFrontendProgress`. */
  #frontendDone = 0;
  /** Handler `onFrontendProgress` (détaché à la fin de la phase Vite). */
  #onFrontendProgress: ((p?: unknown) => void) | null = null;
  /** Ligne d'état figée en bas — posée au premier bilan réussi. */
  #status: StatusLine | null = null;
  /** Heure (`16:48`) où ce serveur est devenu prêt — `null` avant. */
  #readyAt: string | null = null;
  /** Résultat de la compilation Vite — `null` sans frontend. */
  #frontendResult: Partial<IFrontendReadyPayload> | null = null;

  /**
   * @param kernel - le noyau qui démarre.
   * @param opts - `debug` : tout le journal ; `tty` : capacité CONSTATÉE du
   *   terminal (`kernel.isTTY`) ; `mode` : rendu choisi (cf `resolveOutputMode`) ;
   *   `reload` : ce démarrage suit une modification (`NF_DEV_RELOAD=1`).
   */
  constructor(
    kernel: Kernel,
    opts: {
      debug: boolean;
      tty: boolean;
      mode: StartupOutputMode;
      reload: boolean;
      /** Lancé par le superviseur (rechargement automatique) ou `--no-watch`. */
      supervised: boolean;
      /** URL du débogueur ouvert dans le serveur, ou `null`. */
      inspector: string | null;
    },
  ) {
    this.#kernel = kernel;
    this.#mode = opts.mode;
    this.#animated = opts.mode === "human" && opts.tty && !opts.debug;
    // `plain` garde le journal à l'écran : le démarrage détaché (`--detach`) et
    // l'intégration continue LISENT ces lignes (`MODULE LOAD`, `CRITIC`) dans
    // la sortie. Seul `json` le coupe — un flux JSON ne supporte aucune ligne
    // étrangère ; les erreurs partent alors sur la sortie d'erreur.
    this.#muted = !opts.debug && (this.#animated || opts.mode === "json");
    this.#color =
      opts.mode === "human" && shouldColorize(process.env, opts.tty);
    this.#hyperlinks =
      opts.mode === "human" && supportsHyperlinks(process.env, opts.tty);
    this.#reload = opts.reload;
    this.#supervised = opts.supervised;
    this.#inspector = opts.inspector;
    this.#charset = resolveBrandCharset(process.platform, process.env);
    this.#symbols = SCREEN_SYMBOLS[this.#charset];
  }

  /**
   * Branche les hooks de phase sur le Kernel + démarre l'affichage.
   * À appeler depuis `DevCommand.onKernelPreStart` (après le splash, avant `loadApp`).
   */
  attach(): void {
    // Lu MAINTENANT : le noyau réécrit ce fichier juste avant `onPostReady`.
    if (this.#reload) this.#previous = readLastBoot(this.#kernel.path);
    this.#bootStart = this.#phaseStart = performance.now();
    // En `json`, la sortie standard appartient au bilan : le journal d'écran
    // part sur la sortie d'erreur pour TOUTE la vie du processus — pendant le
    // boot (coupé, puis rendu) comme ensuite.
    if (this.#mode === "json") Syslog.setLogSink(STDERR_LOG_SINK);
    if (this.#muted) {
      // Journal hors de l'écran (backplane + ring buffer intacts).
      Syslog.setSinkEnabled(false);
      // Le bilan liste déjà les adresses : les bannières « Server Listen on… »
      // de `onPostReady` seraient redondantes.
      this.#kernel.suppressBootBanners = true;
    }
    if (this.#animated) {
      this.#render();
      this.#timer = setInterval(() => this.#render(), 80);
      this.#timer.unref();
    }
    for (const phase of PHASES) {
      this.#kernel.once(phase.event, () => this.#phaseDone(phase.label));
    }
    this.#kernel.once("onPostReady", () => this.#finish());
    this.#kernel.once("onTerminate", (_k: unknown, code?: number) =>
      this.#abort(typeof code === "number" ? code : 0),
    );
    // Pont frontend (dev-only) : la compilation Vite vit HORS du cycle Kernel
    // (spawn async qui finit après `onPostReady`). Sans frontend, ces events ne
    // partent jamais → comportement inchangé.
    this.#kernel.once("onFrontendStart", (payload?: unknown) =>
      this.#frontendBegin(payload as { bundles?: number }),
    );
    // `.on` (N bundles) → détaché à `#frontendEnd` (pas de listener qui traîne).
    this.#onFrontendProgress = (payload?: unknown) => {
      const p = payload as { ready?: number; total?: number } | undefined;
      if (typeof p?.ready === "number") this.#frontendDone = p.ready;
      if (typeof p?.total === "number") this.#frontendTotal = p.total;
      if (this.#frontendTotal === 0 || this.#animated || this.#reload) return;
      if (this.#mode === "plain") {
        process.stdout.write(
          `boot: frontend ${this.#frontendDone}/${this.#frontendTotal}\n`,
        );
      } else if (this.#mode === "human") {
        process.stdout.write(
          `  ${this.#paint(CYAN, "·")} Frontend (Vite) ${this.#frontendDone}/${this.#frontendTotal}\n`,
        );
      }
    };
    this.#kernel.on("onFrontendProgress", this.#onFrontendProgress);
    this.#kernel.once("onFrontendReady", (payload?: unknown) =>
      // Émis par `@nodefony/frontend` sans contrat typé : rien n'est garanti.
      this.#frontendEnd(payload as Partial<IFrontendReadyPayload> | undefined),
    );
  }

  /** Une couleur — seulement si l'écran en porte. */
  #paint(code: string, text: string): string {
    return this.#color ? `${code}${text}${RESET}` : text;
  }

  /** Libellé de la phase courante (ou « Finalisation » au-delà des phases connues). */
  #label(): string {
    if (this.#frontendLabel) return this.#frontendLabel;
    return PHASES[this.#phaseIndex]?.label ?? "Finalisation";
  }

  /** Réécrit la ligne courante : jauge Vite en phase frontend, sinon spinner. */
  #render(): void {
    const frames = this.#charset === "ascii" ? ASCII_FRAMES : FRAMES;
    this.#frame = (this.#frame + 1) % frames.length;
    const frame = frames[this.#frame] ?? "";
    readline.clearLine(process.stdout, 0);
    readline.cursorTo(process.stdout, 0);
    const label = this.#reload ? "Rechargement" : this.#label();
    if (this.#frontendPending && this.#frontendTotal > 0) {
      process.stdout.write(
        `  ${CYAN}${frame}${RESET} ${this.#reload ? label : "Frontend (Vite)"}  ` +
          `${this.#bar(this.#frontendDone, this.#frontendTotal)}  ` +
          `${DIM}${this.#frontendDone}/${this.#frontendTotal} bundles${RESET}`,
      );
      return;
    }
    process.stdout.write(`  ${CYAN}${frame}${RESET} ${label}${DIM}…${RESET}`);
  }

  /** Barre `▰▰▰▱▱` proportionnelle (vert rempli / dim vide), largeur fixe 14. */
  #bar(done: number, total: number): string {
    const width = 14;
    const filled =
      total > 0 ? Math.min(width, Math.round((done / total) * width)) : 0;
    return (
      `${GREEN}${(this.#charset === "ascii" ? "#" : "▰").repeat(filled)}${RESET}` +
      `${DIM}${(this.#charset === "ascii" ? "-" : "▱").repeat(width - filled)}${RESET}`
    );
  }

  /** Efface la ligne du spinner (terminal animé seulement). */
  #clearSpinner(): void {
    if (!this.#animated) return;
    readline.clearLine(process.stdout, 0);
    readline.cursorTo(process.stdout, 0);
  }

  /**
   * Fige une phase terminée, selon le mode : `✓ label (1,2 s)` à l'écran,
   * `boot: label 1.2s` en rendu machine, rien en JSON ni sur un rechargement
   * (la ligne finale suffit).
   */
  #freeze(ok: boolean, label: string, ms: number, note = ""): void {
    if (this.#reload || this.#mode === "json") return;
    if (this.#mode === "plain") {
      process.stdout.write(
        `boot: ${label}${ok ? "" : " failed"} ${(ms / 1000).toFixed(1)}s\n`,
      );
      return;
    }
    this.#clearSpinner();
    const mark = ok
      ? this.#paint(GREEN, this.#symbols.ok)
      : this.#paint(RED, this.#symbols.fail);
    process.stdout.write(
      `  ${mark} ${label}${note ? ` ${this.#paint(DIM, note)}` : ""} ` +
        `${this.#paint(DIM, `(${formatSeconds(ms)})`)}\n`,
    );
  }

  /** Une phase vient de se clôturer (son event Kernel a fire). */
  #phaseDone(label: string): void {
    if (this.#done) return;
    const now = performance.now();
    this.#freeze(true, label, now - this.#phaseStart);
    this.#renderPhaseDetail(label);
    this.#phaseStart = now;
    this.#phaseIndex++;
  }

  /**
   * Lignes de détail SOUS une phase qui vient de se figer, pour que le boot
   * RACONTE ce qui se passe : le canal neutre `Kernel.getBootLines(phase)`, et
   * un digest des modules sous « Modules ». Écran humain seulement — le bilan
   * machine porte ces faits à la fin.
   */
  #renderPhaseDetail(label: string): void {
    if (this.#mode !== "human" || this.#reload) return;
    let lines = this.#kernel.getBootLines(label);
    if (label === "Modules" && lines.length === 0) {
      lines = this.#moduleDigest();
    }
    for (const line of lines) {
      process.stdout.write(`       ${this.#paint(DIM, line)}\n`);
    }
  }

  /** Digest lisible des modules chargés (noms courts, 8 par ligne). */
  #moduleDigest(): string[] {
    const names = Object.keys(this.#kernel.modules).map((m) =>
      m.replace(/^@nodefony\//, ""),
    );
    const out: string[] = [];
    for (let i = 0; i < names.length; i += 8) {
      out.push(names.slice(i, i + 8).join(" · "));
    }
    return out;
  }

  /**
   * Boot complet (`onPostReady`). Si Vite compile encore, le bilan est DIFFÉRÉ
   * jusqu'à `onFrontendReady` — sinon « Prêt » s'afficherait avant la ligne Vite.
   * Le spinner continue de tourner, le sink reste coupé.
   */
  #finish(): void {
    if (this.#done) return;
    if (this.#frontendPending) {
      this.#finishDeferred = true;
      return;
    }
    this.#doFinish();
  }

  /** Rend le bilan, puis rend la main au Syslog (idempotent sur le sink). */
  #doFinish(): void {
    if (this.#done) return;
    this.#done = true;
    this.#stopTimer();
    this.#clearSpinner();
    const view = this.#view();
    if (this.#muted) Syslog.setSinkEnabled(true);
    this.#write(view);
  }

  /** Le bilan de CE démarrage — une seule liste de faits pour les trois rendus. */
  #view(): IStartupView {
    const report = this.#kernel.getBootReport();
    const frontend = this.#frontendResult;
    // Le noyau fige sa durée avant `onPostReady` ; la compilation Vite finit
    // APRÈS. « Prêt en » dit le temps jusqu'à ce que tout soit servi.
    report.durationMs = Math.max(
      report.durationMs,
      performance.now() - this.#bootStart,
    );
    return buildStartupView(report, {
      version: this.#kernel.frameworkVersion(),
      environment: this.#kernel.environment,
      root: this.#kernel.path,
      frontend: frontend
        ? {
            bundles: frontend.bundles ?? 0,
            ready: frontend.ready ?? 0,
            names: frontend.names ?? [],
            detail: this.#kernel.getBootLines(FRONTEND_PHASE),
          }
        : null,
      data: this.#kernel.getBootLines("Services & ORM"),
      // Les processus ne se montrent pas sur un rechargement : rien à observer.
      processes: this.#reload ? null : this.#processes(),
      firewall: this.#firewallZones(),
      supervised: this.#supervised,
      inspector: this.#inspector,
    });
  }

  /** Écrit le bilan dans le rendu demandé — en UNE écriture. */
  #write(view: IStartupView): void {
    const previous = this.#reload && view.ready ? this.#previous : null;
    const diff = previous ? diffReload(previous, view) : null;
    let lines: string[];
    if (this.#mode === "json") {
      lines = [
        JSON.stringify({
          event: !view.ready ? "failed" : diff ? "reloaded" : "ready",
          ...view,
          ...(diff ? { reload: diff } : {}),
        }),
      ];
    } else if (this.#mode === "plain") {
      lines = diff ? renderReloadPlain(diff, view) : renderStartupPlain(view);
    } else {
      const options = {
        color: this.#color,
        hyperlinks: this.#hyperlinks,
        columns: terminalSize().columns,
        reload: this.#reload,
        charset: this.#charset,
      };
      // Tout va bien (serveurs en écoute), dans un terminal, hors --debug :
      // page propre — l'écran est remis à zéro, la bannière reposée en haut
      // (logo + versions), le bilan dessous. La checklist et le bruit du build
      // ont fait leur office. Sur un échec, RIEN n'est effacé : l'erreur reste.
      if (this.#animated && view.ready) {
        process.stdout.write(`${CLEAR_SCREEN}${this.#kernel.devHeader()}`);
      }
      // La ligne « ↻ » dit ce qui a changé ; le bilan complet suit dessous.
      lines = [
        "",
        ...(diff ? [...renderReloadHuman(diff, view, options), ""] : []),
        ...renderStartupHuman(view, options),
        "",
      ];
    }
    process.stdout.write(`${lines.join("\n")}\n`);
    if (this.#animated && view.ready) this.#showStatus(view);
  }

  /**
   * Pose la barre d'état en bas du terminal (cf `statusLine.ts` : en bas,
   * pour que l'historique continue de se remplir).
   *
   * Sous le superviseur de développement, le serveur écrit dans un tube : il
   * n'a pas d'écran à lui. Il envoie son bilan en DONNÉES (`status-view`) et
   * c'est le superviseur, seul propriétaire du terminal, qui dessine la
   * barre. Sans superviseur (`--no-watch`), il la dessine lui-même.
   */
  #showStatus(view: IStartupView): void {
    // L'heure où le serveur est devenu prêt — figée : un redimensionnement
    // redessine le bloc, il ne le change pas.
    if (this.#readyAt === null) {
      const now = new Date();
      this.#readyAt = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    }
    const context = {
      project: this.#kernel.projectName,
      readyAt: this.#readyAt,
      reloads: reloadCount(process.env),
    };
    if (
      this.#status === null &&
      sendToSupervisor({
        channel: DEV_CHANNEL,
        type: "status-view",
        view,
        context,
      })
    ) {
      return;
    }
    const size = terminalSize();
    const lines = renderStatusBar(
      view,
      context,
      {
        color: this.#color,
        columns: size.columns,
        rows: size.rows,
        charset: this.#charset,
      },
      brandMark(this.#charset, this.#color),
    );
    if (this.#status === null) {
      const status = new StatusLine([process.stdout, process.stderr]);
      this.#status = status;
      // Retiré DÈS le début de l'arrêt, processus encore vivant : il est
      // souvent tué net avant `exit`, et un bloc laissé là ferait tomber
      // l'invite du shell sous un bloc mort. `release` est idempotent.
      const release = (): void => status.release();
      // Sur le SIGNAL même, en tête de file : avant l'arrêt de Vite et ses
      // journaux, qui passent par `onTerminate`. `onTerminate` et `exit`
      // restent en filets (sous Windows, Ctrl+C arrive en SIGINT).
      for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"] as const) {
        process.prependOnceListener(signal, release);
      }
      this.#kernel.once("onTerminate", release);
      process.once("exit", release);
      // Le bloc se recompose à la nouvelle taille (logo ou ligne seule,
      // morceaux qui tombent) : on le rend de nouveau.
      onTerminalResize(() => this.#showStatus(view));
    }
    this.#status.show(lines);
  }

  /**
   * Processus de CE projet (superviseur / serveur / Vite) — même observation que
   * `nodefony status` (`ps`, sans IPC). `null` si l'observation échoue : elle
   * n'est jamais bloquante. Synchrone, une fois par démarrage, dev seulement.
   */
  #processes(): DevProcessInfo[] | null {
    try {
      return splitByProject(
        discoverDevProcesses({ includeSelf: true }),
        this.#kernel.path,
      ).mine;
    } catch {
      return null;
    }
  }

  /**
   * Zones du pare-feu, lues sur le service `firewall` résolu PAR NOM (le cœur
   * n'importe jamais `@nodefony/security`). `null` sans pare-feu — une
   * application sans pare-feu est un choix assumé, pas un oubli à signaler.
   */
  #firewallZones(): IFirewallZoneView[] | null {
    const fw = this.#kernel.container?.get("firewall") as
      | { describe?: () => { zones?: ReadonlyArray<IFirewallZoneView> } }
      | null
      | undefined;
    if (typeof fw?.describe !== "function") return null;
    try {
      return [...(fw.describe().zones ?? [])];
    } catch {
      return null; // observation best-effort — jamais bloquer le bilan
    }
  }

  /** Vite a commencé à compiler (`onFrontendStart`). */
  #frontendBegin(payload?: { bundles?: number }): void {
    if (this.#done) return;
    this.#frontendPending = true;
    this.#frontendStart = performance.now();
    this.#frontendLabel = "Frontend (Vite)";
    this.#frontendTotal = payload?.bundles ?? 0;
    this.#frontendDone = 0;
  }

  /**
   * Vite a fini ou échoué (`onFrontendReady`) : fige la ligne Vite, puis
   * débloque le bilan si `onPostReady` l'attendait.
   */
  #frontendEnd(payload: Partial<IFrontendReadyPayload> | undefined): void {
    if (this.#done || !this.#frontendPending) return;
    this.#frontendPending = false;
    this.#frontendResult = payload ?? null;
    this.#frontendLabel = null;
    if (this.#onFrontendProgress) {
      this.#kernel.removeListener(
        "onFrontendProgress",
        this.#onFrontendProgress,
      );
      this.#onFrontendProgress = null;
    }
    const ms = performance.now() - this.#frontendStart;
    const n = payload?.bundles ?? 0;
    const ok = (payload?.ready ?? 0) > 0;
    const plural = n > 1 ? "s" : "";
    this.#freeze(
      ok,
      this.#mode === "plain"
        ? "frontend"
        : ok
          ? `Frontend (Vite) — ${n} bundle${plural} servi${plural}`
          : "Frontend (Vite) — échec",
      ms,
      ok ? "" : "(voir À regarder)",
    );
    if (this.#finishDeferred) this.#doFinish();
  }

  /** Boot interrompu (`onTerminate`) : marque `✗`, rend la main, déverse les erreurs. */
  #abort(code: number): void {
    if (this.#done) return;
    this.#done = true;
    this.#stopTimer();
    if (this.#muted) {
      this.#freeze(false, this.#label(), performance.now() - this.#phaseStart);
      Syslog.setSinkEnabled(true);
      this.#dumpErrors();
    }
    // code 0 = arrêt volontaire (commande one-shot) → pas une erreur de boot.
    if (code === 0) return;
    if (this.#mode === "json") {
      process.stdout.write(
        `${JSON.stringify({ event: "aborted", phase: this.#label(), code })}\n`,
      );
    } else if (this.#mode === "plain") {
      process.stdout.write(
        `nodefony: aborted phase=${this.#label()} code=${code}\n`,
      );
    } else {
      process.stdout.write(
        `  ${this.#paint(RED, `${this.#symbols.fail} Démarrage interrompu`)} ${this.#paint(DIM, `(code ${code})`)}\n`,
      );
    }
  }

  /**
   * Déverse les ERROR/CRITIC/ALERT/EMERGENCY restés dans le ring buffer pendant
   * que l'écran était coupé — sur la sortie d'ERREUR en JSON, pour ne jamais
   * casser le flux qu'un `| jq` lit.
   */
  #dumpErrors(): void {
    const sys = this.#kernel.syslog;
    if (!sys) return;
    const out = this.#mode === "json" ? process.stderr : process.stdout;
    for (const pdu of sys.ringStack) {
      if (pdu.severity >= 0 && pdu.severity <= 3) {
        const line = pdu.toString();
        out.write(`  ${this.#color ? line : stripVTControlCharacters(line)}\n`);
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
