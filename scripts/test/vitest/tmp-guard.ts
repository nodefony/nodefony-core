/**
 * Garde des dossiers temporaires d'une passe vitest — le jetable d'un test, le
 * test lui-même le supprime (CLAUDE.md, « le système de fichiers n'est pas un
 * fourre-tout »).
 *
 * Mesuré avant elle : 28 454 entrées et 42 Go dans le dossier temporaire du
 * système, dont plus de 20 000 dossiers `nf-*` laissés par nos suites, revenus à
 * chaque `test:all`. Une règle écrite ne les retenait pas ; celle-ci s'exécute.
 *
 * Le `globalSetup` donne à la passe SON dossier temporaire (`TMPDIR`, `TMP`,
 * `TEMP` — la grammaire POSIX et celle de Windows), hérité par les processus de
 * travail et par tout ce qu'un test lance. Au teardown :
 *
 * - ce qui y reste est NOMMÉ, et la passe échoue — un test qui ne nettoie pas se
 *   voit au premier run, pas au quarantième gigaoctet ;
 * - le dossier est supprimé dans tous les cas : même rouge, une passe ne laisse
 *   rien derrière elle.
 *
 * Un dossier PAR PASSE, et non une photo du dossier commun : turbo lance les
 * suites des paquets en parallèle, et une photo verrait les dossiers de la
 * voisine comme des fuites.
 *
 * @usage globalSetup: tmpGuard()                 // dans test: { … } d'une config vitest
 * @usage globalSetup: tmpGuard(r("./autre.ts"))  // avec un globalSetup propre au paquet
 */
import { mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SELF = fileURLToPath(import.meta.url);
const VARS = ["TMPDIR", "TMP", "TEMP"] as const;

/**
 * Ce que des OUTILS posent dans le dossier temporaire pour eux-mêmes — le cache
 * de compilation de Node, celui de tsx — quand un test lance un processus
 * enfant. Ce n'est pas un jetable de test : il est toléré, et part quand même
 * avec le dossier de la passe.
 */
const TOOL_CACHES = /^(?:node-compile-cache|tsx-[\w.-]+)$/u;

/** Au-delà, un dossier de passe est le reste d'une passe INTERROMPUE. */
const STALE_MS = 24 * 60 * 60 * 1000;

/**
 * Retire les dossiers de passe que leur teardown n'a jamais atteints.
 *
 * Une passe interrompue (Ctrl+C, processus tué) ne passe pas par son teardown,
 * et l'événement `exit` ne part pas sur un signal : vu, un SIGINT laissait son
 * dossier. Ils sont donc balayés au démarrage de la passe SUIVANTE — seulement
 * au-delà de 24 h, pour ne jamais toucher une passe voisine en cours.
 *
 * @param tmp - le dossier temporaire du système.
 */
function sweepStaleRunDirs(tmp: string): void {
  let entries: string[] = [];
  try {
    entries = readdirSync(tmp);
  } catch {
    return;
  }
  const now = Date.now();
  for (const e of entries) {
    if (!e.startsWith("nf-vitest-")) continue;
    const p = path.join(tmp, e);
    try {
      if (now - statSync(p).mtimeMs > STALE_MS)
        rmSync(p, { recursive: true, force: true });
    } catch {
      // disparu entre-temps, ou illisible : rien à balayer
    }
  }
}

/**
 * La liste `globalSetup` d'une config vitest, garde comprise.
 *
 * @param others - les `globalSetup` propres au paquet, dans leur ordre.
 * @returns la garde en tête, puis les autres.
 */
export function tmpGuard(...others: string[]): string[] {
  return [SELF, ...others];
}

/**
 * Pose le dossier temporaire de la passe et rend le teardown qui le contrôle.
 *
 * @returns le teardown : nomme les restes, supprime le dossier, lève s'il en restait.
 * @throws Error au teardown, quand un test a laissé quelque chose derrière lui.
 */
export default function setup(): () => void {
  sweepStaleRunDirs(os.tmpdir());
  const runDir = mkdtempSync(path.join(os.tmpdir(), "nf-vitest-"));
  const saved = VARS.map((v) => [v, process.env[v]] as const);
  for (const v of VARS) process.env[v] = runDir;
  return () => {
    for (const [v, value] of saved) {
      if (value === undefined) delete process.env[v];
      else process.env[v] = value;
    }
    let left: string[] = [];
    try {
      left = readdirSync(runDir)
        .filter((e) => !TOOL_CACHES.test(e))
        .sort();
    } catch {
      return; // déjà supprimé : rien à contrôler
    }
    // Sous Windows un dossier tenu comme répertoire courant ne part pas tout de
    // suite (axiome 7) : les réessais sont une ceinture, l'erreur reste nommée.
    rmSync(runDir, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 200,
    });
    if (left.length > 0) {
      throw new Error(
        `${left.length} entrée(s) laissée(s) dans le dossier temporaire par la passe — ` +
          `un test crée sans supprimer (afterAll → rmSync) :\n` +
          left
            .slice(0, 20)
            .map((e) => `  - ${e}`)
            .join("\n") +
          (left.length > 20 ? `\n  … et ${left.length - 20} autre(s)` : ""),
      );
    }
  };
}
