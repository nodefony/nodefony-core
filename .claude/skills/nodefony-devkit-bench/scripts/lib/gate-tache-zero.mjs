/**
 * Juge de la TÂCHE 0 — l'agent a-t-il créé une application qui TIENT ?
 *
 * Toutes les autres tâches partent d'une application que le décor a fabriquée.
 * Ici l'agent part d'un dossier VIDE : il choisit le contenu, répond au
 * questionnaire, installe, puis travaille. Ce juge est donc le seul à devoir
 * d'abord TROUVER ce qu'il va juger.
 *
 * 🔴 **Il sépare QUATRE issues que rien d'autre ne distingue**, et c'est sa
 * raison d'être. Les confondre produit le pire verdict du banc : un rouge
 * crédible sur un travail juste, ou un vert sur une application cassée.
 *
 * | Issue                                  | Ce qui la constate                                   |
 * | -------------------------------------- | ---------------------------------------------------- |
 * | **A** — ça marche                      | la ressource répond à qui a le rôle, refuse l'anonyme |
 * | **B** — juste mais INAPPELABLE         | elle refuse AUSSI le porteur du rôle                 |
 * | **C** — fait, mais a CASSÉ l'existant  | les tests LIVRÉS par le générateur ne passent plus   |
 * | **D** — n'a pas abouti                 | pas d'application, ou elle ne démarre pas            |
 *
 * L'issue **C** est celle qu'on n'aurait pas vue. Le 2026-09-12, sur l'énoncé
 * « un visiteur non connecté n'accède à rien », un agent a fermé la zone `/api`
 * ENTIÈRE — geste que le gabarit lui RECOMMANDE — emportant les routes de
 * démonstration, le canal temps réel et les dix tests de bout en bout livrés
 * avec l'application. Il ne les a pas réparés et ne les mentionne pas : de son
 * point de vue, la tâche est faite. Un juge qui ne distingue pas cette issue
 * imputerait au framework une conséquence de l'ÉNONCÉ.
 *
 * L'issue **B** est l'échec du 2026-09-10 : 33 minutes sur une route protégée
 * qu'aucune identité ne pouvait appeler. Le code était juste ; il était
 * inatteignable.
 *
 * | Sortie | Cause                         | Qui est en cause                    |
 * | -----: | ----------------------------- | ----------------------------------- |
 * |    `0` | conforme                      | — (issue A)                         |
 * |    `1` | aucune-application            | l'AGENT (issue D)                   |
 * |    `2` | application-ambigue           | l'INSTRUMENT — verdict non rendu    |
 * |    `3` | application-ne-demarre-pas    | l'AGENT (issue D)                   |
 * |    `4` | aucune-reponse                | le DÉCOR — l'app ne répond pas      |
 * |      | (rendu AUSSI quand la ressource ne répond pas du tout : une requête
 * |      | qui échoue n'est pas une route absente — voir `classerIssue`)      |
 * |    `5` | tests-livres-casses           | l'AGENT (issue C)                   |
 * |    `6` | ressource-absente             | l'AGENT (issue D partielle)         |
 * |    `7` | identite-admin-indisponible   | le DÉCOR — verdict non rendu        |
 * |    `8` | ressource-inappelable         | l'AGENT (issue B)                   |
 * |    `9` | identite-temoin-indisponible  | le DÉCOR — verdict non rendu        |
 * |   `10` | ressource-ouverte-a-l-anonyme | l'AGENT — rien ne protège           |
 *
 * Les codes `4`, `7` et `9` sont ceux d'`etablirIdentites` : ils ne se
 * renumérotent pas ici, sous peine que `8` désigne le décor chez l'un et une
 * faute chez l'autre — ce que l'imputation figée du banc existe pour éviter.
 *
 * ⚠️ **Le refus opposé à l'anonyme vaut 401 OU 403, et les deux sont justes** —
 * il dépend de la zone où l'agent a rangé sa route. Exiger l'un recalerait un
 * agent selon un choix qu'on ne mesure pas. Ce qui se mesure est le REFUS.
 *
 * @module
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { CookieJar, request, exit } from "./http-probe.mjs";
import {
  estRefus,
  estSucces,
  etablirIdentites,
  repondreArgsTemoin,
} from "./identites.mjs";
import { resoudreAppGeneree } from "./tache-zero.mjs";
import { needsShell } from "./exec-portable.mjs";

/**
 * La ressource que l'énoncé demande — le juge ne présume d'aucun autre chemin.
 *
 * L'énoncé dit « une ressource REST message » ; le générateur, sur
 * `create entity Message`, monte `/api/messages`. Le pluriel est la convention
 * du produit, pas une supposition du juge.
 */
