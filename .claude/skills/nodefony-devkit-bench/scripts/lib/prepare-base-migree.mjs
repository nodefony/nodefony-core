/**
 * Décor de la tâche « faire suivre une base DÉJÀ en place » — une application
 * dont la base existe au schéma PRÉCÉDENT, avec son historique et une donnée
 * qu'on n'a pas le droit de perdre.
 *
 * **Pourquoi ce décor est le seul qui mesure quelque chose.** Par défaut, une
 * application en développement rattrape toute seule une colonne ajoutée qui
 * accepte le vide : l'agent n'aurait rien à faire, et la tâche serait verte sans
 * qu'aucune migration n'existe. Le connecteur est donc posé en mode `none` — le
 * mode de PRODUCTION, où le démarrage ne fabrique jamais de schéma. À partir de
 * là, une colonne neuve n'apparaît QUE par une migration appliquée.
 *
 * La ligne semée est l'autre moitié du décor : elle transforme « il ne faut pas
 * supprimer la base » d'une consigne en un FAIT mesurable. Un agent qui efface
 * et recrée obtient une base au bon schéma — et le juge le voit quand même,
 * parce que la ligne a disparu.
 *
 * Le script échoue FORT si une ancre manque : mieux vaut une tâche non jouée
 * qu'une tâche jugée sur un décor à moitié posé — l'agent porterait le rouge
 * d'un trou qu'il n'a pas laissé.
 *
 * Éprouvable seul :
 *   node prepare-base-migree.mjs --selftest
 *
 * @module
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/** L'entité que l'agent devra faire évoluer. */
export const ENTITE = "Article";

/** Sa route REST, telle que le générateur la monte. */
export const ROUTE_ARTICLES = "/api/articles";

/**
 * Le titre de la ligne semée AVANT toute migration.
 *
 * C'est la sonde anti-destruction : elle ne peut survivre qu'à une base qu'on
 * n'a pas supprimée. Distinctif exprès — un agent ne l'écrira pas par hasard.
 */
export const TITRE_SEME = "article-temoin-a-ne-pas-perdre";

/**
 * L'ancre du connecteur par défaut dans le manifeste d'une application générée.
 *
 * On vise la déclaration du module de base de données, seule forme dont
 * l'existence est garantie dès qu'une application persiste.
 */
const ANCRE = /use\("@nodefony\/drizzle",\s*\{/u;

/**
 * Pose le mode de schéma `none` sur le connecteur par défaut.
 *
 * @param {string} source - contenu de `nodefony.config.ts`.
 * @returns {string} le manifeste modifié.
 * @throws Si l'ancre est absente — le gabarit a changé de forme.
 */
export function poserModeNone(source) {
  if (!ANCRE.test(source)) {
    throw new Error(
      "ancre introuvable dans nodefony.config.ts : la déclaration " +
        '`use("@nodefony/drizzle", {` a changé de forme — décor non posé',
    );
  }
  if (/ddl:\s*"none"/u.test(source)) {
    return source;
  }
  return source.replace(
    ANCRE,
    'use("@nodefony/drizzle", {\n    // Décor du banc : le mode de PRODUCTION, où le démarrage ne\n    // fabrique jamais le schéma. Une colonne neuve n\'apparaît alors que\n    // par une migration appliquée.\n    connectors: { default: { ddl: "none" } },',
  );
}

/**
 * Applique le décor sur une application déjà générée.
 *
 * @param {string} racine - racine de l'application témoin.
 * @returns {void}
 */
export function poserDecor(racine) {
  const manifeste = path.join(racine, "nodefony.config.ts");
  const avant = readFileSync(manifeste, "utf8");
  const apres = poserModeNone(avant);
  if (apres !== avant) {
    writeFileSync(manifeste, apres);
  }
}

/**
 * Auto-contrôle : les deux branches, plus le refus.
 *
 * @returns {void}
 */
function selftest() {
  const nu =
    'export default defineConfig({\n  modules: [use("@nodefony/drizzle", {}), use("@nodefony/http", {})],\n});\n';
  const pose = poserModeNone(nu);
  if (!/ddl:\s*"none"/u.test(pose)) {
    throw new Error("le mode `none` n'a pas été posé");
  }
  if (poserModeNone(pose) !== pose) {
    throw new Error("poser deux fois doit être sans effet (idempotence)");
  }
  let refuse = false;
  try {
    poserModeNone("export default defineConfig({ modules: [] });\n");
  } catch {
    refuse = true;
  }
  if (!refuse) {
    throw new Error("un manifeste SANS l'ancre doit faire échouer le décor");
  }
  console.log("✓ prepare-base-migree : pose, idempotence, refus");
}

if (process.argv.includes("--selftest")) {
  selftest();
} else if (process.argv[1]?.endsWith("prepare-base-migree.mjs")) {
  poserDecor(process.cwd());
}
