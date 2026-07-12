import readline from "node:readline";
import type Kernel from "../../kernel/Kernel";
import type { IBootReport, IBootFailure } from "../../kernel/bootReport";
import Syslog from "../../syslog/Syslog";
import {
  discoverDevProcesses,
  splitByProject,
  type DevProcessInfo,
} from "./devProcess";
import { renderProcessTable } from "./devStatusReport";

/** Frames braille du spinner (rotation fluide, 10 étapes). */
const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
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
  /** Vite compile encore (event pont `onFrontendStart` reçu, `onFrontendReady` pas encore). */
  #frontendPending = false;
  /** `performance.now()` au démarrage de la compilation Vite (pour la durée affichée). */
  #frontendStart = 0;
  /** Libellé dynamique de la phase Vite (override `#label()` tant que Vite tourne). */
  #frontendLabel: string | null = null;
  /** `onPostReady` est arrivé pendant la compilation Vite → « ✓ Prêt » en attente. */
  #finishDeferred = false;
  /** Total de bundles Vite (jauge de progression) — posé à `onFrontendStart`. */
  #frontendTotal = 0;
  /** Bundles Vite résolus (ready/échec) — incrémenté à `onFrontendProgress`. */
  #frontendDone = 0;
  /** Handler `onFrontendProgress` (détaché à la fin de la phase Vite). */
  #onFrontendProgress: ((p?: unknown) => void) | null = null;
  /**
   * Résultat final de la compilation Vite (payload `onFrontendReady`) — gardé
   * pour rappeler un échec dans le bloc « Bilan » (la ligne `✗` de la checklist
   * défile et se perd). `null` = pas de frontend ou pas encore fini.
   */
  #frontendResult: IFrontendReadyPayload | null = null;

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
      // Le bloc « ✓ Prêt » liste les URLs → on supprime les bannières serveurs
      // redondantes (« Server Listen on… ») émises à onPostReady. Animé seulement.
      this.#kernel.suppressBootBanners = true;
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
    // Pont frontend (dev-only) : la compilation Vite vit HORS du cycle Kernel
    // (spawn async qui finit après `onPostReady`). `FrontendService` émet ces
    // deux events pour insérer la ligne Vite dans la checklist. Sans frontend,
    // ils ne fire jamais → comportement strictement inchangé. cf idée (a).
    this.#kernel.once("onFrontendStart", (payload?: unknown) =>
      this.#frontendBegin(payload as { bundles?: number }),
    );
    // Progression bundle-par-bundle (jauge de la phase Vite). `.on` (N bundles) →
    // détaché à `#frontendEnd` (pas de listener qui traîne).
    this.#onFrontendProgress = (payload?: unknown) => {
      const p = payload as { ready?: number; total?: number } | undefined;
      if (typeof p?.ready === "number") this.#frontendDone = p.ready;
      if (typeof p?.total === "number") this.#frontendTotal = p.total; // aligne la jauge
      // Non-animé (CI/--debug) : 1 ligne par palier (le timer ne rend pas la jauge).
      if (!this.#animated && this.#frontendTotal > 0) {
        process.stdout.write(
          `  ${CYAN}·${RESET} Frontend (Vite) ${this.#frontendDone}/${this.#frontendTotal}\n`,
        );
      }
    };
    this.#kernel.on("onFrontendProgress", this.#onFrontendProgress);
    this.#kernel.once("onFrontendReady", (payload?: unknown) =>
      this.#frontendEnd(payload as IFrontendReadyPayload),
    );
  }

  /** Libellé de la phase courante (ou « Finalisation » au-delà des phases connues). */
  #label(): string {
    if (this.#frontendLabel) return this.#frontendLabel;
    return PHASES[this.#phaseIndex]?.label ?? "Finalisation";
  }

  /** Réécrit la ligne courante : jauge Vite (X of Y) en phase frontend, sinon spinner. */
  #render(): void {
    this.#frame = (this.#frame + 1) % FRAMES.length;
    readline.clearLine(process.stdout, 0);
    readline.cursorTo(process.stdout, 0);
    // Phase Vite = N bundles en PARALLÈLE → barre de progression (le bon pattern :
    // total connu + process simultanés). Le spinner braille reste en tête (montre
    // que ça vit ; la barre montre où ça en est).
    if (this.#frontendPending && this.#frontendTotal > 0) {
      process.stdout.write(
        `  ${CYAN}${FRAMES[this.#frame]}${RESET} Frontend (Vite)  ` +
          `${this.#bar(this.#frontendDone, this.#frontendTotal)}  ` +
          `${DIM}${this.#frontendDone}/${this.#frontendTotal} bundles${RESET}`,
      );
      return;
    }
    process.stdout.write(
      `  ${CYAN}${FRAMES[this.#frame]}${RESET} ${this.#label()}${DIM}…${RESET}`,
    );
  }

  /** Barre `▰▰▰▱▱` proportionnelle (vert rempli / dim vide), largeur fixe 14. */
  #bar(done: number, total: number): string {
    const width = 14;
    const filled =
      total > 0 ? Math.min(width, Math.round((done / total) * width)) : 0;
    return (
      `${GREEN}${"▰".repeat(filled)}${RESET}` +
      `${DIM}${"▱".repeat(width - filled)}${RESET}`
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
    this.#renderPhaseDetail(label);
    this.#phaseStart = now;
    this.#phaseIndex++;
  }

  /**
   * Lignes de détail SOUS une phase qui vient de se figer — pour que le boot
   * RACONTE ce qui se passe (pas une phase muette). Deux sources :
   * - le canal NEUTRE `Kernel.getBootLines(phase)` que tout module alimente
   *   (`reportBootLine` — ex. ORM : « drizzle → sqlite »), le core restant
   *   agnostique ;
   * - un digest intégré pour `Modules` (liste lisible, dérivée du Kernel).
   */
  #renderPhaseDetail(label: string): void {
    let lines = this.#kernel.getBootLines(label);
    if (label === "Modules" && lines.length === 0) {
      lines = this.#moduleDigest();
    }
    for (const line of lines) {
      process.stdout.write(`       ${DIM}${line}${RESET}\n`);
    }
  }

  /**
   * Digest lisible des modules chargés (noms courts, ~6 par ligne) affiché sous
   * la phase « Modules ». Donne au dev la composition réelle de son app d'un
   * coup d'œil.
   */
  #moduleDigest(): string[] {
    const names = Object.keys(this.#kernel.modules).map((m) =>
      m.replace(/^@nodefony\//, ""),
    );
    if (!names.length) return [];
    const out: string[] = [];
    for (let i = 0; i < names.length; i += 8) {
      out.push(names.slice(i, i + 8).join(" · "));
    }
    return out;
  }

  /**
   * Boot complet (`onPostReady`). Si Vite compile encore (`#frontendPending`), on
   * DIFFÈRE le récap final jusqu'à `onFrontendReady` : sinon « ✓ Prêt » s'afficherait
   * avant la ligne Vite. On GARDE le spinner animé sur « Frontend (Vite)… » et le
   * sink RESTE muté → le dev voit la progression, pas le mur de logs de build (Vite
   * + `Server Listen…`) qui partent au buffer/backplane (visibles en `--debug`).
   */
  #finish(): void {
    if (this.#done) return;
    if (this.#frontendPending) {
      // Le spinner continue de tourner (timer actif, sink muté → 0 conflit `\r`).
      // `onFrontendReady` figera la ligne Vite puis déclenchera le « ✓ Prêt ».
      this.#finishDeferred = true;
      return;
    }
    this.#doFinish();
  }

  /**
   * Récap final + rend la main au Syslog (idempotent sur le sink). Le verdict
   * écran vient du {@link Kernel.getBootReport} (vérité unique) :
   * - sain → bloc « Prêt » : identité + serveurs HTTP|WS (URLs cliquables),
   * - dégradé (modules ignorés, serveurs up) → + lignes `⚠`,
   * - **garde-fou 0-serveur** → bloc `⛔` non silencieux + action corrective.
   */
  #doFinish(): void {
    if (this.#done) return;
    this.#done = true;
    this.#stopTimer();
    if (this.#animated) Syslog.setSinkEnabled(true);
    const dt = ((performance.now() - this.#bootStart) / 1000).toFixed(2);
    const report = this.#kernel.getBootReport();
    if (!report.healthy && report.serversExpected) {
      this.#renderBootFailure(report, dt);
      return;
    }
    this.#renderReady(report, dt);
    if (report.modulesSkipped.length) {
      this.#renderSkipped(report.modulesSkipped);
    }
    process.stdout.write("\n");
  }

  /**
   * Récap « prêt » : chaque serveur sur sa ligne, `➜  LABEL  url` (label aligné,
   * URL cliquable cyan) — mise en avant des 4 points d'entrée (HTTP, HTTP/2, WS,
   * WSS : le différenciateur Nodefony HTTP + WebSocket co-citoyens). L'identité
   * (version · env · pid) est déjà posée par `Kernel.printDevHeader` en TÊTE.
   */
  #renderReady(report: IBootReport, dt: string): void {
    process.stdout.write(
      `\n  ${GREEN}${BOLD}✓  Prêt${RESET} ${DIM}en ${dt}s${RESET}\n\n`,
    );
    // Serveurs — ordre figé + libellés parlants (https ⇒ HTTP/2, wss ⇒ WSS).
    const rows: ReadonlyArray<readonly [string, string]> = [
      ["http", "HTTP"],
      ["https", "HTTP/2"],
      ["ws", "WS"],
      ["wss", "WSS"],
    ];
    process.stdout.write(`     ${DIM}Serveurs${RESET}\n`);
    for (const [scheme, label] of rows) {
      const url = report.serversListening.find((s) => s.scheme === scheme)?.url;
      if (!url) continue;
      process.stdout.write(
        `     ${GREEN}➜${RESET}  ${BOLD}${label.padEnd(9)}${RESET}` +
          `${CYAN}${url}${RESET}\n`,
      );
    }
    // Frontend (Vite, dev) — un bundle = une URL HMR cliquable (ce que le dev
    // ouvre en premier). Alimenté par `FrontendService` (reportBootLine).
    this.#renderSection("Frontend (Vite)", "Frontend (Vite)");
    // Studio (admin web) — si le module est chargé : son URL directe (souvent
    // oubliée), dérivée de l'URL HTTPS (repli HTTP) du serveur.
    if (this.#kernel.modules["studio"]) {
      const adminUrl =
        report.serversListening.find((s) => s.scheme === "https")?.url ??
        report.serversListening.find((s) => s.scheme === "http")?.url;
      if (adminUrl) {
        process.stdout.write(`\n     ${DIM}Studio${RESET}\n`);
        process.stdout.write(
          `     ${GREEN}➜${RESET}  ${BOLD}${"Admin".padEnd(9)}${RESET}` +
            `${CYAN}${adminUrl}/nodefony${RESET}\n`,
        );
      }
    }
    // Données (ORM) — détail différé, posé à `onServersReady` (registre peuplé) :
    // les ORM se connectent aux hooks `onReady` des services, trop tard pour un
    // affichage inline sous la phase « Services & ORM ».
    this.#renderSection("Données", "Services & ORM");
    this.#renderVerdict(report);
  }

  /**
   * Bloc « Bilan » du verdict — le « développeur rassuré » : composition réelle du
   * boot (modules chargés / ignorés par gating AVEC la raison / échecs fail-soft),
   * rappel d'un échec Vite (la ligne `✗` de la checklist défile et se perd), et
   * journal du boot (compteurs WARNING/ERROR du ring syslog). Tout vient du
   * {@link IBootReport} (vérité unique — le futur endpoint Studio lira la même).
   */
  #renderVerdict(report: IBootReport): void {
    process.stdout.write(`\n     ${DIM}Bilan${RESET}\n`);
    const loaded = report.modulesLoaded.length;
    const gated = report.modulesGated.length;
    const failed = report.modulesSkipped.length;
    let modules = `${loaded} module${loaded > 1 ? "s" : ""}`;
    if (gated) {
      modules +=
        ` ${DIM}·${RESET} ${YELLOW}${gated} ignoré${gated > 1 ? "s" : ""}${RESET}` +
        ` ${DIM}(policy/when)${RESET}`;
    }
    if (failed) {
      modules += ` ${DIM}·${RESET} ${RED}${failed} échec${failed > 1 ? "s" : ""}${RESET}`;
    }
    this.#verdictRow("Modules", modules);
    for (const g of report.modulesGated) {
      process.stdout.write(
        `        ${DIM}· ${g.module} — ${g.reason}${RESET}\n`,
      );
    }
    if (
      this.#frontendResult &&
      (this.#frontendResult.ready ?? 0) === 0 &&
      (this.#frontendResult.bundles ?? 0) > 0
    ) {
      this.#verdictRow(
        "Vite",
        `${RED}✗ compilation échouée${RESET} ${DIM}(voir logs)${RESET}`,
      );
    }
    this.#renderProcessRow();
    const journal =
      !report.warnings && !report.errors
        ? `${GREEN}aucun warning${RESET}`
        : [
            report.errors ? `${RED}${report.errors} ERROR${RESET}` : "",
            report.warnings
              ? `${YELLOW}${report.warnings} WARNING${RESET}`
              : "",
          ]
            .filter(Boolean)
            .join(` ${DIM}·${RESET} `) + ` ${DIM}(détail : --debug)${RESET}`;
    this.#verdictRow("Journal", journal);
  }

  /** Ligne du bilan `➜  LABEL  valeur` (même gabarit que les lignes serveurs). */
  #verdictRow(label: string, value: string): void {
    process.stdout.write(
      `     ${GREEN}➜${RESET}  ${BOLD}${label.padEnd(9)}${RESET}${value}\n`,
    );
  }

  /**
   * Ligne « Process » du bilan — topologie runtime réelle (superviseur / serveur /
   * Vite avec pid + RSS), MÊME source d'observation que `nodefony status`
   * (`discoverDevProcesses`, ps sans IPC), scopée à CE projet (`splitByProject` —
   * un runtime d'un autre dossier ne pollue pas le bilan). Best-effort : `ps`
   * indisponible (Windows) ou vide → aucune ligne. Sync, 1× au boot, dev-only.
   * Les ports ne sont PAS re-sondés ici : la section « Serveurs » du verdict est
   * déjà la vérité interne (une liste sondée serait une convention — vécu 3×).
   */
  #renderProcessRow(): void {
    let procs: readonly DevProcessInfo[] = [];
    try {
      procs = splitByProject(
        discoverDevProcesses({ includeSelf: true }),
        this.#kernel.path,
      ).mine;
    } catch {
      return; // observation best-effort — jamais bloquer le verdict
    }
    if (!procs.length) return;
    const roles: ReadonlyArray<readonly [string, string]> = [
      ["supervisor", "superviseur"],
      ["master", "master"],
      ["server", "serveur"],
      ["worker", "worker"],
      ["vite", "Vite"],
    ];
    const parts: string[] = [];
    for (const [role, label] of roles) {
      const n = procs.filter((p) => p.role === role).length;
      if (n) parts.push(`${n} ${label}${n > 1 && role !== "vite" ? "s" : ""}`);
    }
    this.#verdictRow("Process", parts.join(` ${DIM}·${RESET} `));
    // Détail = LE tableau de `nodefony status` (gabarit partagé
    // renderProcessTable — même topologie, même sérieux), indenté sous la
    // ligne `➜` du bilan.
    const table: string[] = [];
    renderProcessTable(table, procs, "        ");
    process.stdout.write(table.join("\n") + "\n");
  }

  /**
   * Section « titre » + lignes `➜ valeur` (cyan, cliquable) lues du canal neutre
   * de boot (`Kernel.getBootLines`). No-op si la phase n'a poussé aucune ligne.
   */
  #renderSection(title: string, phase: string): void {
    const lines = this.#kernel.getBootLines(phase);
    if (!lines.length) return;
    process.stdout.write(`\n     ${DIM}${title}${RESET}\n`);
    for (const line of lines) {
      process.stdout.write(`     ${GREEN}➜${RESET}  ${CYAN}${line}${RESET}\n`);
    }
  }

  /**
   * Bloc ⛔ **non silencieux** : un profil serveur a fini sans aucun serveur en
   * écoute. Liste les modules en cause + l'action corrective. Le process va
   * s'arrêter (le Kernel a déjà décidé `terminate(EX_UNAVAILABLE)`).
   */
  #renderBootFailure(report: IBootReport, dt: string): void {
    process.stdout.write(
      `\n  ${RED}⛔ Aucun serveur n'a démarré${RESET} ` +
        `${DIM}(boot en ${dt}s — le process va s'arrêter)${RESET}\n`,
    );
    for (const f of report.modulesSkipped) {
      process.stdout.write(
        `     ${RED}✗${RESET} ${f.module} ${DIM}— ${f.reason}${RESET}\n`,
      );
    }
    if (report.remediation) {
      process.stdout.write(`     ${CYAN}→ ${report.remediation}${RESET}\n`);
    }
    process.stdout.write("\n");
  }

  /** Lignes ⚠ des modules en échec fail-soft (boot dégradé mais serveurs en écoute). */
  #renderSkipped(skipped: IBootFailure[]): void {
    const m = skipped.length;
    process.stdout.write(
      `  ${YELLOW}⚠ ${m} module${m > 1 ? "s" : ""} en échec (fail-soft)${RESET}\n`,
    );
    for (const f of skipped) {
      process.stdout.write(
        `     ${YELLOW}·${RESET} ${f.module} ${DIM}— ${f.reason}${RESET}\n`,
      );
    }
  }

  /** Vite a commencé à compiler (`onFrontendStart`) — ouvre la phase Vite dynamique. */
  #frontendBegin(payload?: { bundles?: number }): void {
    if (this.#done) return;
    this.#frontendPending = true;
    this.#frontendStart = performance.now();
    // En animé, le spinner courant (« Finalisation… ») bascule sur ce libellé.
    this.#frontendLabel = "Frontend (Vite)";
    this.#frontendTotal = payload?.bundles ?? 0; // total connu → jauge possible
    this.#frontendDone = 0;
  }

  /**
   * Vite a fini ou échoué (`onFrontendReady`) : fige la ligne Vite (`✓`/`✗` + durée
   * + bundles servis), puis débloque le « ✓ Prêt » si `onPostReady` l'attendait.
   */
  #frontendEnd(payload: IFrontendReadyPayload): void {
    if (this.#done || !this.#frontendPending) return;
    this.#frontendPending = false;
    this.#frontendResult = payload ?? null;
    this.#frontendLabel = null; // libère le spinner s'il anime encore
    // Détache le listener de progression (plus de bundle à compter) — pas de
    // listener qui traîne (règle perf-mémoire du projet).
    if (this.#onFrontendProgress) {
      this.#kernel.removeListener(
        "onFrontendProgress",
        this.#onFrontendProgress,
      );
      this.#onFrontendProgress = null;
    }
    const ms = performance.now() - this.#frontendStart;
    const n = payload?.bundles ?? 0;
    if ((payload?.ready ?? 0) > 0) {
      const plural = n > 1 ? "s" : "";
      const names = payload?.names?.length
        ? ` ${DIM}(${payload.names.join(", ")})${RESET}`
        : "";
      this.#freeze(
        `${GREEN}✓${RESET}`,
        `Frontend (Vite) — ${n} bundle${plural} servi${plural}${names}`,
        ms,
      );
    } else {
      this.#freeze(
        `${RED}✗${RESET}`,
        `Frontend (Vite) — échec ${DIM}(voir logs)${RESET}`,
        ms,
      );
    }
    if (this.#finishDeferred) this.#doFinish();
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
