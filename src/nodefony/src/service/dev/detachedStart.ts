import {
  openSync,
  closeSync,
  mkdirSync,
  readFileSync,
  writeSync,
} from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import https from "node:https";
import http from "node:http";
import { SysExit } from "../../cli/sysexits";
import {
  clearRuntimeState,
  defaultDevPorts,
  discoverDevProcesses,
  probePorts,
  readRuntimeState,
  signalProcessGroup,
  splitByProject,
  formatForeignRuntimes,
  type PortState,
} from "./devProcess";

/**
 * Lancement DÉTACHÉ d'un runtime Nodefony (`nodefony development --detach`) —
 * absorbe l'expérience du script `start.sh` du skill dans le framework :
 * spawn détaché + attente de readiness + health check + code de sortie sémantique.
 *
 * Pur outillage de process (spawn + sonde ports + log file) : AUCUN boot kernel dans
 * le process appelant → exécuté par le fast-path standalone de `CliKernel.start`
 * (même famille que `status`/`stop`). Le kill préalable n'est PAS dupliqué ici :
 * le child le porte nativement (`#claimSingleInstance` dev balaie les résiduels ;
 * prod/cluster refuse fail-loud un runtime concurrent).
 *
 * Fail-fast SANS heuristique fragile : contrairement au script (détection « log figé
 * 20 s » → faux TIMEOUT pendant un rebuild turbo légitime), on n'observe que des
 * signaux SÛRS — process mort (exit code) OU plafond global dépassé. Un boot lent
 * qui rebuilde reste un boot sain tant que le process vit.
 */

/** Options du détacheur, parsées d'argv (cf {@link parseDetachArgs}). */
export interface DetachedStartOptions {
  /** Ligne de spawn complète — injectable pour les tests. */
  spawnCmd: string;
  spawnArgs: string[];
  /** Répertoire de travail du child (défaut `process.cwd()`). */
  cwd?: string;
  /** Fichier de log du runtime détaché (stdout+stderr du child). */
  logFile: string;
  /** Plafond d'attente de readiness en secondes (défaut 120). */
  waitSec?: number;
  /** Ports dont l'écoute signe la readiness (défaut `defaultDevPorts()`). */
  ports?: number[];
  /** Path d'un GET de santé post-listen (best-effort, jamais bloquant). */
  healthPath?: string;
  /** Callback de progression (une ligne ~toutes les 5 s). */
  onProgress?: (msg: string) => void;
  /** Variables d'env additionnelles pour le child. */
  env?: Record<string, string>;
}

/** Résultat du lancement détaché. */
export interface DetachedStartResult {
  ok: boolean;
  /** PID du process détaché (leader de groupe), `null` si le spawn a échoué. */
  pid: number | null;
  /** Code de sortie sémantique pour le process appelant (sysexits). */
  exitCode: number;
  /** État final des ports sondés. */
  ports: PortState[];
  logFile: string;
  /** Résultat du health check (`"200"`, `"skipped (…)"`), absent si non demandé. */
  health?: string;
  /** Cause de l'échec (`ok: false`) — diagnostic humain. */
  reason?: string;
  /** Dernières lignes du log (strip ANSI) pour le diagnostic d'échec. */
  logTail?: string[];
}

/** Options des flags détacheur reconnues dans argv. */
export interface ParsedDetachArgs {
  detach: boolean;
  waitSec: number;
  healthPath?: string;
  logFile?: string;
  /** argv à relayer au child (flags détacheur STRIPPÉS — anti-récursion). */
  relayArgs: string[];
}

/** Marqueur env anti-récursion : posé sur le child pour couper tout re-détachement. */
export const DETACH_CHILD_ENV = "NODEFONY_DETACH_CHILD";

/** Fenêtre de tick de la boucle d'attente (ms). */
const TICK_MS = 500;

/** Nombre de lignes de log remontées au diagnostic d'échec. */
const TAIL_LINES = 10;

/**
 * Parse les flags du détacheur depuis argv (après node + bin) et STRIP ces flags
 * des args relayés au child — un `--detach` relayé re-détacherait à l'infini.
 * Fonction PURE (testable sans process).
 *
 * @param args - `process.argv.slice(2)`.
 */
