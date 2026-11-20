/**
 * La sonde de rechargement de `CliIntegration`, retirée à la FIN de la passe.
 *
 * Le cas « Ctrl+C pendant un rechargement » doit déclencher un VRAI build : il
 * écrit un `.ts` neuf dans une feuille (`@nodefony/documentation`), ce qui change
 * son empreinte turbo et réveille le superviseur. Ce fichier est donc, pendant
 * la passe, une source du dépôt comme une autre — et une soixantaine de bancs
 * balayent `src/` en parallèle (gardes de typage, de JSON-RPC, de surface…).
 *
 * Retirée dans le `finally` du cas, la sonde disparaissait ENTRE le moment où un
 * balayeur listait le dossier et celui où il lisait le fichier : `ENOENT`, un
 * rouge qui n'appartenait à personne (vécu en CI macOS sur
 * `jsonrpcSingleSource`, après `clientSurfaceExercised`). Corriger chaque
 * balayeur couvrait le cas vu, pas la famille : c'est l'ÉCRIVAIN qui ne retire
 * plus rien pendant la passe. La sonde reste en place jusqu'au teardown global,
 * qui tourne après le dernier fichier de test.
 *
 * @usage globalSetup: tmpGuard(r("./src/tests/reloadProbe.global.ts"))
 */
import { readdirSync, rmSync } from "node:fs";
import path from "node:path";

/** Le dossier de la feuille où la sonde est écrite. */
export const RELOAD_PROBE_DIR = path.resolve(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "packages",
  "@nodefony",
  "documentation",
  "nodefony",
);

const PROBE_NAME = /^reloadProbe\d+\.ts$/;

/**
 * Le chemin de la sonde d'un process de test.
 *
 * @param pid - le process qui l'écrit (deux passes simultanées ne se marchent pas dessus)
 * @returns le chemin absolu du fichier sonde
 */
export function reloadProbePath(pid: number): string {
  return path.join(RELOAD_PROBE_DIR, `reloadProbe${pid}.ts`);
}

/** Le `dist` de la feuille, où le cas rebâtit la sonde (`.js`, `.d.ts`…). */
const PROBE_DIST_DIR = path.join(RELOAD_PROBE_DIR, "..", "dist");

/** Une sortie bâtie de la sonde, quelle que soit son extension. */
const PROBE_OUTPUT = /^reloadProbe\d+\./;

/**
 * Retire toutes les sondes présentes — celles d'une passe interrompue
 * comprises — ET leurs sorties bâties : le cas rebâtit la feuille AVANT ce
 * teardown, sonde comprise, et un `reloadProbe<pid>.d.ts` restait dans son
 * `dist` jusqu'au prochain vrai build (revue #796, R3).
 */
function removeProbes(): void {
  let names: string[];
  try {
    names = readdirSync(RELOAD_PROBE_DIR);
  } catch {
    return;
  }
  for (const name of names) {
    if (PROBE_NAME.test(name)) {
      rmSync(path.join(RELOAD_PROBE_DIR, name), { force: true });
    }
  }
  let built: string[];
  try {
    built = readdirSync(PROBE_DIST_DIR, { recursive: true, encoding: "utf8" });
  } catch {
    return;
  }
  for (const rel of built) {
    if (PROBE_OUTPUT.test(path.basename(rel))) {
      rmSync(path.join(PROBE_DIST_DIR, rel), { force: true });
    }
  }
}

/**
 * Nettoie les restes d'une passe interrompue, puis rend le teardown qui retire
 * la sonde une fois TOUS les fichiers de test terminés.
 *
 * @returns le teardown global
 */
export default function setup(): () => void {
  removeProbes();
  return removeProbes;
}