const CIBLE = "/api/messages";

/**
 * Les accès disque réels — l'injection sert le selftest, pas la production.
 */
const IO = {
  listerDossiers: (d) => {
    try {
      return readdirSync(d).filter((e) => {
        try {
          return statSync(path.join(d, e)).isDirectory();
        } catch {
          return false;
        }
      });
    } catch {
      return [];
    }
  },
  lirePackage: (d) => {
    const f = path.join(d, "package.json");
    if (!existsSync(f)) return null;
    try {
      return JSON.parse(readFileSync(f, "utf8"));
    } catch {
      // Un manifeste illisible n'est pas une application : le dire par `null`
      // plutôt que lever, sinon le juge meurt avant d'avoir nommé sa cause.
      return null;
    }
  },
};

/**
 * Les tests LIVRÉS par le générateur — jamais ceux que l'agent a écrits.
 *
 * C'est toute la finesse de l'issue C : l'agent peut très bien écrire des tests
 * verts pour son propre travail tout en ayant cassé ceux qui existaient. On ne
 * juge donc QUE les fichiers présents au premier commit — celui que `create app`
 * pose lui-même (« 🌱 git : repo git initialisé + premier commit »).
 *
 * Cette frontière est un cadeau du produit : elle est exacte, et elle n'a pas
 * eu à être fabriquée par le banc.
 *
 * @param {string} appDir - le dossier de l'application.
 * @returns {{ok: boolean, fichiers: string[], motif: string}}
 */
export function testsLivresDuPremierCommit(appDir) {
  const git = (...args) =>
    spawnSync("git", args, {
      cwd: appDir,
      encoding: "utf8",
      shell: needsShell("git"),
    });
  const premier = git("rev-list", "--max-parents=0", "HEAD");
  if (premier.status !== 0 || !premier.stdout.trim()) {
    return {
      ok: false,
      fichiers: [],
      motif:
        "pas de dépôt git dans l'application — `create app` en pose un avec un " +
        "premier commit ; sans lui, on ne peut pas distinguer le LIVRÉ de l'AJOUTÉ",
    };
  }
  const sha = premier.stdout.trim().split("\n")[0];
  const liste = git("ls-tree", "-r", "--name-only", sha);
  if (liste.status !== 0) {
    return {
      ok: false,
      fichiers: [],
      motif: "impossible de lire le premier commit",
    };
  }
  const fichiers = liste.stdout
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /\.(test|spec)\.[cm]?[jt]s$/u.test(l));
  return { ok: true, fichiers, motif: "" };
}

/**
 * Classe les faits en UNE issue — fonction PURE, c'est elle qui porte la règle.
 *
 * Séparée de la collecte pour être éprouvable sans monter 300 Mo de décor : le
 * banc a déjà payé des juges dont la règle ne se vérifiait qu'en les jouant.
 *
 * L'ordre des contrôles EST la règle : on ne peut pas reprocher une ressource
 * inappelable à qui n'a pas d'application, ni une protection manquante à qui a
 * cassé la suite livrée. Chaque issue suppose que les précédentes sont passées.
 *
 * @param {{
 *   resolution: {ok: boolean, cause?: string, detail?: string},
 *   demarre: boolean|null,
 *   testsLivres: {lances: boolean, verts: boolean, nb: number, sortie?: string}|null,
 *   statutAnonyme: number|null,
 *   statutAdmin: number|null,
 * }} faits - ce qui a été CONSTATÉ, jamais déduit.
 * @returns {{code: number, cause: string, detail: string, issue: string}}
 */
