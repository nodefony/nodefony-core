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
 * 2. bilan affiché puis {@link GRACE_SECONDS} s sans un octet (règle unique :
 *    `src/nodefony/src/service/dev/turboFreeze.ts`, que le superviseur de dev
 *    emploie aussi) : l'arbre turbo est
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
 * `[turbo] bilan affiché`, on le supprime et les scripts de `package.json`
 * reviennent à `turbo run …` — le garder masquerait le comportement réel.
 *
 * @usage node scripts/repo/turbo.mjs run build [options turbo…]
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
// La SOURCE, pas le barrel `nodefony` : ce lanceur bâtit le `dist` qu'il
// faudrait sinon importer. Node retire les types nativement (`engines` >= 24).
import { signalProcessGroup } from "../../src/nodefony/src/service/dev/devProcess.ts";
// La règle du gel vit dans le PRODUIT (le superviseur de dev l'emploie aussi) :
// une implémentation, deux clients.
import {
  describeTurboFreeze,
  TURBO_FREEZE_GRACE_MS,
  TurboFreezeWatch,
  turboVerbosityArgs,
} from "../../src/nodefony/src/service/dev/turboFreeze.ts";

/** Silence toléré APRÈS le bilan avant de déclarer turbo figé. */
export const GRACE_SECONDS = TURBO_FREEZE_GRACE_MS / 1000;

/** Arrête l'arbre de `child` par l'implémentation unique du cœur. */
function killTree(child) {
  signalProcessGroup(child.pid, "SIGKILL");
}

/** Le shim node de turbo, lancé par `process.execPath` : aucun shell, aucun `.cmd`. */
function defaultCommand() {
  const require = createRequire(import.meta.url);
  return [process.execPath, require.resolve("turbo/bin/turbo")];
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

  // Garde active = journal détaillé, comme sous `CI` (la garde se force aussi
  // hors `CI`, dans les tests) ; l'option précède la sous-commande.
  const child = spawn(file, [...pre, ...turboVerbosityArgs("1"), ...args], {
    stdio: ["ignore", "pipe", "pipe"],
    // Un groupe POSIX à lui : l'arbre se tue d'un seul signal. Sous Windows,
    // `taskkill /T` suit les parents — et `detached` y ouvrirait une console.
    detached: process.platform !== "win32",
    windowsHide: true,
  });

  const watch = new TurboFreezeWatch(Date.now(), graceSeconds * 1000);
  child.stdout.on("data", (c) => {
    process.stdout.write(c);
    watch.stdout(c.toString("utf8"), Date.now());
  });
  child.stderr.on("data", (c) => {
    const shown = watch.stderr(c.toString("utf8"), Date.now());
    if (shown) process.stderr.write(shown);
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
    frozen ??= watch.verdict(Date.now());
    if (frozen) {
      clearInterval(timer);
      killTree(child);
    }
  }, 1000);

  const naturalCode = await exited;
  clearInterval(timer);
  process.off("SIGINT", forward);
  process.off("SIGTERM", forward);
  const rest = watch.flush();
  if (rest) process.stderr.write(rest);

  if (!frozen) {
    if (naturalCode !== 0 && watch.logTail.length > 0) {
      process.stderr.write(
        `\n[turbo.mjs] turbo a échoué (code ${naturalCode}) — fin de son journal détaillé :\n` +
          `${watch.logTail.slice(-20).join("\n")}\n`,
      );
    }
    return naturalCode;
  }

  process.stderr.write(`${describeTurboFreeze(frozen, watch.logTail)}\n`);
  return frozen.code;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const code = await runTurbo(process.argv.slice(2));
  // Sortie EXPLICITE : un tuyau encore tenu garderait sinon le lanceur en vie.
  process.exit(code);
}
