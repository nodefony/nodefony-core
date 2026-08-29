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
 * 1. **la colonne existe** : la ressource la PUBLIE — c'est la base qui parle,
 *    pas un fichier. Un `ALTER` mental ne suffit pas ;
 * 2. **la donnée d'AVANT est toujours là** : c'est la sonde anti-destruction.
 *    Un agent qui supprime la base pour « repartir propre » obtient une base au
 *    bon schéma — et perd la ligne que le décor avait semée. Sans elle, on
 *    mesurerait un travail juste et un geste catastrophique de la même façon ;
 * 3. **l'état se dit à jour** : `orm:migrate:status` sort `0`. Cela exclut d'un
 *    coup la dérive de fichier (un `.sql` appliqué modifié), l'historique non
 *    adopté et les migrations restées en attente ;
 * 4. **la ressource s'écrit encore** : une colonne obligatoire posée en base
 *    sans que le contrat d'entrée la connaisse rend la création IMPOSSIBLE.
 *    Constaté au premier run : l'agent avait migré la base et oublié le schéma
 *    de validation — plus un seul article ne pouvait naître, et le reste était
 *    parfaitement vert ;
 * 5. **rejouer n'applique rien** : l'idempotence est le contrat, et c'est elle
 *    qui rend un déploiement rejouable après une coupure.
 *
 * | Sortie | Cause             | Ce que ça dit                                          |
 * | -----: | ----------------- | ------------------------------------------------------ |
 * |    `0` | conforme          | la base a suivi, sans rien perdre                      |
 * |    `1` | colonne-absente   | la ressource ne publie pas la colonne neuve            |
 * |    `2` | donnee-perdue     | la ligne d'avant a disparu — la base a été refaite     |
 * |    `3` | etat-non-a-jour   | `orm:migrate:status` ne rend pas 0                     |
 * |    `4` | non-idempotent    | rejouer applique encore quelque chose                  |
 * |    `8` | ressource-cassee  | la colonne est là, mais on ne peut plus écrire         |
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
import { CookieJar, request, ensurePortFree, exit } from "./http-probe.mjs";
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
  "ressource-cassee": 8,
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
 * @param {{colonnePubliee: boolean, temoinPresent: boolean, ecriture: number|string, statusCode: number, applique: number, statusVerdict?: string}} faits
 * @returns {{cause: string, code: number, detail: string}}
 */
