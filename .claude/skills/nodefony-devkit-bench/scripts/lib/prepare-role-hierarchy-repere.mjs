/**
 * Pose le REPÈRE de la tâche « un rôle en implique un autre » — AVANT l'agent.
 *
 * Joué par `task.prepare`, donc commité à part : ce que l'agent trouve en
 * arrivant fait partie du décor, et son diff ne le contient pas.
 *
 * ## Pourquoi un script, et pas une commande du framework
 *
 * Aucun générateur ne sait poser une garde sur un rôle CHOISI. Les gabarits
 * n'émettent que `@IsGranted("ROLE_ADMIN")`, littéral, et sur la seule action
 * destructrice (`entity/controller/…__PASCAL__Controller.ts.tpl:271`,
 * `controller/rest/…__NAME__.ts.tpl:129`) ; et le CLI `create` n'expose aucune
 * option de rôle (35 options déclarées dans `src/cli/create.ts`, aucune
 * `--role`/`--roles`/`--guard`/`--granted`). Le repère se pose donc à la main —
 * mais avec les MÊMES décorateurs que ceux qu'`AGENTS.md` enseigne, pour que
 * l'agent trouve du code idiomatique et non un artefact de banc.
 *
 * ## Deux pièges, tous deux vécus
 *
 * Le patch vise le fichier RENDU (`nodefony/controllers/HelloController.ts`),
 * jamais le gabarit : celui-ci porte `export default <%= it.nameClass %>;`,
 * et une ancre recopiée du `.tpl` ne mordrait sur rien. Et le nom de la classe
 * est un PARAMÈTRE du gabarit — on le capture, on ne le présume pas.
 *
 * ## Échouer fort, jamais à moitié
 *
 * Si une ancre manque, le gabarit a changé de forme : on sort en erreur. Le
 * harnais transforme cet échec en « tâche non jouée » et n'exécute pas l'agent
 * (`bench-discoverability.mjs`, garde du `prepare`) — jamais en FAIL imputé à
 * quelqu'un. Un repère à moitié posé rendrait, lui, un verdict qui ne mesure
 * rien tout en ayant l'air de mesurer.
 *
 * @module
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { REPERE_FACTURATION, ROLE_FACTURATION } from "./enonces.mjs";

/** Le controller d'accueil de toute application générée — déjà câblé. */
const CHEMIN = path.join("nodefony", "controllers", "HelloController.ts");

/**
 * Le chemin du repère, tel que le décorateur `@route` l'attend.
 *
 * Le controller est monté sous `@controller("/api")` : ses routes déclarent un
 * chemin RELATIF. Recomposer à la main (« /finance/export ») ferait vivre la
 * valeur à deux endroits — on la dérive.
 */
const CHEMIN_RELATIF = REPERE_FACTURATION.replace(/^\/api/u, "");

const source = readFileSync(CHEMIN, "utf8");

// ── Ancre 1 : la liste d'imports du framework ───────────────────────────────
const IMPORT_ACTUEL = '  Param,\n} from "@nodefony/framework";';
const IMPORT_PATCHE = '  Param,\n  IsGranted,\n} from "@nodefony/framework";';
if (!source.includes(IMPORT_ACTUEL)) {
  throw new Error(
    `${CHEMIN} : la liste d'imports attendue est introuvable — le gabarit du ` +
      `controller d'accueil a changé de forme. Le repère de la tâche ` +
      `« hiérarchie de rôles » ne peut pas être posé tel quel.`,
  );
}

// ── Ancre 2 : la fin de classe, dont le nom est un paramètre du gabarit ─────
const FIN = /\n\}\n\nexport default (\w+);\n?$/u;
const finTrouvee = FIN.exec(source);
if (!finTrouvee) {
  throw new Error(
    `${CHEMIN} : la fin de classe attendue (accolade puis « export default ` +
      `<Classe>; ») est introuvable — le gabarit du controller d'accueil a ` +
      `changé de forme. Le repère ne peut pas être posé.`,
  );
}
const classe = finTrouvee[1];

const METHODE = `
  /**
   * Repère du banc — DÉCOR, jamais mentionné par l'énoncé de la tâche.
   *
   * Gardée par le MÊME rôle que la route que l'agent doit protéger. Si un
   * administrateur y accède alors qu'aucun décorateur écrit par lui ne la
   * couvre, c'est qu'une hiérarchie de rôles a été déclarée globalement — et
   * non qu'une liste de rôles a été posée sur sa propre route.
   */
  @route("repere-facturation", {
    path: "${CHEMIN_RELATIF}",
    method: "GET",
  })
  @IsGranted("${ROLE_FACTURATION}")
  async repereFacturation() {
    return this.renderJson({ repere: "facturation" });
  }
}

export default ${classe};
`;

writeFileSync(
  CHEMIN,
  source.replace(IMPORT_ACTUEL, IMPORT_PATCHE).replace(FIN, METHODE),
);

console.log(
  `repère posé — GET ${REPERE_FACTURATION} (@IsGranted("${ROLE_FACTURATION}")) dans ${classe}`,
);
