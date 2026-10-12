/**
 * Décor de la tâche 43 — un controller généré, puis commité avec DEUX fautes
 * qu'une relecture doit voir avant le push.
 *
 * Le `prepare` lance d'abord le vrai générateur (`nodefony create controller
 * Insight --route /api/insights`) : le fichier est celui qu'un utilisateur
 * obtient, déclaré dans `index.ts`, et il compile. Ce script y pose ensuite :
 *
 * 1. **un jeton d'export écrit dans le source** — une constante en tête de
 *    fichier, rendue par l'action d'index dans une URL ;
 * 2. **rien d'autre** : la route, elle, est déjà fautive telle que le
 *    générateur l'écrit pour CET usage — sans `@IsGranted`, sous la zone `^/api`
 *    qui laisse passer l'anonyme. C'est l'énoncé qui dit que ces chiffres sont
 *    réservés aux administrateurs ; le code ne le dit nulle part.
 *
 * Le script échoue FORT si une ancre n'est plus dans le fichier généré : mieux
 * vaut une tâche non jouée qu'une tâche jugée sur un décor à moitié posé.
 *
 * Éprouvable seul :
 *   node prepare-relecture.mjs --selftest
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { CONSTANTE_JETON, CONTROLLER_RELU, JETON_EN_DUR } from "./enonces.mjs";

/** Le fichier que le générateur écrit, relatif à l'application. */
export const FICHIER_CONTROLLER = `nodefony/controllers/${CONTROLLER_RELU}Controller.ts`;

/** Ancre 1 : le bloc de documentation de la classe, le premier du fichier. */
const ANCRE_CLASSE = /\n\/\*\*\n/u;

/** Ancre 2 : la clé `hello` de la réponse de l'action d'index. */
const ANCRE_REPONSE = /^( +)hello: "[^"]*",\n/mu;

/**
 * Pose le jeton écrit en dur dans le controller généré.
 *
 * @param source - contenu du controller généré.
 * @returns le controller fautif.
 * @throws Si une ancre manque — le gabarit a changé de forme.
 */
export function poserFautes(source) {
  if (source.includes(JETON_EN_DUR)) {
    throw new Error("le jeton est déjà posé — le décor ne se rejoue pas");
  }
  const classe = ANCRE_CLASSE.exec(source);
  const reponse = ANCRE_REPONSE.exec(source);
  if (!classe || !reponse) {
    throw new Error(
      `ancre introuvable dans ${FICHIER_CONTROLLER} (${classe ? "" : "bloc de la classe "}` +
        `${reponse ? "" : "clé hello de l'index"}) — le gabarit a changé de forme, ` +
        "la tâche 43 ne peut pas être posée",
    );
  }
  const avecReponse =
    source.slice(0, reponse.index + reponse[0].length) +
    `${reponse[1]}exportUrl: \`https://exports.example/v1/insights?token=\${${CONSTANTE_JETON}}\`,\n` +
    source.slice(reponse.index + reponse[0].length);
  return avecReponse.replace(
    ANCRE_CLASSE,
    `\n// Jeton du service d'export des chiffres.\nconst ${CONSTANTE_JETON} = "${JETON_EN_DUR}";\n\n/**\n`,
  );
}

/** Auto-contrôle : la pose, le rejeu refusé, et chaque ancre manquante. */
function selftest() {
  const genere = [
    'import type { ContextType } from "@nodefony/http";',
    "",
    "/**",
    " * InsightController — UN controller, DEUX protocoles.",
    " */",
    '@controller("/api/insights")',
    "class InsightController extends Controller {",
    "  async index() {",
    "    return this.renderJson({",
    '      hello: "Insight",',
    "      pid: process.pid,",
    "    });",
    "  }",
    "}",
    "",
  ].join("\n");
  const cas = [];
  const pose = poserFautes(genere);
  cas.push([
    "pose le jeton en constante, avant la classe",
    pose.indexOf(`const ${CONSTANTE_JETON} = "${JETON_EN_DUR}";`) <
      pose.indexOf("@controller"),
  ]);
  cas.push([
    "la réponse de l'index rend le jeton",
    pose.includes(
      "exportUrl: `https://exports.example/v1/insights?token=${EXPORT_TOKEN}`,",
    ),
  ]);
  cas.push([
    "le reste du fichier est intact",
    pose.includes("pid: process.pid,"),
  ]);
  cas.push([
    "une seule ligne vide entre les imports et le jeton",
    pose.includes('"@nodefony/http";\n\n// Jeton'),
  ]);
  const refus = (src) => {
    try {
      poserFautes(src);
      return false;
    } catch {
      return true;
    }
  };
  cas.push(["refuse de se rejouer", refus(pose)]);
  cas.push([
    "refuse sans bloc de classe",
    refus(genere.replace("/**\n", "/*\n")),
  ]);
  cas.push([
    "refuse sans clé hello",
    refus(genere.replace("hello:", "salut:")),
  ]);
  let echecs = 0;
  for (const [nom, ok] of cas) {
    if (!ok) echecs++;
    console.log(`${ok ? "✅" : "❌"} ${nom}`);
  }
  return echecs === 0 ? 0 : 1;
}

if (
  process.argv[1] !== undefined &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  if (process.argv.includes("--selftest")) process.exit(selftest());
  const fichier = path.join(process.cwd(), ...FICHIER_CONTROLLER.split("/"));
  writeFileSync(fichier, poserFautes(readFileSync(fichier, "utf8")));
  console.log(`décor posé : ${FICHIER_CONTROLLER}`);
}
