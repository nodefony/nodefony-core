#!/usr/bin/env node
/**
 * Lance turbo pour les scripts du dépôt — et, sous `CI`, lui reprend la main
 * quand il a fini son travail mais ne se termine pas.
 *
 * Le défaut traité (#479, dix jobs Windows perdus en trois jours) : turbo
 * affiche son bilan — « Tasks: 21 successful, 21 total » — puis `turbo.exe` ne
 * rend jamais la main, sans aucun enfant, jusqu'au plafond du job. Ni un process
 * détaché (la sonde `scripts/ci/run-watched.mjs` n'en nomme aucun des nôtres),
 * ni stdin (fermé), ni le daemon (éteint sous `CI`). Le défaut est dans turbo,
 * sous Windows, et ne se corrige pas d'ici.
 *
 * Hors `CI` : turbo est lancé tel quel, sortie héritée — terminal, couleurs et
 * Ctrl+C intacts. Coût nul.
 *
 * Sous `CI` :
 *
 * 1. la sortie transite par ce lanceur, qui y lit le bilan ;
 * 2. bilan affiché puis {@link GRACE_SECONDS} s sans un octet : l'arbre turbo est
 *    arrêté, et le lanceur rend le code que le BILAN annonce — 0 si tout est
 *    `successful`, 1 sinon. La suite d'un `turbo run build && rolldown …`
 *    s'exécute donc normalement ; tuer turbo sans rendre ce code l'aurait coupée ;
 * 3. turbo tourne en mode détaillé (`--verbosity=2`) : ses lignes de journal
 *    sont gardées en mémoire, jamais affichées, sauf au gel — la dernière nomme
 *    l'étape de fermeture où turbo s'est arrêté, de quoi le signaler en amont.
 *
 * Sans bilan, rien n'est jamais tué : une tâche longue et muette reste l'affaire
 * du plafond du job et de la sonde `run-watched`.
 *
 * RETRAIT : ce lanceur n'existe que pour un défaut amont. Quand une montée de
 * turbo passe un mois de CI sans qu'aucun journal Windows ne porte la ligne
 * `[turbo.mjs] bilan affiché`, on le supprime et les scripts de `package.json`
 * reviennent à `turbo run …` — le garder masquerait le comportement réel.
 *
 * @usage node scripts/repo/turbo.mjs run build [options turbo…]
 */
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

/** Silence toléré APRÈS le bilan avant de déclarer turbo figé. Mesuré : turbo sort en ~10 ms. */
export const GRACE_SECONDS = 30;

/** Lignes du journal détaillé gardées pour le rapport de gel. */
const LOG_TAIL = 60;

const ANSI = /\x1b\[[0-9;]*m/gu;

/** Ligne de journal de turbo en mode détaillé : `2026-10-08T07:12:49.635+0200 [DEBUG] crate: …`. */
const TURBO_LOG_LINE =
  /^\d{4}-\d\d-\d\dT[\d:.]+(?:Z|[+-]\d\d:?\d\d) \[(?:TRACE|DEBUG|INFO)\] /u;

/**
 * Lit le bilan de turbo dans une ligne de sa sortie.
 *
 * @param {string} line - une ligne, codes de couleur compris.
 * @returns {{successful:number, total:number} | null} le bilan, ou `null` si la ligne n'en est pas un.
 */
export function parseSummary(line) {
  const m = /Tasks:\s+(\d+) successful, (\d+) total/u.exec(
    line.replace(ANSI, ""),
  );
  return m ? { successful: Number(m[1]), total: Number(m[2]) } : null;
}

/**
 * Dit si une ligne de stderr appartient au journal détaillé de turbo.
 *
 * @param {string} line - une ligne de stderr.
 * @returns {boolean} vrai pour une ligne de journal (gardée, non affichée).
 */
export function isTurboLogLine(line) {
  return TURBO_LOG_LINE.test(line.replace(ANSI, ""));
}

/**
 * Le code de sortie qu'annonce un bilan : celui que turbo aurait rendu.
 *
 * @param {{successful:number, total:number}} summary - le bilan lu.
 * @returns {number} 0 si toutes les tâches ont réussi, 1 sinon.
 */
export function summaryExitCode(summary) {
  return summary.successful === summary.total ? 0 : 1;
}

/**
 * La commande qui emporte un ARBRE sous Windows — même règle que
 * `killTreeCommand` du cœur (`src/nodefony/src/service/dev/devProcess.ts`),
 * qu'un script lancé AVANT tout build ne peut pas importer ; un test compare
 * les deux sorties.
 *
 * @param {number} pid - racine de l'arbre.
 * @param {NodeJS.Platform} platform - `process.platform`, injecté pour l'éprouver partout.
 * @returns {{file:string, args:string[]} | null} le programme, ou `null` quand on passe par le groupe POSIX.
 */
export function treeKillCommand(pid, platform) {
  if (platform !== "win32") return null;
  return { file: "taskkill", args: ["/PID", String(pid), "/T", "/F"] };
}

/** Arrête l'arbre de `child` : `taskkill /T` sous Windows, le groupe POSIX ailleurs. */
function killTree(child) {
  const tree = treeKillCommand(child.pid, process.platform);
  if (tree) {
    spawnSync(tree.file, tree.args, { stdio: "ignore", windowsHide: true });
    return;
  }
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    child.kill("SIGKILL");
  }
}

