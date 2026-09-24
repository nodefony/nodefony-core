#!/usr/bin/env node
/**
 * Verrou « un run long occupe l'arbre » — seule implémentation, trois lecteurs.
 *
 * Une passe `test:all` dure des dizaines de minutes et lit l'arbre de travail
 * tout du long : bâtir, puis tester ce qui a été bâti. Éditer `src/` pendant ce
 * temps ne casse rien de visible — la passe rend un verdict sur un mélange
 * d'avant et d'après, que personne ne peut plus rejouer. Vécu deux fois : deux
 * campagnes invalidées, découvertes au rapport.
 *
 * Le run long POSE le verrou (`acquire`) et le retire en sortant (`release`).
 * Le pre-commit et le garde d'édition de l'agent le LISENT (`holder`) : ils
 * refusent tant qu'il est tenu, en nommant qui le tient et depuis quand.
 *
 * Il ne doit JAMAIS bloquer par surprise — trois filets, chacun suffisant :
 * - processus MORT (run tué, machine redémarrée) : ignoré. La vivacité se
 *   CONSTATE par le signal 0, portable sur les trois plateformes ;
 * - verrou plus vieux que {@link MAX_AGE_MS} : ignoré, même si le pid vit —
 *   un pid se RECYCLE, et aucune passe ne dure quatre heures ;
 * - sortie de secours NOMMÉE dans chaque refus : `clear` retire le verrou.
 * Un verrou orphelin qui interdirait d'éditer serait pire que pas de verrou :
 * on finirait par le supprimer à la main sans le lire.
 *
 * CLI :
 *   node scripts/long-run-lock.mjs check   # 0 libre · 1 tenu (message sur stderr)
 *   node scripts/long-run-lock.mjs clear   # retire le verrou, quel qu'en soit le porteur
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/** Au-delà, le verrou ne compte plus : aucune passe ne dure autant, un pid si. */
export const MAX_AGE_MS = 4 * 60 * 60 * 1000;

/** Emplacement du verrou — sous `tmp/`, ignoré par git. */
export const LOCK_FILE = path.join(ROOT, "tmp", "long-run.lock");

/**
 * Le processus existe-t-il encore ? Constaté, jamais déduit.
 *
 * `EPERM` veut dire « il existe, mais pas à moi » : il est vivant.
 *
 * @param {number} pid
 * @returns {boolean}
 */
function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return /** @type {NodeJS.ErrnoException} */ (error).code === "EPERM";
  }
}

/**
 * Pose le verrou pour le processus courant.
 *
 * @param {string} label - ce que fait le run (« test:all --mongo »), affiché aux refus.
 * @param {string} [file] - emplacement (les tests en passent un temporaire).
 */
export function acquire(label, file = LOCK_FILE) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(
    file,
    JSON.stringify({
      pid: process.pid,
      label,
      since: new Date().toISOString(),
    }),
    "utf8",
  );
}

/**
 * Retire le verrou — seulement s'il est à NOUS : un second run lancé à côté ne
 * doit pas effacer celui du premier en se terminant.
 *
 * @param {string} [file]
 */
export function release(file = LOCK_FILE) {
  const held = read(file);
  if (held && held.pid === process.pid) rmSync(file, { force: true });
}

/**
 * @param {string} file
 * @returns {{ pid: number, label: string, since: string } | null}
 */
function read(file) {
  if (!existsSync(file)) return null;
  try {
    const lock = JSON.parse(readFileSync(file, "utf8"));
    return typeof lock?.pid === "number" ? lock : null;
  } catch {
    return null;
  }
}

/**
 * Qui tient le verrou — ou `null` s'il est libre, orphelin ou trop vieux.
 *
 * @param {string} [file]
 * @param {number} [now] - horloge injectable (tests).
 * @returns {{ pid: number, label: string, since: string } | null}
 */
export function holder(file = LOCK_FILE, now = Date.now()) {
  const lock = read(file);
  if (!lock || !isAlive(lock.pid)) return null;
  const since = Date.parse(lock.since);
  if (!Number.isFinite(since) || now - since > MAX_AGE_MS) return null;
  return lock;
}

/**
 * Le message de refus, identique pour tous les lecteurs.
 *
 * @param {{ pid: number, label: string, since: string }} lock
 * @returns {string}
 */
export function refusal(lock) {
  return (
    `Un run long occupe l'arbre : « ${lock.label} » (pid ${lock.pid}, depuis ${lock.since}). ` +
    `Modifier les sources maintenant rendrait son verdict invérifiable. ` +
    `Attendre sa fin, ou l'arrêter (le verrou tombe avec lui). ` +
    `Si ce run n'existe plus pour toi : node scripts/long-run-lock.mjs clear`
  );
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const command = process.argv[2];
  if (command === "clear") {
    rmSync(LOCK_FILE, { force: true });
    process.exit(0);
  }
  if (command !== "check") {
    process.stderr.write(
      "usage : node scripts/long-run-lock.mjs check|clear\n",
    );
    process.exit(64);
  }
  const lock = holder();
  if (lock) {
    process.stderr.write(`${refusal(lock)}\n`);
    process.exit(1);
  }
}