export function classerIssue(faits) {
  const { resolution, demarre, testsLivres, statutAnonyme, statutAdmin } =
    faits;

  if (!resolution.ok) {
    return resolution.cause === "application-ambigue"
      ? {
          code: 2,
          cause: "application-ambigue",
          issue: "instrument",
          detail: `${resolution.detail} — l'INSTRUMENT ne sait pas quoi juger, pas l'agent`,
        }
      : {
          code: 1,
          cause: "aucune-application",
          issue: "D",
          detail: resolution.detail ?? "aucune application trouvée",
        };
  }

  if (demarre === false) {
    return {
      code: 3,
      cause: "application-ne-demarre-pas",
      issue: "D",
      detail:
        "l'application a été créée mais ne démarre pas — rien de ce qui suit " +
        "n'est mesurable",
    };
  }

  // 🔴 L'issue C se juge AVANT la protection : un agent qui a cassé la suite
  // livrée a échoué, même si sa propre route est impeccable. L'inverse
  // laisserait passer un vert sur une application amputée.
  // Un fichier livré qu'AUCUNE suite n'a joué ne dit rien — ni vert, ni rouge.
  // Le taire reviendrait à compter un skip pour une preuve, exactement ce que
  // ce dépôt paie depuis longtemps ailleurs.
  if (testsLivres && testsLivres.lances && testsLivres.nonJoues?.length) {
    return {
      code: 2,
      cause: "tests-livres-non-joues",
      issue: "instrument",
      detail:
        `${testsLivres.nonJoues.length} test(s) LIVRÉS n'ont été joués par aucune ` +
        `suite (${testsLivres.nonJoues.join(", ")}) : l'issue C n'est pas ` +
        "mesurable, et un fichier non joué ne vaut pas un fichier vert",
    };
  }

  if (testsLivres && testsLivres.lances && !testsLivres.verts) {
    return {
      code: 5,
      cause: "tests-livres-casses",
      issue: "C",
      detail:
        `les ${testsLivres.nb} test(s) LIVRÉS par le générateur ne passent plus : ` +
        "l'agent a fait ce qu'on demandait ET cassé l'existant en le faisant " +
        `(${(testsLivres.sortie ?? "").slice(0, 200)})`,
    };
  }

  // 🔴 « Rien n'a répondu » et « la route n'existe pas » ne valent PAS pareil,
  // et les confondre fabrique un rouge OPPOSABLE à l'agent pour une panne de
  // décor. Vécu ici : le juge a rendu « /api/messages ne répond pas (404) — la
  // ressource n'a pas été montée » sur une application où `inspect routes`
  // montre bien `/api/messages`, et où un curl rend 401. La requête avait
  // échoué (`null`), le message affichait « 404 », et l'agent était accusé.
  //
  // C'est le mode de défaillance n°1 de ce banc, et il vient de frapper dans le
  // juge écrit POUR le séparer en quatre issues.
  if (statutAnonyme === null) {
    return {
      code: 4,
      cause: "aucune-reponse",
      issue: "decor",
      detail:
        `aucune réponse sur ${CIBLE} — l'application ne répond pas, ou pas sur ` +
        "ce port. Rien n'a été mesuré ; ce n'est PAS un verdict sur l'agent.",
    };
  }

  if (statutAnonyme === 404) {
    return {
      code: 6,
      cause: "ressource-absente",
      issue: "D",
      detail: `${CIBLE} rend 404 — la ressource demandée n'a pas été montée`,
    };
  }

  if (!estRefus(statutAnonyme)) {
    return {
      code: 10,
      cause: "ressource-ouverte-a-l-anonyme",
      issue: "A-manquée",
      detail:
        `un visiteur non connecté obtient ${statutAnonyme} sur ${CIBLE} : ` +
        "rien ne protège la ressource",
    };
  }

  if (!estSucces(statutAdmin)) {
    return {
      code: 8,
      cause: "ressource-inappelable",
      issue: "B",
      detail:
        `la ressource refuse AUSSI le porteur du rôle (${statutAdmin} sur ${CIBLE}) : ` +
        "le code est peut-être juste, il est inatteignable — c'est l'échec du " +
        "2026-09-10, 33 minutes sur une route qu'aucune identité ne pouvait appeler",
    };
  }

  return {
    code: 0,
    cause: "conforme",
    issue: "A",
    detail:
      "application créée, démarrée, tests livrés intacts, ressource servie à " +
      "qui porte le rôle et refusée à l'anonyme",
  };
}

