/**
 * Met en forme ce que le scaffold produit, avec le prettier DU PROJET.
 *
 * Pourquoi c'est ici et pas dans les gabarits : la forme canonique d'une ligne
 * dépend souvent d'un identifiant que l'UTILISATEUR choisit.
 * `export type ReportingMensuelConfigInput = z.input<…>` fait 87 colonnes ;
 * le même gabarit nommé `blog` tient sous 80. Un gabarit rend UNE forme, donc
 * aucune écriture de gabarit ne peut être juste pour tous les noms — ce n'est
 * pas un cas particulier, c'est la règle, puisque presque tout ce qu'un
 * générateur produit porte un nom dérivé. Mesuré : une application avec tous
 * les générateurs rendait 16 fichiers que son propre `npm run format`
 * réécrivait au premier passage.
 *
 * Le coût qui avait fait écarter cette solution — embarquer prettier dans le
 * CLI, ~8 Mo dans chaque image de production — n'existe pas : l'application
 * générée a DÉJÀ prettier en dépendance de développement. On emprunte le sien,
 * et on ne fait rien s'il est absent.
 *
 * Trois règles, chacune tenant à une raison précise :
 *
 * 1. **Une CRÉATION est formatée, une RÉÉCRITURE seulement si le fichier
 *    suivait déjà prettier.** Une réécriture touche du code que l'utilisateur a
 *    écrit ; reformater en entier un fichier qui a son propre style produirait
 *    un diff énorme et lui imposerait notre convention. `format(avant) ===
 *    avant` répond exactement à « ce projet suit-il prettier ? ».
 * 2. **Le formatage a lieu AVANT que le plan soit calculé**, jamais au vidage
 *    de la transaction : sinon `--dry-run` annoncerait une forme que
 *    l'exécution ne produirait pas. Une option dont le seul rôle est de dire ce
 *    qui va se passer ne peut pas mentir.
 * 3. **Un échec ne bloque jamais une génération.** Prettier absent, illisible,
 *    ou qui refuse un fichier : on écrit le contenu tel quel. La mise en forme
 *    est un confort, pas une garantie.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import type { ScaffoldWriter } from "./writer.js";

/**
 * Extensions confiées à prettier. Volontairement restreinte à ce que le dépôt
 * formate lui-même : une extension exotique (`.svelte`, `.vue`) demanderait un
 * plugin que le projet n'a pas forcément, et prettier échouerait fichier par
 * fichier pour rien.
 */
const FORMATABLES = new Set([
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".mjs",
  ".cjs",
  ".jsx",
  ".json",
  ".jsonc",
  ".md",
  ".css",
  ".scss",
  ".html",
  ".yml",
  ".yaml",
]);

/** Ce que la mise en forme a fait — matière du récapitulatif du CLI. */
export interface IFormatOutcome {
  /** Fichiers effectivement remis en forme. */
  formatted: number;
  /**
   * Fichiers formatables qu'on a laissés tels quels faute de prettier. Zéro
   * quand il n'y avait rien à formater : le CLI ne parle que si ça compte.
   */
  pending: number;
}

/**
 * Le prettier du PROJET, cherché en remontant depuis le dossier visé.
 *
 * On vise le paquet, pas le binaire : il sera importé dans le worker, ce qui
 * évite un démarrage de Node par fichier.
 *
 * @param from - dossier de départ (la destination du scaffold).
 * @returns l'URL du module prettier, ou `null` s'il n'est pas installé.
 */
function resolvePrettier(from: string): string | null {
  let dir = path.resolve(from);
  for (;;) {
    const candidate = path.join(dir, "node_modules", "prettier", "index.cjs");
    if (existsSync(candidate)) {
      return pathToFileURL(candidate).href;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return null;
    }
    dir = parent;
  }
}

/**
 * Le worker : un SEUL processus Node pour tous les fichiers.
 *
 * L'API de prettier v3 est asynchrone, et `runScaffold` est synchrone — trois
 * fronts l'appellent (CLI rapide, CLI interactif, Studio), les rendre
 * asynchrones pour une question de mise en forme serait un prix hors de
 * proportion. Un `spawnSync` unique concilie les deux : l'attente est portée
 * par le processus fils, qui charge prettier une fois et formate tout.
 *
 * Formater par `spawnSync` fichier par fichier coûterait un démarrage de Node
 * à chaque fois — environ 200 ms × 40 fichiers pour une application neuve.
 */
const WORKER = `
let input = "";
process.stdin.on("data", (c) => (input += c));
process.stdin.on("end", async () => {
  const { url, files } = JSON.parse(input);
  let prettier;
  try {
    prettier = await import(url);
  } catch {
    process.stdout.write("{}");
    return;
  }
  const format = prettier.format ?? prettier.default?.format;
  if (typeof format !== "function") {
    process.stdout.write("{}");
    return;
  }
  const output = {};
  for (const f of files) {
    try {
      // Un fichier qui n'était PAS conforme avant ne se voit pas reformater :
      // c'est le style du projet, pas le nôtre.
      if (f.previous !== null && f.previous !== undefined) {
        const before = await format(f.previous, { filepath: f.path });
        if (before !== f.previous) continue;
      }
      const after = await format(f.content, { filepath: f.path });
      if (after !== f.content) output[f.path] = after;
    } catch {
      // Un fichier que prettier refuse reste tel quel — jamais une génération
      // perdue pour une question de forme.
    }
  }
  process.stdout.write(JSON.stringify(output));
});
`;

