/**
 * `doctor` hors réseau, pour TOUTE la passe : la liste des publications de Node
 * qu'il lit est un fichier posé ici, une fois.
 *
 * La sous-règle « Sécurité de Node » lit la liste officielle sur nodejs.org. Une
 * suite ne doit dépendre ni du réseau ni de la date du jour : on lui donne une
 * liste où le Node courant est à jour. Les tests de la règle elle-même injectent
 * leur propre liste. Un `NF_NODE_DIST_URL` déjà posé gagne.
 *
 * Un `globalSetup` et non le fichier de setup de chaque test : là, il fallait le
 * supprimer en `afterAll`, que vitest n'exécute pas pour un fichier dont tous les
 * tests sont sautés — en forge, faute d'infrastructure, le fichier restait.
 * Placé APRÈS `tmpGuard` : posé dans le dossier temporaire de la passe, retiré
 * avant que la garde ne contrôle (les teardowns s'exécutent à rebours).
 *
 * @usage globalSetup: tmpGuard(r("./src/tests/nodeDist.global.ts"))
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Pose la liste et rend le teardown qui la retire.
 *
 * @returns le teardown, ou rien quand `NF_NODE_DIST_URL` était déjà posé.
 */
export default function setup(): (() => void) | undefined {
  if (process.env["NF_NODE_DIST_URL"]) return undefined;
  const fixture = path.join(os.tmpdir(), "nf-node-dist.json");
  fs.writeFileSync(
    fixture,
    JSON.stringify([
      { version: process.version, date: "2026-01-01", security: false },
    ]),
  );
  process.env["NF_NODE_DIST_URL"] = fixture;
  return () => {
    fs.rmSync(fixture, { force: true });
    delete process.env["NF_NODE_DIST_URL"];
  };
}
