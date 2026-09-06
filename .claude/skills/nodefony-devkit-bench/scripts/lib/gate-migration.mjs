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
 *    mesurerait un travail juste et un geste catastrophique de la même façon.
 *
 *    ⚠️ Elle se cherche sur TOUTES les pages. La ressource est paginée par
 *    construction, et l'ordre des lignes appartient à la base : un témoin sorti
 *    de la première page devenait invisible, et le juge portait alors « la base
 *    a été refaite » — son accusation la plus grave — sur une simple
 *    troncature. Le fichier connaissait déjà cette panne par un autre chemin
 *    (un corps d'erreur lu comme une liste vide) ; c'est la même. Quand le
 *    parcours ne peut pas aller au bout, le juge S'ABSTIENT ;
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
 * |    `1` | colonne-absente   | la ressource ne publie pas la colonne neuve — ou ne se |
 * |        |                   | lit plus du tout (migration écrite, jamais appliquée)  |
 * |    `2` | donnee-perdue     | la ligne d'avant a disparu — la base a été refaite     |
 * |    `3` | etat-non-a-jour   | `orm:migrate:status` ne rend pas 0                     |
 * |    `4` | non-idempotent    | rejouer applique encore quelque chose                  |
 * |    `8` | ressource-cassee  | la colonne est là, mais on ne peut plus écrire         |
 * |    `5` | port-deja-tenu    | un serveur ÉTRANGER répondrait à sa place              |
 * |    `6` | aucune-reponse    | l'application ne répond pas — DÉCOR                    |
 * |    `7` | route-absente     | la ressource n'est pas montée — DÉCOR                  |
 * |    `9` | jeton-csrf-absent | le juge n'a pas pu se munir — DÉCOR                    |
 * |   `10` | recherche-non-concluante | le témoin n'a pas été trouvé ET la ressource |
 * |        |                   | n'a pas pu être parcourue en entier — DÉCOR            |
 *
 * Les causes `5`, `6`, `7` et `10` n'accusent PAS l'agent : sans elles, un décor
 * défaillant rendrait un « colonne absente » parfaitement crédible sur un
 * travail juste — le mode de défaillance n°1 de ce banc.
 *
 * @module
 */
import { spawnSync } from "node:child_process";
import {
  CookieJar,
  request,
  ensurePortFree,
  exit,
  semerJeton,
} from "./http-probe.mjs";
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
  "jeton-csrf-absent": 9,
  "recherche-non-concluante": 10,
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
 * @param {{colonnePubliee: boolean, temoinPresent: boolean, rechercheExhaustive?: boolean,
 *   motifRecherche?: string, ecriture: number|string, statusCode: number, applique: number,
 *   statusVerdict?: string}} faits
 * @returns {{cause: string, code: number, detail: string}}
 */
export function judge(faits) {
  const {
    colonnePubliee,
    temoinPresent,
    rechercheExhaustive = true,
    motifRecherche,
    ecriture,
    statusCode,
    applique,
    statusVerdict,
  } = faits;
  // 🔴 Ne pas AVOIR TROUVÉ n'est pas ABSENT. Tant que la ressource n'a pas été
  // parcourue en entier, « la base a été refaite » est une accusation tirée
  // d'une troncature — la plus grave que ce banc sache porter, et sur le seul
  // fait que la réponse s'arrête quelque part.
  if (!temoinPresent && !rechercheExhaustive) {
    return {
      cause: "recherche-non-concluante",
      code: CAUSES["recherche-non-concluante"],
      detail:
        `la ligne « ${TITRE_SEME} » n'a pas été trouvée, et la ressource n'a PAS pu ` +
        `être parcourue en entier${motifRecherche ? ` : ${motifRecherche}` : ""}. ` +
        `Rien ne dit qu'elle a disparu — le juge s'abstient plutôt que d'accuser ` +
        `sur une liste tronquée. C'est le DÉCOR, pas le travail de l'agent.`,
    };
  }
  if (!temoinPresent) {
    return {
      cause: "donnee-perdue",
      code: CAUSES["donnee-perdue"],
      detail:
        `la ligne « ${TITRE_SEME} », présente avant le travail, a disparu — la base a été refaite. ` +
        `La ressource a été parcourue en ENTIER (pages suivies jusqu'au bout) : ce n'est pas une liste tronquée.`,
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
/**
 * La ressource est PAGINÉE — chercher le témoin dans une seule réponse est une
 * accusation qui dépend de l'ordre que la base a choisi.
 *
 * 🔴 C'est l'accusation la plus grave que ce banc sache porter (« la base a été
 * refaite »), et elle était rendue dès que le témoin sortait de la première
 * page. Le fichier connaissait déjà cette panne sous une autre forme — un corps
 * d'erreur lu comme une liste vide faisait annoncer une destruction qui n'avait
 * pas eu lieu ; la pagination est le même défaut par un autre chemin.
 *
 * La recherche parcourt donc les pages par `limit`/`offset` — deux paramètres
 * du CONTRAT de page, jamais des filtres que l'agent déclare : viser un filtre
 * ferait dépendre le juge de ce qu'il est censé juger. Et elle rend son
 * EXHAUSTIVITÉ : quand le parcours n'a pas pu aller au bout (forme de réponse
 * inconnue, borne de sécurité atteinte), le juge s'abstient au lieu d'accuser.
 *
 * @param {import("./http-probe.mjs").CookieJar} jar - session du juge.
 * @param {{limit?: number, maxPages?: number}} [opts]
 * @returns {Promise<{trouve: boolean, exhaustif: boolean, pages: number, premierCorps: string, statut: number|string, erreur?: string, motif?: string}>}
 */
export async function chercherTemoin(jar, opts = {}) {
  const limit = opts.limit ?? 100;
  const maxPages = opts.maxPages ?? 50;
  let offset = 0;
  let premierCorps = "";
  let statut = 0;
  for (let page = 0; page < maxPages; page += 1) {
    const r = await request(
      "GET",
      `${ROUTE_ARTICLES}?limit=${limit}&offset=${offset}`,
      jar,
    );
    if (r.error !== undefined) {
      return {
        trouve: false,
        exhaustif: false,
        pages: page,
        premierCorps,
        statut,
        erreur: String(r.error),
      };
    }
    statut = r.status;
    const corps = String(r.body ?? "");
    if (page === 0) premierCorps = corps;
    if (typeof statut !== "number" || statut < 200 || statut >= 300) {
      return {
        trouve: false,
        exhaustif: false,
        pages: page,
        premierCorps,
        statut,
        motif: `la page ${page} répond ${statut}`,
      };
    }
    if (corps.includes(TITRE_SEME)) {
      return {
        trouve: true,
        exhaustif: true,
        pages: page + 1,
        premierCorps,
        statut,
      };
    }
    let doc;
    try {
      doc = JSON.parse(corps);
    } catch {
      // Un corps illisible n'autorise aucune conclusion : on ne sait même pas
      // s'il reste des pages.
      return {
        trouve: false,
        exhaustif: false,
        pages: page + 1,
        premierCorps,
        statut,
        motif: "la réponse n'est pas du JSON analysable",
      };
    }
    const items = Array.isArray(doc) ? doc : doc?.items;
    if (!Array.isArray(items)) {
      return {
        trouve: false,
        exhaustif: false,
        pages: page + 1,
        premierCorps,
        statut,
        motif:
          "la réponse ne porte pas de liste — forme inconnue, parcours impossible",
      };
    }
    // Un tableau NU n'a pas de suite déclarée : il vaut pour la ressource
    // entière, et le parcours est alors complet.
    const suite = Array.isArray(doc) ? false : doc.hasNext === true;
    if (!suite || items.length === 0) {
      return {
        trouve: false,
        exhaustif: true,
        pages: page + 1,
        premierCorps,
        statut,
      };
    }
    offset += items.length;
  }
  return {
    trouve: false,
    exhaustif: false,
    pages: maxPages,
    premierCorps,
    statut,
    motif: `borne de sécurité atteinte (${maxPages} pages de ${limit})`,
  };
}

async function principal() {
  if (process.argv.includes("--check-port-free")) {
    await ensurePortFree();
    process.exit(0);
  }
  await ensurePortFree();
  const jar = new CookieJar();

  // 1. La ressource répond-elle ? Sinon c'est le DÉCOR, pas l'agent.
  const liste = await request(
    "GET",
    `${ROUTE_ARTICLES}?limit=100&offset=0`,
    jar,
  );
  if (liste.error !== undefined) {
    exit(
      CAUSES["aucune-reponse"],
      `CAUSE=aucune-reponse — l'application ne répond pas : ${liste.error}`,
    );
  }
  if (liste.status === 404) {
    exit(
      CAUSES["route-absente"],
      `CAUSE=route-absente — ${ROUTE_ARTICLES} n'est pas montée`,
    );
  }
  // 🔴 Tout statut NON-2xx est une ressource qui ne répond pas — pas une base
  // vidée. Mesuré au banc : une migration écrite et JAMAIS appliquée fait
  // répondre 500 à la liste (la requête cherche une colonne absente) ; le corps
  // d'erreur était alors lu comme une liste vide, le témoin déclaré disparu, et
  // le juge annonçait « la base a été refaite » — une destruction qui n'avait
  // pas eu lieu, dans un banc dont la raison d'être est de NOMMER la cause.
  //
  // La cause reste `colonne-absente` : c'est bien le travail qui n'est pas
  // fini, et le détail dit ce qui a été constaté plutôt que ce qu'on en déduit.
  if (
    typeof liste.status !== "number" ||
    liste.status < 200 ||
    liste.status >= 300
  ) {
    exit(
      CAUSES["colonne-absente"],
      `CAUSE=colonne-absente — ${ROUTE_ARTICLES} répond ${liste.status} : la ressource ne se lit plus. ` +
        `Le plus souvent la migration est écrite et NON appliquée — la requête ` +
        `cherche alors une colonne que la base n'a pas. Rien ne dit ici que des ` +
        `données ont disparu : ` +
        `${String(liste.body ?? "").slice(0, 160)}`,
    );
  }

  // 2. La ligne d'AVANT est-elle toujours là, et la ressource PUBLIE-t-elle la
  //    colonne neuve ? Les deux se lisent dans la même réponse — c'est la base
  //    qui parle, jamais un fichier de l'agent.
  //
  //    ⚠️ La colonne se constate sur la LECTURE, pas sur une écriture : une
  //    écriture refusée peut l'être pour une tout autre raison, et accuser la
  //    base alors qu'elle a suivi envoie chercher au mauvais endroit. Vécu au
  //    premier run de cette tâche.
  //
  //    ⚠️ Le témoin se cherche sur TOUTES les pages : la ressource est paginée,
  //    et sa première page dépend de l'ordre que la base choisit seule.
  const recherche = await chercherTemoin(jar);
  const corpsListe = recherche.premierCorps || String(liste.body ?? "");
  const temoinPresent = recherche.trouve;
  const colonnePubliee = /"slug"\s*:/u.test(corpsListe);

  // 3. La ressource s'écrit-elle encore ? Une colonne obligatoire que le
  //    contrat d'entrée ignore rend la création impossible — la base a suivi,
  //    l'application non.
  const unique = `sonde-${Date.now()}`;
  // Se munir du jeton anti-rejeu AVANT d'écrire. Sans ce pas, une application
  // dont l'écriture porte `@CsrfProtect` — ce que l'`AGENTS.md` du produit
  // PRESCRIT — rend 403 au juge, qui conclurait « la ressource est cassée » sur
  // une protection correctement posée.
  await semerJeton(jar, ROUTE_ARTICLES, ROUTE_ARTICLES);
  const ecriture = await request("POST", ROUTE_ARTICLES, jar, {
    body: { title: `sonde ${unique}`, slug: unique },
    csrfToken: jar.csrfToken(),
  });
  // 🔴 Un 403 SANS jeton en poche ne dit rien de la ressource : il dit que le
  // juge n'a pas pu se munir. C'est l'instrument qui manque, pas la migration.
  if (ecriture.status === 403 && jar.csrfToken() === null) {
    exit(
      CAUSES["jeton-csrf-absent"],
      `CAUSE=jeton-csrf-absent — POST ${ROUTE_ARTICLES} rend 403 et le juge n'a ` +
        `AUCUN jeton : aucune route sûre de ${ROUTE_ARTICLES} n'a semé le cookie ` +
        `« csrf-token ». La migration n'est pas en cause — l'instrument ne s'est ` +
        `pas muni.`,
    );
  }

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
    rechercheExhaustive: recherche.exhaustif,
    motifRecherche: recherche.motif ?? recherche.erreur,
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
      `témoin ${temoinPresent} (${recherche.pages} page(s) parcourue(s), ` +
      `parcours ${recherche.exhaustif ? "COMPLET" : `INCOMPLET — ${recherche.motif ?? recherche.erreur ?? "?"}`}) · ` +
      `colonne publiée ${colonnePubliee} · ` +
      `status ${status.code} (verdict ${statusVerdict ?? "ILLISIBLE"}) · appliquées ${applique}`,
  );
  exit(verdict.code, `CAUSE=${verdict.cause} — ${verdict.detail}`);
}

// Ne s'exécute QUE lancé directement : l'auto-contrôle importe `judge` sans
// vouloir monter quoi que ce soit — un module qui agit à l'import rendrait son
// propre contrôle impossible.
if (process.argv[1]?.endsWith("gate-migration.mjs")) {
  await principal();
}