/**
 * Met en forme des fichiers DÉJÀ ÉCRITS, nommés un par un.
 *
 * La seconde porte, pour le seul cas que la transaction ne peut pas servir :
 * `create app` écrit ses fichiers AVANT `npm install`, donc au moment du rendu
 * le projet n'a aucun prettier à prêter. On repasse après l'installation.
 *
 * 🔴 **La liste est celle des fichiers que le scaffold a ÉCRITS, jamais un
 * dossier.** Passer `.` à prettier reformaterait le projet ENTIER — le code que
 * l'utilisateur a écrit compris, avec un diff qui déborde très loin de ce qu'on
 * vient de générer. Un générateur met en forme ce qu'il produit, rien d'autre.
 *
 * Le prettier du projet est chargé comme MODULE, jamais lancé comme binaire :
 * sous Windows le binaire est un `.cmd`, et depuis le correctif de
 * CVE-2024-27980 Node refuse d'exécuter un `.cmd` sans `shell: true` (`EINVAL`).
 * Passer par un shell demanderait ensuite d'échapper un chemin qui contient
 * couramment des espaces. Le module n'a aucun de ces deux problèmes.
 *
 * @param files - chemins ABSOLUS des fichiers écrits par le scaffold.
 * @param dest - dossier du projet, point de départ de la recherche de prettier.
 * @returns ce qui a été mis en forme, et ce qui attend faute de prettier.
 */
export function formatFilesOnDisk(
  files: string[],
  dest: string,
): IFormatOutcome {
  const candidates = files.filter(
    (f) => FORMATABLES.has(path.extname(f)) && existsSync(f),
  );
  if (candidates.length === 0) {
    return { formatted: 0, pending: 0 };
  }
  const url = resolvePrettier(dest);
  if (!url) {
    return { formatted: 0, pending: candidates.length };
  }
  // `previous: null` : ces fichiers viennent d'être générés, ils sont à nous.
  // La garde « ne pas reformater ce qui ne suivait pas prettier » protège le
  // code de l'utilisateur ; ici il n'y en a pas.
  const payload = candidates.map((f) => ({
    path: f,
    content: readFileSync(f, "utf8"),
    previous: null,
  }));
  const results = startWorker(url, payload);
  if (!results) {
    return { formatted: 0, pending: candidates.length };
  }
  let formatted = 0;
  for (const [file, content] of Object.entries(results)) {
    writeFileSync(file, content);
    formatted += 1;
  }
  return { formatted, pending: 0 };
}

/**
 * Lance le worker et rend ce qu'il a changé, ou `null` si rien n'est
 * exploitable. Un seul endroit à corriger pour les deux portes.
 */
function startWorker(
  url: string,
  files: { path: string; content: string; previous: string | null }[],
): Record<string, string> | null {
  const run = spawnSync(process.execPath, ["-e", WORKER], {
    input: JSON.stringify({ url, files }),
    encoding: "utf8",
    // Une application complète tient largement dedans ; au-delà, on écrit sans
    // mise en forme plutôt que de faire tomber la génération.
    maxBuffer: 64 * 1024 * 1024,
  });
  if (run.status !== 0 || !run.stdout) {
    return null;
  }
  try {
    return JSON.parse(run.stdout) as Record<string, string>;
  } catch {
    return null;
  }
}

/**
 * Met en forme les écritures en attente, dans la transaction.
 *
 * Appelée par {@link runScaffold} AVANT la bifurcation dry-run / vidage, pour
 * que le plan annoncé et le résultat écrit soient le même texte.
 *
 * @param writer - la transaction du scaffold racine.
 * @param dest - dossier visé, point de départ de la recherche de prettier.
 * @returns ce qui a été mis en forme, et ce qui attend faute de prettier.
 */
export function formatScaffoldOutput(
  writer: ScaffoldWriter,
  dest: string,
): IFormatOutcome {
  const candidates = writer
    .changes()
    .filter((c) => FORMATABLES.has(path.extname(c.path)));
  if (candidates.length === 0) {
    return { formatted: 0, pending: 0 };
  }

  const url = resolvePrettier(dest);
  if (!url) {
    return { formatted: 0, pending: candidates.length };
  }

  const files = candidates.map((c) => ({
    path: c.path,
    content: c.content,
    previous: c.kind === "overwrite" ? (c.previous ?? null) : null,
  }));

  const results = startWorker(url, files);
  if (!results) {
    return { formatted: 0, pending: candidates.length };
  }

  let formatted = 0;
  for (const [file, content] of Object.entries(results)) {
    writer.write(file, content);
    formatted += 1;
  }
  return { formatted, pending: 0 };
}
