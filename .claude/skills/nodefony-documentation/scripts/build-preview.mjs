#!/usr/bin/env node
/**
 * Aperçu HTML d'UNE page de documentation — délégué au générateur du SITE.
 *
 * POURQUOI CE FICHIER NE REND PLUS RIEN LUI-MÊME. Il portait son propre moteur
 * de rendu : markdown-it, coloration syntaxique, cartes de catalogue, Mermaid
 * via un navigateur sans interface. Deux conséquences, toutes deux vécues :
 *
 *   1. l'aperçu ne montrait pas ce qui serait PUBLIÉ, puisque le site est rendu
 *      par un autre moteur — relire une page ici ne prouvait donc rien ;
 *   2. il dépendait de `highlight.js`, absent du dépôt : la commande échouait
 *      sur un « module introuvable », et personne ne s'en apercevait tant que
 *      personne ne l'appelait.
 *
 * Un aperçu doit être le rendu réel, sur une seule page. C'est exactement ce que
 * fait `--only`. Ce fichier reste comme point d'entrée documenté et transmet.
 *
 *   node .claude/skills/nodefony-documentation/scripts/build-preview.mjs \
 *     src/packages/@nodefony/security/docs/firewall.md [dossier-de-sortie]
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);
const SRC = process.argv[2];
const OUT = process.argv[3] ?? path.join(REPO, "tmp/doc-work/apercu");

if (!SRC) {
  console.error(
    "usage: node build-preview.mjs <page.md> [dossier-de-sortie]\n" +
      "  <page.md> : chemin relatif au dépôt (ex. docs/guides/configuration.md)",
  );
  process.exit(2);
}

const rel = path.relative(REPO, path.resolve(SRC)).split(path.sep).join("/");
execFileSync(
  process.execPath,
  [path.join(REPO, "scripts/build-docs-site.mjs"), "--out", OUT, "--only", rel],
  { stdio: "inherit", cwd: REPO },
);