/**
 * Joue les tests LIVRÉS avec la configuration que l'application leur destine.
 *
 * Le gabarit sépare deux suites : `vitest.config.ts` pour l'ordinaire,
 * `vitest.e2e.config.ts` pour le bout en bout — et la première EXCLUT la
 * seconde. Un fichier e2e passé à un `vitest run` nu n'est pas joué, et rien ne
 * le dit : le rapport ne le mentionne ni comme réussi ni comme sauté.
 *
 * On lance donc les deux suites, et l'on CONSTATE, pour chaque fichier demandé,
 * qu'il apparaît dans une sortie. Ce qui n'apparaît nulle part est rendu dans
 * `nonJoues` — un fichier dont on ne sait rien ne vaut pas un fichier vert.
 *
 * @param {string} appDir - le dossier de l'application.
 * @param {string[]} fichiers - les tests livrés au premier commit.
 * @returns {{verts: boolean, sortie: string, nonJoues: string[]}}
 */
export function lancerTestsLivres(appDir, fichiers) {
  // 🔴 ARRÊTER le serveur d'abord. La suite de bout en bout livrée démarre le
  // SIEN ; tant que celui de la gate tient les ports, elle rend « No test files
  // found » et sort en 1 sans avoir joué une ligne. Mesuré : les mêmes tests
  // rendent 3 ÉCHECS une fois les ports rendus, et 0 test joué quand ils sont
  // pris — deux verdicts opposés pour la même application. Les statuts HTTP
  // ayant déjà été collectés, l'arrêt ne coûte rien.
  spawnSync("npx", ["--no-install", "nodefony", "stop"], {
    cwd: appDir,
    encoding: "utf8",
    shell: needsShell("npx"),
    timeout: 60 * 1000,
  });

  const configs = [null, "vitest.e2e.config.ts"];
  let sortie = "";
  let rouge = false;
  const joues = new Set();
  for (const config of configs) {
    if (config && !existsSync(path.join(appDir, config))) continue;
    const args = ["vitest", "run"];
    if (config) args.push("-c", config);
    const r = spawnSync("npx", [...args, ...fichiers], {
      cwd: appDir,
      encoding: "utf8",
      shell: needsShell("npx"),
      timeout: 10 * 60 * 1000,
    });
    const texte = `${r.stderr ?? ""}\n${r.stdout ?? ""}`.trim();
    sortie += `${texte}\n`;
    // 🔴 Ce qu'une suite a JOUÉ se relève SUR SA PROPRE sortie, jamais sur la
    // concaténation : un fichier joué par la suite ordinaire masquait sinon son
    // absence de la suite e2e, et `nonJoues` revenait vide alors que rien
    // n'avait tourné.
    for (const f of fichiers) {
      if (texte.includes(path.basename(f))) joues.add(f);
    }
    // Une suite qui ne trouve AUCUN de ses fichiers sort en échec sans qu'un
    // test ait failli : ce n'est pas un rouge du code. Ce n'est pas un vert non
    // plus — les fichiers qu'elle devait jouer restent alors « non joués », et
    // c'est `nonJoues` qui le porte.
    if (r.status !== 0 && !/No test files found/iu.test(texte)) rouge = true;
  }
  const nonJoues = fichiers.filter((f) => !joues.has(f));
  return { verts: !rouge, sortie: sortie.trim(), nonJoues };
}

/**
 * Collecte les faits et rend le verdict.
 *
 * @returns {Promise<void>}
 */
