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
 * Les DEUX formes sous lesquelles une application déclare le module de base.
 *
 * 🔴 Une ancre unique était un fil trop fin : le gabarit déclare le module en
 * chaîne NUE (`"@nodefony/drizzle",`) et non par un appel, et le décor a cessé
 * de se poser sans qu'aucun code ne change ici. Le banc l'a dit correctement —
 * « prémisse NON posée, tâche non jouée » — mais trois répétitions ont été
 * payées pour un verdict vide. On reconnaît donc les deux écritures, et un
 * autotest les tient.
 */
const ANCRE_APPEL = /use\("@nodefony\/drizzle",\s*\{/u;
const ANCRE_NUE = /(^|\n)(\s*)"@nodefony\/drizzle",/u;

/** Le réglage que le décor pose, et son commentaire. */
const REGLAGE =
  "// Décor du banc : le mode de PRODUCTION, où le démarrage ne\n" +
  "    // fabrique jamais le schéma. Une colonne neuve n'apparaît alors que\n" +
  "    // par une migration appliquée.\n" +
  '    connectors: { default: { ddl: "none" } },';

/**
 * La racine visée est-elle une application TÉMOIN, et non le dépôt lui-même ?
 *
 * Le dépôt du framework est reconnaissable sans ambiguïté : il déclare des
 * espaces de travail npm, ce qu'aucune application générée ne fait. Le test est
 * PUR — on lui donne un lecteur — pour être éprouvable sans fabriquer d'arbre.
 *
 * @param {string} racine - racine candidate.
 * @param {(f: string) => string} [lire] - lecteur de fichier (injecté pour l'autotest).
 * @returns {boolean} vrai si la racine peut recevoir un décor de banc.
 */
export function estApplicationTemoin(racine, lire = undefined) {
  const lecteur = lire ?? ((f) => readFileSync(f, "utf8"));
  let manifeste;
  try {
    manifeste = JSON.parse(lecteur(path.join(racine, "package.json")));
  } catch {
    // Pas de manifeste lisible : ce n'est pas une application installée, donc
    // rien à quoi poser un décor. On refuse, plutôt que de deviner.
    return false;
  }
  return manifeste.workspaces === undefined;
}

/**
 * Pose le mode de schéma `none` sur le connecteur par défaut.
 *
 * @param {string} source - contenu de `nodefony.config.ts`.
 * @returns {string} le manifeste modifié.
 * @throws Si aucune des deux formes n'est présente — le gabarit a changé.
 */
export function poserModeNone(source) {
  if (/ddl:\s*"none"/u.test(source)) {
    return source;
  }
  if (ANCRE_APPEL.test(source)) {
    return source.replace(
      ANCRE_APPEL,
      `use("@nodefony/drizzle", {\n    ${REGLAGE}`,
    );
  }
  if (ANCRE_NUE.test(source)) {
    return source.replace(
      ANCRE_NUE,
      (_m, avant, indent) =>
        `${avant}${indent}use("@nodefony/drizzle", {\n${indent}  ${REGLAGE.split("\n").join("\n" + indent.slice(2))}\n${indent}}),`,
    );
  }
  throw new Error(
    "ancre introuvable dans nodefony.config.ts : le module " +
      "`@nodefony/drizzle` n'y est déclaré ni en appel `use(...)` ni en " +
      "chaîne nue — le gabarit a changé de forme, décor non posé",
  );
}

/**
 * Applique le décor sur une application déjà générée.
 *
 * @param {string} racine - racine de l'application témoin.
 * @returns {void}
 */
export function poserDecor(racine) {
  // 🔴 JAMAIS le dépôt du framework. Ce script modifie un manifeste et sème une
  // ligne en base : lancé depuis une mauvaise racine — un `cd` oublié, un
  // diagnostic à la main —, il pose son décor de banc dans le dépôt lui-même.
  // C'est arrivé : la déclaration du module ORM du dépôt s'est retrouvée
  // réécrite en mode de production, silencieusement. Un outil de décor doit
  // refuser tout ce qui n'est pas un décor.
  if (!estApplicationTemoin(racine)) {
    throw new Error(
      `refus de poser le décor dans « ${racine} » : ce n'est pas une ` +
        "application témoin de banc mais le dépôt du framework (ou une racine " +
        "qui lui ressemble). Passer la racine de l'application générée.",
    );
  }
  const manifeste = path.join(racine, "nodefony.config.ts");
  const avant = readFileSync(manifeste, "utf8");
  const apres = poserModeNone(avant);
  if (apres !== avant) {
    writeFileSync(manifeste, apres);
  }
}

/**
 * Auto-contrôle : les DEUX écritures, l'idempotence, plus le refus.
 *
 * 🔴 Le cas de la chaîne NUE est celui qui manquait, et son absence a coûté
 * trois répétitions pour un verdict vide : le gabarit déclare le module ainsi,
 * l'autotest ne connaissait que l'appel, et il restait vert pendant que le
 * décor ne se posait plus. Un autotest qui ne couvre pas la forme RÉELLE du
 * gabarit ne garde rien.
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

  // La forme que le gabarit d'application écrit RÉELLEMENT.
  const chaineNue =
    'import { defineConfig, use } from "nodefony";\n' +
    "export default defineConfig((ctx) => ({\n  modules: [\n" +
    '    /** ORM Drizzle (SQL). */\n    "@nodefony/drizzle",\n\n' +
    '    use("@nodefony/http", {}),\n  ],\n}));\n';
  const poseNue = poserModeNone(chaineNue);
  if (!/ddl:\s*"none"/u.test(poseNue)) {
    throw new Error(
      "la déclaration en chaîne nue — celle du gabarit — n'a pas été traitée",
    );
  }
  if (/^\s*"@nodefony\/drizzle",/mu.test(poseNue)) {
    throw new Error("la chaîne nue doit avoir été REMPLACÉE, pas doublée");
  }
  if (poserModeNone(poseNue) !== poseNue) {
    throw new Error("poser deux fois doit être sans effet (chaîne nue)");
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
  // 🔴 La garde de périmètre : un décor de banc ne se pose JAMAIS dans le
  // dépôt du framework. Vécu — un diagnostic lancé depuis la mauvaise racine a
  // réécrit la déclaration du module ORM du dépôt, en silence.
  const depot = () =>
    JSON.stringify({ name: "nodefony-core", workspaces: ["src/*"] });
  const appli = () => JSON.stringify({ name: "bench-app" });
  if (estApplicationTemoin("/peu-importe", depot)) {
    throw new Error("le dépôt du framework doit être REFUSÉ comme cible");
  }
  if (!estApplicationTemoin("/peu-importe", appli)) {
    throw new Error("une application générée doit être acceptée");
  }
  if (
    estApplicationTemoin("/peu-importe", () => {
      throw new Error("absent");
    })
  ) {
    throw new Error("sans manifeste lisible, on refuse plutôt que de deviner");
  }

  console.log(
    "✓ prepare-base-migree : pose (2 formes), idempotence, refus, périmètre",
  );
}

if (process.argv.includes("--selftest")) {
  selftest();
} else if (process.argv[1]?.endsWith("prepare-base-migree.mjs")) {
  poserDecor(process.cwd());
}
