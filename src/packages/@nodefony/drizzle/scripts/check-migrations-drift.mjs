#!/usr/bin/env node
/**
 * Contrôle de dérive : le schéma des entités a-t-il bougé sans qu'on regénère ?
 *
 * La méthode naïve — régénérer un `0000` complet et le comparer au fichier
 * versionné — cesse d'être juste dès la deuxième migration : le `0000` ne décrit
 * plus le schéma courant, mais son état initial. Le contrôle travaille donc comme
 * l'outil lui-même : il copie les INSTANTANÉS existants dans un dossier de
 * travail, demande une génération, et **refuse qu'un fichier apparaisse**. Un
 * `.sql` produit signifie exactement « les entités décrivent autre chose que ce
 * que les migrations construisent ».
 *
 * Rien n'est écrit dans le dépôt : le dossier de travail vit sous
 * `node_modules/.cache`, et il est effacé même en cas d'échec.
 *
 * Usage : `npm run check:migrations` (code 0 = aligné, 1 = dérive).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DIALECTS, MODULE_ROOT, runGenerate } from "./drizzleKit.mjs";

/**
 * Rejoue la génération d'un dialecte à côté, sans rien écrire dans le dépôt.
 *
 * ⚠️ Le dossier de sortie ne peut pas être ABSOLU : `drizzle-kit` le préfixe par
 * `./`, fabrique `.//Users/…`, échoue à lire les instantanés — **et rend 0**. Le
 * chemin est donc relatif à la racine du module, en séparateurs POSIX.
 *
 * @param dialect - dialecte contrôlé.
 * @param workRel - dossier de travail, RELATIF à la racine du module.
 * @returns les noms de fichiers `.sql` que la génération aurait ajoutés.
 * @throws Error si la sortie ne prouve pas que la génération a eu lieu.
 */
function pendingFiles(dialect, workRel) {
  const outRel = `${workRel}/${dialect}`;
  const outAbs = path.join(MODULE_ROOT, ...outRel.split("/"));
  const meta = path.join(MODULE_ROOT, "migrations", dialect, "meta");
  fs.mkdirSync(outAbs, { recursive: true });
  if (fs.existsSync(meta)) {
    fs.cpSync(meta, path.join(outAbs, "meta"), { recursive: true });
  }

  // La configuration versionnée est reprise TELLE QUELLE, sa seule sortie
  // redirigée : le contrôle exerce ainsi exactement le schéma et le dialecte que
  // la génération utilise. Une configuration réécrite de zéro dériverait de
  // celle qu'elle prétend contrôler.
  const configPath = path.join(
    MODULE_ROOT,
    "drizzle-kit",
    `${dialect}.config.ts`,
  );
  const outLine = `out: "./migrations/${dialect}"`;
  const original = fs.readFileSync(configPath, "utf8");
  if (!original.includes(outLine)) {
    throw new Error(
      `Impossible de rediriger la sortie de drizzle-kit/${dialect}.config.ts : ` +
        `la ligne \`${outLine}\` n'y figure plus. Ce contrôle serait devenu ` +
        `incapable de mesurer quoi que ce soit — le réparer, pas le contourner.`,
    );
  }
  const configRel = `${workRel}/${dialect}.config.ts`;
  fs.writeFileSync(
    path.join(MODULE_ROOT, ...configRel.split("/")),
    original.replace(outLine, `out: "./${outRel}"`),
  );

  runGenerate({ configRel, name: "drift_probe", label: dialect });

  return fs
    .readdirSync(outAbs)
    .filter((name) => name.endsWith(".sql"))
    .sort();
}

/** Point d'entrée. */
function main() {
  // Le dossier de travail vit SOUS le module, pas dans le temporaire du système :
  // la configuration écrite là importe `defineConfig`, et un fichier hors de
  // l'arborescence ne résout pas `drizzle-kit`. C'est le canal déjà utilisé par
  // le verrou du superviseur — ignoré par git, éphémère.
  const cacheRel = "node_modules/.cache/nodefony";
  const cacheAbs = path.join(MODULE_ROOT, ...cacheRel.split("/"));
  fs.mkdirSync(cacheAbs, { recursive: true });
  const workAbs = fs.mkdtempSync(path.join(cacheAbs, "migrations-drift-"));
  const workRel = `${cacheRel}/${path.basename(workAbs)}`;

  const drifted = [];
  try {
    for (const dialect of DIALECTS) {
      const pending = pendingFiles(dialect, workRel);
      if (pending.length > 0) {
        drifted.push({ dialect, pending });
      }
    }
  } finally {
    fs.rmSync(workAbs, { recursive: true, force: true });
  }

  if (drifted.length === 0) {
    process.stdout.write(
      `✅ Migrations alignées sur les entités (${DIALECTS.join(", ")}).\n`,
    );
    return;
  }
  const detail = drifted
    .map((d) => `  • ${d.dialect} : ${d.pending.join(", ")}`)
    .join("\n");
  process.stderr.write(
    `\n❌ DÉRIVE — le schéma des entités a changé sans regénération.\n` +
      `Une migration serait produite sur :\n${detail}\n\n` +
      `Regénérer les TROIS dialectes ensemble :\n` +
      `  npm run generate:migrations -- --name <nom_du_changement>\n`,
  );
  process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`\n❌ ${(error && error.message) || error}\n`);
    process.exitCode = 1;
  }
}
