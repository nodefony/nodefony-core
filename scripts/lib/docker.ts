/**
 * Verdicts sur les conteneurs d'infra du dépôt — sans le moindre effet de bord.
 *
 * Pourquoi un module à part plutôt qu'un `export` dans `test-all.ts` : ce
 * dernier est un SCRIPT, pas une bibliothèque. Son corps s'exécute à l'import —
 * démarrage de l'infra, build, batterie complète. L'importer pour récupérer une
 * seule fonction déclenchait donc toute la batterie de tests, et ce depuis un
 * outil qui ne demandait qu'à savoir si un conteneur répondait.
 *
 * La règle vaut au-delà de ce cas : une fonction qu'on veut partager se sort du
 * script AVANT d'être importée. Sinon « réutiliser » revient à « relancer ».
 */
import { spawnSync } from "node:child_process";

/**
 * Le conteneur `nodefony-<name>` tourne-t-il ET est-il sain ?
 *
 * Un conteneur « started » n'est pas un serveur prêt : PostgreSQL rejoue son
 * WAL, Mongo initie son jeu de répliques. Quand une sonde de santé existe, c'est
 * elle qui fait foi ; sinon, tourner suffit.
 *
 * @param name - nom court du service (`postgres`, `redis`…), sans le préfixe
 * @returns `false` dès que Docker est absent, le conteneur inconnu, ou la santé
 *          autre que `healthy` — jamais une exception, l'absence d'infra étant
 *          un cas NORMAL qu'un appelant doit pouvoir constater.
 */
export function containerHealthy(name: string): boolean {
  const res = spawnSync(
    "docker",
    [
      "inspect",
      "-f",
      "{{.State.Running}} {{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}",
      `nodefony-${name}`,
    ],
    { encoding: "utf8" },
  );
  if (res.status !== 0) return false;
  const [running, health] = res.stdout.trim().split(" ");
  if (running !== "true") return false;
  return health === "healthy" || health === "none";
}
