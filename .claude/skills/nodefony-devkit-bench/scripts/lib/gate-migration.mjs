/**
 * Juge de la tâche « faire suivre une base DÉJÀ en place » — et il NOMME sa
 * cause.
 *
 * Ce que ce juge refuse de faire : lire les fichiers de l'agent. Un `.ts` dit ce
 * qui a été écrit ; il ne dit pas ce qui EXISTE en base — et c'est la seule
 * question qui compte quand une application de production doit suivre. Le juge
 * interroge donc l'application qui tourne, comme un client.
 *
 * Quatre faits, et ils forment un tout — chacun seul se contourne :
 *
 * 1. **la colonne existe et se remplit** : une écriture qui la porte est
 *    acceptée. Un `ALTER` mental ne suffit pas ;
 * 2. **la donnée d'AVANT est toujours là** : c'est la sonde anti-destruction.
 *    Un agent qui supprime la base pour « repartir propre » obtient une base au
 *    bon schéma — et perd la ligne que le décor avait semée. Sans elle, on
 *    mesurerait un travail juste et un geste catastrophique de la même façon ;
 * 3. **l'état se dit à jour** : `orm:migrate:status` sort `0`. Cela exclut d'un
 *    coup la dérive de fichier (un `.sql` appliqué modifié), l'historique non
 *    adopté et les migrations restées en attente ;
 * 4. **rejouer n'applique rien** : l'idempotence est le contrat, et c'est elle
 *    qui rend un déploiement rejouable après une coupure.
 *
 * | Sortie | Cause             | Ce que ça dit                                          |
 * | -----: | ----------------- | ------------------------------------------------------ |
 * |    `0` | conforme          | la base a suivi, sans rien perdre                      |
 * |    `1` | colonne-absente   | la colonne neuve n'existe pas en base                  |
 * |    `2` | donnee-perdue     | la ligne d'avant a disparu — la base a été refaite     |
 * |    `3` | etat-non-a-jour   | `orm:migrate:status` ne rend pas 0                     |
 * |    `4` | non-idempotent    | rejouer applique encore quelque chose                  |
 * |    `5` | port-deja-tenu    | un serveur ÉTRANGER répondrait à sa place              |
 * |    `6` | aucune-reponse    | l'application ne répond pas — DÉCOR                    |
 * |    `7` | route-absente     | la ressource n'est pas montée — DÉCOR                  |
 *
 * Les causes `5`, `6` et `7` n'accusent PAS l'agent : sans elles, un décor
 * défaillant rendrait un « colonne absente » parfaitement crédible sur un
 * travail juste — le mode de défaillance n°1 de ce banc.
 *
 * @module
 */
import { spawnSync } from "node:child_process";
import { Bocal, demander, garderPortLibre, sortir } from "./http-probe.mjs";
import { ROUTE_ARTICLES, TITRE_SEME } from "./prepare-base-migree.mjs";

/** Les causes, telles que la table ci-dessus les fixe. */
export const CAUSES = {
  conforme: 0,
  "colonne-absente": 1,
  "donnee-perdue": 2,
  "etat-non-a-jour": 3,
  "non-idempotent": 4,
  "port-deja-tenu": 5,
  "aucune-reponse": 6,
  "route-absente": 7,
};

/**
 * Le verdict, sur des faits déjà collectés.
 *
 * Séparé de la collecte pour être éprouvable sans application : l'auto-contrôle
 * appelle CETTE fonction sur des états figés. Un auto-contrôle qui
 * réimplémenterait la règle validerait sa propre copie.
 *
 * L'ORDRE des causes n'est pas indifférent : la donnée perdue passe avant tout
 * le reste sauf l'absence de colonne, parce qu'une base refaite peut très bien
 * répondre juste à toutes les autres questions.
 *
 * @param {{colonneAcceptee: boolean, temoinPresent: boolean, statusCode: number, applique: number}} faits
 * @returns {{cause: string, code: number, detail: string}}
 */
