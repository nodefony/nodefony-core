/**
 * Le graphe symbolique du dépôt, garanti avant la passe du cœur.
 *
 * Il est GÉNÉRÉ, jamais versionné : sur un poste, les hooks git le régénèrent
 * après chaque commit, merge ou checkout. Mais un clone NEUF n'a encore exécuté
 * aucun hook (ils sont branchés par `npm install`, après le clone), et un runner
 * de forge n'en a pas : `npm test` y échouait sur les outils `symbols` du
 * serveur MCP (« aucun graphe symbolique atteignable »). Le consommateur pose
 * donc son prérequis — une fois, et seulement s'il manque : quelques secondes
 * sur un clone neuf, rien ailleurs.
 *
 * @usage globalSetup: tmpGuard(r("./src/tests/symbolsGraph.global.ts"))
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

/**
 * Génère `.ai/symbols.json` (et la copie publiée du cœur) s'il manque.
 *
 * @throws Error si la génération échoue — la passe ne mesurerait plus rien.
 */
export default function setup(): void {
  const root = path.resolve(import.meta.dirname, "..", "..", "..", "..");
  const graphs = [
    path.join(root, ".ai", "symbols.json"),
    path.join(root, "src", "nodefony", ".ai", "symbols.json"),
  ];
  if (graphs.every((g) => existsSync(g))) return;
  // tsx lancé par le Node courant : ni `npm`, ni shell — `npm.cmd` sous Windows
  // exigerait l'un ou l'autre.
  const tsx = createRequire(path.join(root, "package.json")).resolve("tsx/cli");
  const r = spawnSync(
    process.execPath,
    [tsx, path.join("scripts", "generate", "generate-symbols.ts")],
    { cwd: root, encoding: "utf8" },
  );
  if (r.status !== 0 || !graphs.every((g) => existsSync(g))) {
    throw new Error(
      `graphe symbolique introuvable et non généré (code ${r.status}) — ` +
        `lancer \`npm run generate-symbols\` à la racine.\n${r.stderr ?? ""}`,
    );
  }
}