export function parseDetachArgs(args: string[]): ParsedDetachArgs {
  const relayArgs: string[] = [];
  let detach = false;
  let waitSec = 120;
  let healthPath: string | undefined;
  let logFile: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--detach") {
      detach = true;
    } else if (a === "--wait" || a.startsWith("--wait=")) {
      const v = a.includes("=") ? a.split("=")[1] : args[++i];
      const n = Number.parseInt(v ?? "", 10);
      if (Number.isInteger(n) && n > 0) waitSec = n;
    } else if (a === "--health" || a.startsWith("--health=")) {
      healthPath = a.includes("=") ? a.split("=")[1] : args[++i];
    } else if (a === "--log" || a.startsWith("--log=")) {
      logFile = a.includes("=") ? a.split("=")[1] : args[++i];
    } else {
      relayArgs.push(a);
    }
  }
  return { detach, waitSec, healthPath, logFile, relayArgs };
}

/** `true` si l'invocation demande un lancement détaché (et n'est PAS déjà le child). */
export function isDetachRequested(args: string[]): boolean {
  return args.includes("--detach") && process.env[DETACH_CHILD_ENV] !== "1";
}

/** Dernières lignes non vides d'un fichier de log, ANSI strippé (diagnostic). */
function tailLog(logFile: string, n = TAIL_LINES): string[] {
  try {
    return readFileSync(logFile, "utf8")
      .replace(/\x1b\[[0-9;]*m/g, "")
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .slice(-n);
  } catch {
    return [];
  }
}

/** Dernière ligne de phase du DevSupervisor (`[dev] …`) pour la progression. */
function lastPhaseLine(logFile: string): string {
  const lines = tailLog(logFile, 40).filter((l) => l.startsWith("[dev]"));
  return lines.length > 0 ? lines[lines.length - 1].slice(0, 70) : "";
}

/**
 * GET de santé best-effort après readiness des ports : https insecure sur le DERNIER
 * port (convention dev : TLS), fallback http sur le premier. 2 tentatives (le watch
 * peut occuper l'event loop juste après le boot) — n'échoue JAMAIS le lancement :
 * les ports écoutent déjà, un health raté = information, pas un verdict.
 */
function probeHealth(ports: number[], healthPath: string): Promise<string> {
  const tlsPort = ports[ports.length - 1];
  const plainPort = ports[0];
  const attempt = (
    useTls: boolean,
    tries: number,
    resolve: (v: string) => void,
  ): void => {
    const mod = useTls ? https : http;
    const req = mod.request(
      {
        hostname: "127.0.0.1",
        port: useTls ? tlsPort : plainPort,
        path: healthPath,
        rejectUnauthorized: false,
        timeout: 4000,
      },
      (res) => {
        res.resume();
        resolve(String(res.statusCode));
        req.destroy();
      },
    );
    const retry = (why: string): void => {
      if (useTls) {
        attempt(false, tries, resolve); // fallback http (serveur non-TLS)
      } else if (tries > 1) {
        setTimeout(() => attempt(true, tries - 1, resolve), 1500);
      } else {
        resolve(`skipped (${why}) — servers listen OK`);
      }
    };
    req.on("error", (e: NodeJS.ErrnoException) => {
      if (e.code !== "ECONNRESET") retry(`ERR ${e.code}`);
    });
    req.on("timeout", () => {
      req.destroy();
      retry("TIMEOUT");
    });
    req.end();
  };
  return new Promise((resolve) => attempt(true, 2, resolve));
}

/**
 * Spawn le runtime détaché puis attend sa readiness (AU MOINS UN port en écoute).
 *
 * « Au moins un » et pas « tous » : la liste de ports est une CONVENTION du parent
 * (défaut `[5151, 5152]`), pas la topologie réelle de l'app — une app `https: false`
 * n'ouvrira JAMAIS 5152 et un « tous » l'attendrait à vie (faux négatif, vécu).
 * L'état COMPLET port par port reste dans `ports` du résultat (fail-loud : un port
 * attendu fermé est VISIBLE dans le récap, il ne bloque juste pas la readiness).
 *
 * Signaux d'échec (fail-fast, cf en-tête du module) :
 * - le child MEURT avant la readiness → `EX_UNAVAILABLE` + exit code du child + tail log ;
 * - plafond `waitSec` dépassé → group-kill du child (pas de runtime zombie à moitié
 *   booté) + `EX_UNAVAILABLE` + tail log.
 *
 * @returns résultat structuré — l'appelant décide du rendu et du `process.exit`.
 */
export async function launchDetached(
  opts: DetachedStartOptions,
): Promise<DetachedStartResult> {
  const ports = opts.ports ?? defaultDevPorts();
  const waitSec = opts.waitSec ?? 120;
  const logFile = path.resolve(opts.cwd ?? process.cwd(), opts.logFile);
  const progress = opts.onProgress ?? (() => {});

  // ─── Pre-flight : ports LIBRES avant spawn ────────────────────────────────
  // La readiness = « ports en écoute » sans notion de propriétaire : un runtime
  // préexistant sur ces ports rendrait un FAUX READY (vécu : le child refuse via
  // son garde single-instance et meurt, la sonde voit les ports du VIEUX serveur
  // et sort UP). Refuser AVANT de spawner — même verdict que le garde du child,
  // mais côté parent, avec le bon exit code.
  const cwd = opts.cwd ?? process.cwd();
  const preflight = await probePorts(ports);
  const busy = preflight.filter((p) => p.listening);
  // `foreignBusy` : les ports pris ne le sont PAS par nous. Depuis
  // `servers.portPolicy: "auto"`, ce n'est plus un motif de refus — l'enfant
  // glissera sur des ports libres et les publiera. En revanche la readiness ne
  // doit alors JAMAIS se fier à une sonde de port : elle verrait le serveur du
  // voisin écouter et sortirait un FAUX READY.
  let foreignBusy = false;
  if (busy.length > 0) {
    // QUI occupe ? Nommer le PROJET occupant (multi-app sur un poste de dev) :
    // le dev sait immédiatement où agir — jamais un « port pris » sans réponse.
    let mineRunning = false;
    let who = "";
    try {
      const { mine, foreign } = splitByProject(discoverDevProcesses(), cwd);
      mineRunning = mine.length > 0;
      if (foreign.length > 0) {
        who =
          " — occupés par un AUTRE projet Nodefony :\n" +
          formatForeignRuntimes(foreign).join("\n");
      }
    } catch {
      /* introspection best-effort — le verdict ci-dessous ne dépend que de `mine` */
    }
    if (mineRunning) {
      // CE projet tourne déjà : c'est un vrai doublon, et aucun repli de port ne
      // le rendra légitime (single-instance). Refus, comme avant.
      return {
        ok: false,
        pid: null,
        exitCode: SysExit.UNAVAILABLE,
        ports: preflight,
        logFile,
        reason:
          `port(s) déjà en écoute : ${busy.map((p) => p.port).join(", ")} — ` +
          `un runtime de CE projet tourne déjà (nodefony status · nodefony stop)`,
      };
    }
    foreignBusy = true;
    progress(
      `ports ${busy.map((p) => p.port).join(", ")} déjà pris${who}\n` +
        `   → cette app prendra les premiers ports libres (servers.portPolicy: "auto")`,
    );
  }
  // Le state file d'un run précédent ne doit pas signer la readiness du nôtre.
  clearRuntimeState(cwd);

  // Standalone : aucun Kernel n'a garanti `tmp/` ici (contrairement au boot) —
  // le dossier du log peut ne pas exister sur un checkout/pod frais.
  mkdirSync(path.dirname(logFile), { recursive: true });
  const out = openSync(logFile, "w");
  const child = spawn(opts.spawnCmd, opts.spawnArgs, {
    cwd: opts.cwd ?? process.cwd(),
    stdio: ["ignore", out, out],
    detached: true,
    env: { ...process.env, ...opts.env, [DETACH_CHILD_ENV]: "1" },
  });
  // Le fd parent est dupliqué dans le child au spawn → on referme le nôtre (sinon
  // fuite d'un fd par lancement dans le process appelant). Une seule fois, quel
  // que soit l'event qui arrive (spawn OU error de spawn).
  let fdClosed = false;
  const closeFd = (): void => {
    if (!fdClosed) {
      fdClosed = true;
      closeSync(out);
    }
  };
  child.once("spawn", closeFd);
  child.once("error", closeFd);
  child.unref();

  let exited = false;
  let exitCode: number | null = null;
  child.once("exit", (code) => {
    exited = true;
    exitCode = code;
  });
  child.once("error", () => {
    exited = true;
  });

  const ticks = Math.ceil((waitSec * 1000) / TICK_MS);
  // Ports RÉELLEMENT sondés : ceux du state file dès que l'enfant l'a publié
  // (seule source exacte si un repli a décalé l'écoute), la convention sinon.
  let watched = ports;
  for (let i = 1; i <= ticks; i++) {
    if (exited) {
      return {
        ok: false,
        pid: child.pid ?? null,
        exitCode: SysExit.UNAVAILABLE,
        ports: await probePorts(watched),
        logFile,
        reason: `process mort avant la readiness (exit ${exitCode ?? "?"})`,
        logTail: tailLog(logFile),
      };
    }
    // L'enfant a-t-il publié sa topologie ? (Il le fait dès que ses serveurs
    // écoutent.) On ne se fie qu'à un state file dont le process est VIVANT.
    const state = readRuntimeState(cwd);
    const published = state !== null && state.ports.length > 0;
    if (published) watched = state.ports;
    const states = await probePorts(watched);
    const up = states.filter((p) => p.listening).length;
    // Un port qui écoute ne prouve rien tant qu'un AUTRE projet en tient : ce
    // serait SON serveur qu'on verrait. Dans ce cas la readiness EXIGE le state
    // file (la seule preuve que c'est bien NOTRE enfant qui répond).
    const trustworthy = published || !foreignBusy;
    // `!exited` re-vérifié APRÈS la sonde : des ports up + un child mort entre
    // les deux checks = jamais un READY (ceinture du pre-flight ci-dessus).
    if (up > 0 && trustworthy && !exited) {
      const health = opts.healthPath
        ? await probeHealth(watched, opts.healthPath)
        : undefined;
      return {
        ok: true,
        pid: child.pid ?? null,
        exitCode: SysExit.OK,
        ports: states,
        logFile,
        health,
      };
    }
    // Progression ~toutes les 5 s, avec la phase courante du superviseur si visible.
    if (i % 10 === 0) {
      const phase = lastPhaseLine(logFile);
      const elapsed = Math.round((i * TICK_MS) / 1000);
      progress(
        `booting (${up}/${watched.length} ports, ${elapsed}s)${phase ? ` — ${phase}` : ""}`,
      );
    }
    await new Promise((r) => setTimeout(r, TICK_MS));
  }

  // Plafond dépassé : pas de runtime zombie à moitié booté — group-kill (le child est
  // leader de groupe `detached` → tue aussi ses enfants serveur/Vite).
  if (child.pid) {
    try {
      signalProcessGroup(child.pid, "SIGKILL");
    } catch {
      /* déjà mort */
    }
  }
  return {
    ok: false,
    pid: child.pid ?? null,
    exitCode: SysExit.UNAVAILABLE,
    ports: await probePorts(ports),
    logFile,
    reason: `readiness non atteinte après ${waitSec}s — runtime tué (group-kill)`,
    logTail: tailLog(logFile),
  };
}

/**
 * Point d'entrée du fast-path standalone (`CliKernel.start`) : parse argv, lance le
 * runtime détaché, rend le rapport sur stdout et retourne le code de sortie.
 *
 * @param argv - `process.argv` complet (node + bin + args).
 * @returns code de sortie sémantique (`EX_OK` / `EX_UNAVAILABLE` / `EX_USAGE`).
 */
export async function runDetachedStart(argv: string[]): Promise<number> {
  const parsed = parseDetachArgs(argv.slice(2));
  if (parsed.relayArgs.length === 0) {
    writeSync(1, "--detach exige une commande de runtime (ex: development)\n");
    return SysExit.USAGE;
  }
  const cwd = process.cwd();
  const logFile =
    parsed.logFile ?? path.join(cwd, "tmp", "nodefony-detached.log");
  const say = (msg: string): void => {
    writeSync(1, `>>> ${msg}\n`);
  };

  say(`SPAWN nodefony ${parsed.relayArgs.join(" ")} (detached)`);
  const result = await launchDetached({
    spawnCmd: process.execPath,
    spawnArgs: [argv[1], ...parsed.relayArgs],
    cwd,
    logFile,
    waitSec: parsed.waitSec,
    healthPath: parsed.healthPath,
    onProgress: (m) => say(`... ${m}`),
  });

  if (!result.ok) {
    say(`FATAL — ${result.reason}`);
    for (const line of result.logTail ?? []) writeSync(1, `  ${line}\n`);
    say(`log complet : ${result.logFile}`);
    return result.exitCode;
  }
  // N'afficher que les ports RÉELLEMENT en écoute — la liste sondée est une
  // convention (5151/5152) : annoncer « 5152 en écoute » sur une app
  // https:false serait un mensonge (vécu : confusion « qui a ouvert 5152 ? »).
  const portsUp = result.ports
    .filter((p) => p.listening)
    .map((p) => p.port)
    .join(" | ");
  say(`READY — ports en écoute : ${portsUp}`);
  if (result.health !== undefined) say(`HEALTH ${result.health}`);
  say(`UP — PID=${result.pid} | log : ${result.logFile}`);
  say(`arrêt : nodefony stop · état : nodefony status`);
  return result.exitCode;
}