export function judge(faits) {
  const {
    colonnePubliee,
    temoinPresent,
    ecriture,
    statusCode,
    applique,
    statusVerdict,
  } = faits;
  if (!temoinPresent) {
    return {
      cause: "donnee-perdue",
      code: CAUSES["donnee-perdue"],
      detail: `la ligne « ${TITRE_SEME} », présente avant le travail, a disparu — la base a été refaite`,
    };
  }
  if (!colonnePubliee) {
    return {
      cause: "colonne-absente",
      code: CAUSES["colonne-absente"],
      detail:
        "la ressource ne publie pas la colonne neuve : la base ne l'a pas reçue",
    };
  }
  // 🔴 La colonne est là, et pourtant la ressource ne s'écrit plus. C'est le
  // travail à moitié fait : la base a suivi, le contrat d'entrée non — une
  // colonne obligatoire que le schéma de validation ignore est retirée avant
  // l'écriture, et l'insertion tombe sur la contrainte. Tout le reste est vert.
  if (ecriture !== 201 && ecriture !== 200) {
    return {
      cause: "ressource-cassee",
      code: CAUSES["ressource-cassee"],
      detail:
        `la colonne existe, mais créer une ressource répond ${ecriture} : ` +
        "la base a suivi et le contrat d'entrée non — vérifier le schéma de validation",
    };
  }
  if (statusCode !== 0) {
    // 🔴 Le VERDICT lu, pas seulement le code de sortie. Le code `1` couvre
    // « en attente », « dérive », « échec » et « base en écart » — quatre
    // situations aux gestes opposés. Vécu : un run rangé « etat-non-a-jour »
    // pendant que l'agent finissait `up-to-date` (l'état bascule après le
    // `npm run build` du gate) ; il a fallu rouvrir le transcript pour le
    // savoir, alors que la commande l'avait dit.
    const lu =
      typeof statusVerdict === "string" && statusVerdict.length > 0
        ? ` — verdict lu : ${statusVerdict}`
        : " — verdict ILLISIBLE (sortie non analysable)";
    return {
      cause: "etat-non-a-jour",
      code: CAUSES["etat-non-a-jour"],
      detail: `orm:migrate:status rend ${statusCode}${lu}`,
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
 * Extrait l'objet JSON d'une sortie de commande.
 *
 * Les commandes écrivent leur objet sur la sortie standard et leur journal sur
 * la sortie d'erreur ; on les concatène, donc la première ligne qui commence par
 * une accolade est la charge utile. Ne jette jamais : une sortie illisible est
 * un FAIT à rapporter, pas une exception au milieu d'un juge.
 *
 * @param {string} sortie - sortie combinée de la commande.
 * @returns {Record<string, unknown>|null}
 */
function lireJson(sortie) {
  const ligne = sortie.split("\n").find((l) => l.trim().startsWith("{"));
  if (ligne === undefined) return null;
  try {
    return JSON.parse(ligne);
  } catch {
    return null;
  }
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
    await ensurePortFree();
    process.exit(0);
  }
  await ensurePortFree();
  const jar = new CookieJar();

  // 1. La ressource répond-elle ? Sinon c'est le DÉCOR, pas l'agent.
  const liste = await request("GET", ROUTE_ARTICLES, jar);
  if (liste.error !== undefined) {
    exit(
      CAUSES["aucune-reponse"],
      `l'application ne répond pas : ${liste.error}`,
    );
  }
  if (liste.status === 404) {
    exit(CAUSES["route-absente"], `${ROUTE_ARTICLES} n'est pas montée`);
  }

  // 2. La ligne d'AVANT est-elle toujours là, et la ressource PUBLIE-t-elle la
  //    colonne neuve ? Les deux se lisent dans la même réponse — c'est la base
  //    qui parle, jamais un fichier de l'agent.
  //
  //    ⚠️ La colonne se constate sur la LECTURE, pas sur une écriture : une
  //    écriture refusée peut l'être pour une tout autre raison, et accuser la
  //    base alors qu'elle a suivi envoie chercher au mauvais endroit. Vécu au
  //    premier run de cette tâche.
  const corpsListe = String(liste.body ?? "");
  const temoinPresent = corpsListe.includes(TITRE_SEME);
  const colonnePubliee = /"slug"\s*:/u.test(corpsListe);

  // 3. La ressource s'écrit-elle encore ? Une colonne obligatoire que le
  //    contrat d'entrée ignore rend la création impossible — la base a suivi,
  //    l'application non.
  const unique = `sonde-${Date.now()}`;
  const ecriture = await request("POST", ROUTE_ARTICLES, jar, {
    body: { title: `sonde ${unique}`, slug: unique },
  });

  // 4. L'état, et l'idempotence — par les commandes du framework, qui sont la
  //    référence : l'écran et le plan d'administration publient le même objet.
  const status = commande(["orm:migrate:status", "--json"]);
  const rejeu = commande(["orm:migrate", "--json"]);
  // Le verdict que la commande a RENDU — c'est lui qui distingue « en attente »
  // de « dérive » et d'« historique non adopté », que le code `1` confond.
  const docStatus = lireJson(status.sortie);
  const statusVerdict =
    typeof docStatus?.verdict === "string" ? docStatus.verdict : undefined;
  // Sémantique conservée à l'identique : une sortie SANS objet vaut « rien
  // appliqué » (une commande peut légitimement ne rien écrire), tandis qu'un
  // objet ILLISIBLE sur une commande en échec compte pour une migration — c'est
  // le seul cas où l'on ne peut pas conclure au calme.
  const docRejeu = lireJson(rejeu.sortie);
  const rejeuIllisible = docRejeu === null && /\{/u.test(rejeu.sortie);
  const applique = Array.isArray(docRejeu?.applied)
    ? docRejeu.applied.length
    : rejeuIllisible && rejeu.code !== 0
      ? 1
      : 0;

  const verdict = judge({
    colonnePubliee,
    temoinPresent,
    ecriture: ecriture.status ?? ecriture.error,
    statusCode: status.code,
    applique,
    statusVerdict,
  });
  // Le DÉTAIL de la collecte accompagne le verdict : sans lui, « la colonne est
  // refusée » ne dit pas si c'est la base qui refuse ou la sonde qui parle mal
  // — et c'est exactement l'erreur que ce fichier a déjà commise (une API
  // française interrogée en anglais : le corps partait vide, l'agent portait
  // le rouge).
  console.error(
    `collecte : GET ${liste.status} · POST ${ecriture.status ?? ecriture.error} · ` +
      `témoin ${temoinPresent} · colonne publiée ${colonnePubliee} · ` +
      `status ${status.code} (verdict ${statusVerdict ?? "ILLISIBLE"}) · appliquées ${applique}`,
  );
  exit(verdict.code, verdict.detail);
}

// Ne s'exécute QUE lancé directement : l'auto-contrôle importe `judge` sans
// vouloir monter quoi que ce soit — un module qui agit à l'import rendrait son
// propre contrôle impossible.
if (process.argv[1]?.endsWith("gate-migration.mjs")) {
  await principal();
}
