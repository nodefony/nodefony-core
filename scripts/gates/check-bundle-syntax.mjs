/**
 * Gate : chaque fichier JavaScript d'un bundle de front BÂTI doit être lisible par V8.
 *
 * Pourquoi : un bundler peut produire du code invalide sans échouer — vécu sur
 * #802, où Vite bâtissait avec une version de rolldown hors de sa plage
 * déclarée. Le build sortait vert, `test:all` aussi (19 000 tests), et la page
 * de connexion de Studio ne montait plus : « SyntaxError: missing ) after
 * argument list ». Seul un navigateur réel l'a vu. Ce gate le voit sur le
 * commit qui le provoque, sans navigateur.
 *
 * Ce qu'il fait, et pourquoi ainsi :
 *
 * - **L'artefact BÂTI, pas les sources** : `<…>/dist/frontend/**` (Studio,
 *   démo) et `<…>/public/dist/**` (fronts des modules), là où les builds de
 *   front écrivent.
 * - **V8 juge, pas un autre parseur** : `node --check` sur chaque fichier. C'est
 *   le moteur du navigateur qui a refusé le code ; un parseur tiers pourrait
 *   l'accepter. Node détecte seul l'ESM d'un `.js` (Node ≥ 22.7).
 * - **Zéro fichier trouvé = ÉCHEC** : un gate qui ne lit rien ne prouve rien.
 *   `--allow-empty` l'admet quand c'est voulu.
 *
 * @example
 * ```bash
 * npm run build && npm run build:front && npm run check:bundles
 * npm run check:bundles -- src/packages/@nodefony/studio/dist/frontend
 * ```
 *
 * @usage npm run check:bundles
 * @usage npm run check:bundles -- <dossier> [<dossier>…] [--allow-empty]
 */
import { readdirSync, existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { availableParallelism } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

/** Dossiers jamais parcourus : dépendances, VCS, scratch du dépôt. */
const SKIPPED_DIRS = new Set(["node_modules", ".git", "tmp", ".turbo"]);

/**
 * Dit si un dossier (chemin relatif, n'importe quel séparateur) est la sortie d'un build de front.
 *
 * @param relPath - chemin relatif à la racine parcourue
 * @returns vrai pour `…/dist/frontend` et `…/public/dist`
 */
export function isBundleDir(relPath) {
  // Normaliser AVANT de comparer (axiome 2) : sous Windows le chemin arrive en `\`.
  const p = relPath.replaceAll("\\", "/").replace(/\/+$/, "");
  return /(^|\/)dist\/frontend$/.test(p) || /(^|\/)public\/dist$/.test(p);
}

/**
 * Liste les fichiers `.js`/`.mjs` sous un dossier, récursivement.
 *
 * @param dir - dossier absolu
 * @returns chemins absolus
 */
export function listScripts(dir) {
  const out = [];
  for (const entry of readdirSync(dir, {
    withFileTypes: true,
    recursive: true,
  })) {
    if (entry.isFile() && /\.m?js$/.test(entry.name))
      out.push(path.join(entry.parentPath, entry.name));
  }
  return out;
}

/**
 * Trouve les dossiers de bundles de front sous une racine.
 *
 * @param root - racine absolue du parcours
 * @returns dossiers absolus, triés
 */
export function findBundleDirs(root) {
  const found = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory() || SKIPPED_DIRS.has(entry.name)) continue;
      const abs = path.join(dir, entry.name);
      if (isBundleDir(path.relative(root, abs))) found.push(abs);
      else walk(abs);
    }
  };
  walk(root);
  return found.sort();
}

/**
 * Passe un fichier à `node --check` (V8).
 *
 * @param file - chemin absolu
 * @returns `null` si le fichier est lisible, sinon la première ligne d'erreur de V8
 */
export function checkSyntax(file) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--check", file], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (code) => {
      if (code === 0) return resolve(null);
      const line = stderr.split("\n").find((l) => l.includes("Error"));
      resolve(line?.trim() ?? `node --check a rendu le code ${code}`);
    });
  });
}

/**
 * Vérifie une liste de fichiers, en parallèle borné au nombre de cœurs.
 *
 * @param files - chemins absolus
 * @param check - vérificateur (injecté par les tests)
 * @returns les fichiers refusés, avec leur erreur
 */
export async function checkAll(files, check = checkSyntax) {
  const failures = [];
  let next = 0;
  const worker = async () => {
    while (next < files.length) {
      const file = files[next++];
      const error = await check(file);
      if (error !== null) failures.push({ file, error });
    }
  };
  await Promise.all(
    Array.from(
      { length: Math.min(availableParallelism(), files.length) },
      worker,
    ),
  );
  return failures.sort((a, b) => a.file.localeCompare(b.file));
}

async function main() {
  const args = process.argv.slice(2);
  const allowEmpty = args.includes("--allow-empty");
  const given = args
    .filter((a) => !a.startsWith("--"))
    .map((a) => path.resolve(a));
  const dirs = given.length ? given : findBundleDirs(ROOT);
  const missing = dirs.filter((d) => !existsSync(d));
  if (missing.length) {
    console.error(`✗ dossier introuvable : ${missing.join(", ")}`);
    process.exit(2);
  }
  const files = dirs.flatMap(listScripts);
  if (files.length === 0) {
    if (allowEmpty) {
      console.log("✓ aucun bundle de front à vérifier (--allow-empty).");
      return;
    }
    console.error(
      "✗ aucun bundle de front trouvé — ce gate n'a rien lu, il ne prouve donc rien.\n" +
        "  Bâtir d'abord : npm run build && npm run build:front",
    );
    process.exit(1);
  }
  const failures = await checkAll(files);
  for (const dir of dirs) {
    const n = files.filter((f) => f.startsWith(dir + path.sep)).length;
    console.log(`  ${path.relative(ROOT, dir)} — ${n} fichier(s)`);
  }
  if (failures.length) {
    for (const { file, error } of failures)
      console.error(`✗ ${path.relative(ROOT, file)} : ${error}`);
    console.error(
      `\n${failures.length} fichier(s) illisible(s) par V8 sur ${files.length}. ` +
        "Le bundler a produit du code invalide : vérifier sa version contre la plage qu'exige l'outil qui l'appelle (npm ls rolldown).",
    );
    process.exit(1);
  }
  console.log(`✓ ${files.length} fichier(s) de bundle lisibles par V8.`);
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await main();