export function juger(faits) {
  const { colonneAcceptee, temoinPresent, statusCode, applique } = faits;
  if (!colonneAcceptee) {
    return {
      cause: "colonne-absente",
      code: CAUSES["colonne-absente"],
      detail:
        "une écriture portant la colonne neuve est refusée : la base ne l'a pas",
    };
  }
  if (!temoinPresent) {
    return {
      cause: "donnee-perdue",
      code: CAUSES["donnee-perdue"],
      detail: `la ligne « ${TITRE_SEME} », présente avant le travail, a disparu — la base a été refaite`,
    };
  }
  if (statusCode !== 0) {
    return {
      cause: "etat-non-a-jour",
      code: CAUSES["etat-non-a-jour"],
      detail: `orm:migrate:status rend ${statusCode} : en attente, dérive, ou historique non adopté`,
    };
  }
  if (applique !== 0) {
    return {
      cause: "non-idempotent",
      code: CAUSES["non-idempotent"],
      detail: `rejouer applique encore ${applique} migration(s) — le contrat est qu'un second passage ne fasse rien`,
    };
  }
  return {
    cause: "conforme",
    code: 0,
    detail: "la base a suivi, la donnée d'avant est là, rejouer ne fait rien",
  };
}

/**
 * Lance une commande du framework dans l'application et rend son code.
 *
 * @param {string[]} args - arguments passés à la ligne de commande.
 * @returns {{code: number, sortie: string}}
 */
function commande(args) {
  const r = spawnSync("npx", ["--no-install", "nodefony", ...args], {
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  return { code: r.status ?? 2, sortie: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

/**
 * Collecte les quatre faits, puis rend le verdict.
 *
 * @returns {Promise<void>}
 */
async function principal() {
  if (process.argv.includes("--check-port-free")) {
    await garderPortLibre();
    process.exit(0);
  }
  await garderPortLibre();
  const bocal = new Bocal();

  // 1. La ressource répond-elle ? Sinon c'est le DÉCOR, pas l'agent.
  const liste = await demander("GET", ROUTE_ARTICLES, bocal).catch(() => null);
  if (liste === null) {
    sortir(CAUSES["aucune-reponse"], "l'application ne répond pas");
  }
  if (liste.status === 404) {
    sortir(CAUSES["route-absente"], `${ROUTE_ARTICLES} n'est pas montée`);
  }

  // 2. La ligne d'AVANT est-elle toujours là ?
  const temoinPresent = String(liste.body ?? "").includes(TITRE_SEME);

  // 3. La colonne neuve accepte-t-elle une écriture ? On la remplit avec une
  //    valeur unique — c'est le seul moyen de constater qu'elle EXISTE sans
  //    supposer le nom de la base ni son dialecte.
  const unique = `sonde-${Date.now()}`;
  const ecriture = await demander("POST", ROUTE_ARTICLES, bocal, {
    body: JSON.stringify({ title: `sonde ${unique}`, slug: unique }),
    headers: { "content-type": "application/json" },
  }).catch(() => null);
  const cree =
    ecriture !== null && ecriture.status >= 200 && ecriture.status < 300;
  // Relire : une écriture acceptée dont la colonne serait ignorée en silence ne
  // prouverait rien. C'est la LECTURE de la valeur qui fait le fait.
  const relu = await demander("GET", ROUTE_ARTICLES, bocal).catch(() => null);
  const colonneAcceptee =
    cree && relu !== null && String(relu.body ?? "").includes(unique);

  // 4. L'état, et l'idempotence — par les commandes du framework, qui sont la
  //    référence : l'écran et le plan d'administration publient le même objet.
  const status = commande(["orm:migrate:status", "--json"]);
  const rejeu = commande(["orm:migrate", "--json"]);
  let applique = 0;
  try {
    const doc = JSON.parse(
      rejeu.sortie.split("\n").find((l) => l.trim().startsWith("{")) ?? "{}",
    );
    applique = Array.isArray(doc.applied) ? doc.applied.length : 0;
  } catch {
    applique = rejeu.code === 0 ? 0 : 1;
  }

  const verdict = juger({
    colonneAcceptee,
    temoinPresent,
    statusCode: status.code,
    applique,
  });
  sortir(verdict.code, verdict.detail);
}

// Ne s'exécute QUE lancé directement : l'auto-contrôle importe `juger` sans
// vouloir monter quoi que ce soit — un module qui agit à l'import rendrait son
// propre contrôle impossible.
if (process.argv[1]?.endsWith("gate-migration.mjs")) {
  await principal();
}
