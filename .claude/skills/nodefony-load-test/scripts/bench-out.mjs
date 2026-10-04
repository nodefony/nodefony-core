/**
 * Dossier des sorties de banc, côté JavaScript — miroir de `bench-out.sh`.
 *
 * La règle vit en shell (les bancs A/B sont des scripts bash) ; ce module en
 * porte la seule copie JavaScript, et `bench-out.test.mjs` compare les deux
 * défauts : deux copies d'une règle divergent en silence, chacune passant ses
 * propres tests.
 *
 * @usage import { benchOut } from "./bench-out.mjs"
 * @env NF_BENCH_OUT  dossier des sorties (défaut : <racine du dépôt>/tmp/bench/ab)
 */
import { execFileSync } from "node:child_process";
import path from "node:path";

/**
 * Le dossier où les bancs écrivent médianes, détails, journaux et pid.
 *
 * @param {string} [root] - racine du dépôt ; déduite de git si absente.
 * @returns {string} chemin natif — `NF_BENCH_OUT` s'il est posé.
 */
export function benchOut(root) {
  if (process.env.NF_BENCH_OUT) return process.env.NF_BENCH_OUT;
  const base =
    root ??
    execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: import.meta.dirname,
      encoding: "utf8",
    }).trim();
  return path.join(base, "tmp", "bench", "ab");
}