async function main() {
  const racine = process.cwd();
  const resolution = resoudreAppGeneree(racine, IO);
  if (!resolution.ok) {
    const v = classerIssue({
      resolution,
      demarre: null,
      testsLivres: null,
      statutAnonyme: null,
      statutAdmin: null,
    });
    exit(v.code, `CAUSE=${v.cause} — ${v.detail}`);
  }

  const appDir = resolution.dir;

  // 🔴 L'ORDRE DE COLLECTE n'est PAS l'ordre de CLASSEMENT.
  //
  // Les statuts se mesurent D'ABORD, parce que la suite de bout en bout livrée
  // gère son PROPRE serveur : elle démarre le sien, puis l'arrête — emportant
  // celui que la gate venait de lancer. Mesuré : le juge, ayant appris à jouer
  // les e2e, s'est retrouvé face à un `ECONNREFUSED` et a rendu « aucune
  // réponse » sur une application parfaitement saine.
  //
  // Le classement, lui, garde son ordre : l'issue C se juge AVANT la
  // protection (voir `classerIssue`). Collecter et classer sont deux gestes.
  // Les identités — sortent en 4 / 7 / 9 si le DÉCOR n'a pas pu les donner.
  const { admin } = await etablirIdentites();
  // 🔴 Un jar VIDE, jamais `null` : `request` fait `jar.header()`, et un `null`
  // y lève une exception que le `catch` transforme en « aucune réponse ». Le
  // juge accusait alors le décor d'une panne qui était la sienne, sur une
  // application qui répondait parfaitement — mesuré, 401 au curl au même
  // instant. C'est le patron de `gate-secure-route.mjs`, repris à l'identique.
  const anonyme = await request("GET", CIBLE, new CookieJar()).catch(
    () => null,
  );
  const avecRole = await request("GET", CIBLE, admin).catch(() => null);

  // Les tests LIVRÉS — issue C. Lancés SÉPARÉMENT de ceux de l'agent.
  const livres = testsLivresDuPremierCommit(appDir);
  let testsLivres = null;
  if (livres.ok && livres.fichiers.length > 0) {
    // 🔴 Chaque fichier avec LA configuration que l'application lui destine.
    //
    // Un `vitest run <fichiers>` nu ne joue que ceux que la config PAR DÉFAUT
    // accepte : le gabarit range les tests de bout en bout sous
    // `vitest.e2e.config.ts` (script `test:e2e`), et la config ordinaire les
    // EXCLUT. Mesuré ici : quatre fichiers livrés demandés, **deux exécutés**,
    // et les deux absents étaient précisément les e2e — ceux qui frappent le
    // serveur en anonyme, donc les seuls que l'issue C fait tomber. Le juge
    // concluait « tests livrés intacts » sur une application dont la zone
    // `/api` venait d'être fermée en entier : le cas RÉEL du 2026-09-12,
    // invisible à celui qui existe pour le voir.
    //
    // Un fichier non exécuté n'est donc pas un fichier vert : c'est un fichier
    // dont on ne sait rien, et le juge le DIT plutôt que de compter un skip
    // pour une preuve.
    const r = lancerTestsLivres(appDir, livres.fichiers);
    testsLivres = {
      lances: true,
      verts: r.verts,
      nb: livres.fichiers.length,
      sortie: r.sortie,
      nonJoues: r.nonJoues,
    };
  } else {
    // Ne PAS inventer un verdict : si la frontière livré/ajouté n'est pas
    // lisible, l'issue C n'est pas mesurable et on le dit plutôt que de la
    // compter verte. Un contrôle qui ne peut pas mesurer doit se taire.
    testsLivres = { lances: false, verts: true, nb: 0, sortie: livres.motif };
  }

  const verdict = classerIssue({
    resolution,
    demarre: true,
    testsLivres,
    statutAnonyme: anonyme?.status ?? null,
    statutAdmin: avecRole?.status ?? null,
  });

  if (verdict.code === 0) {
    console.log(`CAUSE=conforme — ${verdict.detail}`);
    process.exit(0);
  }
  exit(verdict.code, `CAUSE=${verdict.cause} — ${verdict.detail}`);
}

// Le drapeau du décor : le banc demande au juge les arguments de création du
// compte témoin, sans les recopier dans sa ligne de commande.
if (process.argv.includes("--temoin-args")) repondreArgsTemoin();

// 🔴 Le juge ne s'exécute que LANCÉ, jamais IMPORTÉ.
//
// Son auto-contrôle importe `classerIssue` — la règle pure — pour l'éprouver
// sans monter de décor. Sans cette garde, le simple import ferait partir une
// sonde réseau et le selftest jugerait une application qui n'existe pas.
// Le repère est le standard ESM, pas un drapeau maison : un drapeau s'oublie
// dans la ligne de commande du banc et le juge se tairait en production.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