/** Le shim node de turbo, lancé par `process.execPath` : aucun shell, aucun `.cmd`. */
function defaultCommand() {
  const require = createRequire(import.meta.url);
  return [process.execPath, require.resolve("turbo/bin/turbo")];
}

/** Découpe un flux en lignes ; la dernière, incomplète, attend le paquet suivant. */
function lineSplitter(onLine) {
  let rest = "";
  return {
    push(chunk) {
      const parts = (rest + chunk.toString("utf8")).split(/\r?\n/u);
      rest = parts.pop() ?? "";
      for (const p of parts) onLine(p, true);
    },
    flush() {
      if (rest) onLine(rest, false);
      rest = "";
    },
  };
}

/**
 * Lance turbo et rend son code de sortie — sous garde quand `guarded`.
 *
 * @param {string[]} args - les arguments de turbo (`run build --filter=…`).
 * @param {object} [options]
 * @param {boolean} [options.guarded] - garde active (défaut : `CI` posé).
 * @param {string[]} [options.command] - l'exécutable et ses premiers arguments (défaut : le shim turbo).
 * @param {number} [options.graceSeconds] - silence toléré après le bilan.
 * @returns {Promise<number>} le code de sortie.
 */
export async function runTurbo(args, options = {}) {
  const ci = process.env.CI;
  const {
    guarded = Boolean(ci) && ci !== "false",
    command = defaultCommand(),
    graceSeconds = GRACE_SECONDS,
  } = options;
  const [file, ...pre] = command;

  if (!guarded) {
    const child = spawn(file, [...pre, ...args], { stdio: "inherit" });
    // Ctrl+C atteint tout le groupe : c'est turbo qui s'arrête proprement, le
    // lanceur attend sa sortie au lieu de mourir avant lui.
    const ignore = () => {};
    process.on("SIGINT", ignore);
    const code = await new Promise((resolve) => {
      child.on("exit", (c, signal) => resolve(c ?? (signal ? 1 : 0)));
    });
    process.off("SIGINT", ignore);
    return code;
  }

  // `--verbosity` AVANT la sous-commande : après, un `--` l'enverrait aux tâches.
  const child = spawn(file, [...pre, "--verbosity=2", ...args], {
    stdio: ["ignore", "pipe", "pipe"],
    // Un groupe POSIX à lui : l'arbre se tue d'un seul signal. Sous Windows,
    // `taskkill /T` suit les parents — et `detached` y ouvrirait une console.
    detached: process.platform !== "win32",
    windowsHide: true,
  });

  let last = Date.now();
  let summary = null;
  const logTail = [];

  const out = lineSplitter((line) => {
    summary = parseSummary(line) ?? summary;
  });
  const err = lineSplitter((line, complete) => {
    if (isTurboLogLine(line)) {
      logTail.push(line.replace(ANSI, ""));
      if (logTail.length > LOG_TAIL) logTail.shift();
    } else {
      process.stderr.write(complete ? `${line}\n` : line);
    }
  });
  child.stdout.on("data", (c) => {
    last = Date.now();
    process.stdout.write(c);
    out.push(c);
  });
  child.stderr.on("data", (c) => {
    last = Date.now();
    err.push(c);
  });

  const exited = new Promise((resolve) => {
    child.on("exit", (c, signal) => resolve(c ?? (signal ? 1 : 0)));
  });

  // Arrêt du job (annulation, plafond) : l'arbre détaché ne doit pas survivre au lanceur.
  const forward = () => killTree(child);
  process.on("SIGINT", forward);
  process.on("SIGTERM", forward);

  let frozen = null;
  const timer = setInterval(() => {
    if (summary && !frozen && Date.now() - last > graceSeconds * 1000) {
      frozen = summary;
      killTree(child);
    }
  }, 1000);

  const naturalCode = await exited;
  clearInterval(timer);
  process.off("SIGINT", forward);
  process.off("SIGTERM", forward);
  out.flush();
  err.flush();

  if (!frozen) {
    if (naturalCode !== 0 && logTail.length > 0) {
      process.stderr.write(
        `\n[turbo.mjs] turbo a échoué (code ${naturalCode}) — fin de son journal détaillé :\n` +
          `${logTail.slice(-20).join("\n")}\n`,
      );
    }
    return naturalCode;
  }

  const code = summaryExitCode(frozen);
  process.stderr.write(
    `\n[turbo.mjs] bilan affiché (${frozen.successful}/${frozen.total} réussies) mais turbo ` +
      `ne rend pas la main depuis ${graceSeconds} s — arbre arrêté, code ${code} rendu ` +
      "d'après le bilan (#479). Fin du journal détaillé de turbo — la dernière ligne " +
      "est l'étape où il s'est figé :\n" +
      `${logTail.join("\n")}\n\n`,
  );
  return code;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const code = await runTurbo(process.argv.slice(2));
  // Sortie EXPLICITE : un tuyau encore tenu garderait sinon le lanceur en vie.
  process.exit(code);
}
