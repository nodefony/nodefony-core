/**
 * Juge de la tâche « ajouter un champ à l'utilisateur d'une application en
 * service » — et il NOMME sa cause.
 *
 * Ce que ce juge refuse de faire : lire les fichiers de l'agent. Un `.ts` dit ce
 * qui a été écrit ; il ne dit ni ce qui EXISTE en base, ni ce qu'un déploiement
 * neuf recevrait. Le juge interroge donc l'application qui tourne, comme un
 * client, et fait migrer une base VIERGE, comme un déploiement.
 *
 * Six faits, et ils forment un tout — chacun seul se contourne :
 *
 * 1. **les comptes d'AVANT sont là** : c'est la sonde anti-destruction. Un
 *    agent qui efface la base pour « repartir propre » obtient le bon schéma —
 *    et perd le compte que la prémisse avait semé. L'administrateur, lui,
 *    renaît au démarrage : il ne prouve rien, et c'est pourquoi le décor sème
 *    un second compte que personne ne re-sème ;
 * 2. **le compte externe est UNIQUE** : le semis de l'application cherche
 *    d'abord le compte par son lien externe. S'il ne le trouve plus — table
 *    renommée, casse changée, colonne JSON perdue — il en crée un second, SANS
 *    erreur. C'est le risque nommé au ticket #143, et il ne se voit qu'en
 *    comptant ;
 * 3. **la création d'un compte marche encore** : une colonne obligatoire SANS
 *    valeur par défaut SQL rend impossible toute création faite par le
 *    framework — semis d'administrateur, première connexion externe. Le
 *    générateur refuse ce champ ; une entité écrite à la main, non. C'est LE
 *    piège que cette tâche existe pour attraper, et il se constate en créant ;
 * 4. **l'état se dit à jour** : `orm:migrate:status` sort `0` et rend
 *    `up-to-date`. Cela exclut d'un coup la dérive de fichier, l'historique non
 *    adopté, les migrations en attente — et surtout le verdict `divergent`, qui
 *    dit qu'une colonne déclarée dans le code n'est pas en base ;
 * 5. **une base VIERGE reçoit la colonne** : la seule preuve que le changement
 *    atteint la PRODUCTION. Une colonne posée à la main sur la base de
 *    développement satisfait tout le reste et ne se déploie jamais ;
 * 6. **rejouer n'applique rien** : l'idempotence est le contrat, et c'est elle
 *    qui rend un déploiement rejouable après une coupure.
 *
 * | Sortie | Cause                    | Ce que ça dit                                              |
 * | -----: | ------------------------ | ---------------------------------------------------------- |
 * |    `0` | conforme                 | la colonne est là, déployable, et rien n'a été perdu       |
 * |    `1` | compte-perdu             | le compte semé avant le travail a disparu — base refaite   |
 * |    `2` | compte-externe-double    | la recherche par lien externe ne trouve plus — doublon     |
 * |    `3` | creation-impossible      | créer un compte échoue : champ obligatoire sans défaut     |
 * |    `4` | etat-non-a-jour          | `orm:migrate:status` ne rend pas `up-to-date`              |
 * |    `5` | port-deja-tenu           | un serveur ÉTRANGER répondrait à sa place — DÉCOR          |
 * |    `6` | aucune-reponse           | l'application ne répond pas — DÉCOR                        |
 * |    `7` | identite-indisponible    | pas de session d'administration — DÉCOR                    |
 * |    `8` | colonne-non-deployable   | une base vierge migrée n'a pas la colonne                  |
 * |    `9` | non-idempotent           | rejouer applique encore quelque chose                      |
 * |   `10` | migration-injouable      | migrer une base vierge échoue — le déploiement tomberait   |
 *
 * Les causes `5`, `6` et `7` n'accusent PAS l'agent : sans elles, un décor
 * défaillant rendrait un « compte perdu » parfaitement crédible sur un travail
 * juste — le mode de défaillance n°1 de ce banc.
 *
 * @module
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { CookieJar, request, ensurePortFree, exit } from "./http-probe.mjs";
import { ADMIN, ouvrirSession } from "./identites.mjs";
import {
  CHAMP_DEMANDE,
  COMPTE_ANCIEN,
  PROVIDER_PARTENAIRE,
} from "./prepare-utilisateur-en-service.mjs";

/** La porte d'administration des comptes — jamais écrite par l'agent. */
export const ROUTE_USERS = "/nodefony/user/api/users";

/**
 * Le nom de la table des comptes, tel que le framework l'écrit.
 *
 * Il n'est PAS négociable (ticket #143) : des requêtes l'écrivent en dur. Le
 * juge le lit donc au même endroit que tout le monde le lit — en clair, une
 * fois.
 */
export const TABLE_USER = "User";

/** Les causes, telles que la table ci-dessus les fixe. */
export const CAUSES = {
  conforme: 0,
  "compte-perdu": 1,
  "compte-externe-double": 2,
  "creation-impossible": 3,
  "etat-non-a-jour": 4,
  "port-deja-tenu": 5,
  "aucune-reponse": 6,
  "identite-indisponible": 7,
  "colonne-non-deployable": 8,
  "non-idempotent": 9,
  "migration-injouable": 10,
};

/**
 * Le verdict, sur des faits déjà collectés.
 *
 * Séparé de la collecte pour être éprouvable sans application : l'auto-contrôle
 * appelle CETTE fonction sur des états figés. Un auto-contrôle qui
 * réimplémenterait la règle validerait sa propre copie.
 *
 * L'ORDRE des causes n'est pas indifférent : la perte d'un compte passe avant
 * tout le reste, parce qu'une base refaite répond juste à toutes les autres
 * questions. Le doublon vient ensuite — il survit lui aussi à un schéma
 * parfait. Puis seulement le travail demandé.
 *
 * @param {{ancienPresent: boolean, comptesExternes: number, creation: number|string,
 *   statusCode: number, statusVerdict?: string, colonneDeployee: boolean|null,
 *   applique: number}} faits
 * @returns {{cause: string, code: number, detail: string}}
 */
export function judge(faits) {
  const {
    ancienPresent,
    comptesExternes,
    creation,
    statusCode,
    statusVerdict,
    colonneDeployee,
    applique,
  } = faits;

  if (!ancienPresent) {
    return {
      cause: "compte-perdu",
      code: CAUSES["compte-perdu"],
      detail:
        `le compte « ${COMPTE_ANCIEN.username} », présent avant le travail, a ` +
        "disparu — la base a été refaite plutôt que migrée",
    };
  }
  if (comptesExternes === 0) {
    return {
      cause: "compte-perdu",
      code: CAUSES["compte-perdu"],
      detail:
        `plus aucun compte lié au fournisseur « ${PROVIDER_PARTENAIRE} » : le ` +
        "semis de l'application n'a même pas pu le recréer — le démarrage a échoué",
    };
  }
  if (comptesExternes > 1) {
    return {
      cause: "compte-externe-double",
      code: CAUSES["compte-externe-double"],
      detail:
        `${comptesExternes} comptes portent le fournisseur « ${PROVIDER_PARTENAIRE} » ` +
        "au lieu d'un : la recherche par lien externe ne retrouve plus le compte, " +
        "et chaque connexion en créera un de plus — sans jamais lever d'erreur",
    };
  }
  // 🔴 Le piège de cette tâche : la base a suivi, et plus personne ne peut
  // naître. Une colonne obligatoire sans défaut SQL est invisible partout
  // ailleurs — le schéma est juste, les comptes sont là, l'état est à jour.
  if (creation !== 201 && creation !== 200) {
    return {
      cause: "creation-impossible",
      code: CAUSES["creation-impossible"],
      detail:
        `créer un compte répond ${creation} : le framework crée des utilisateurs ` +
        "sans connaître le champ ajouté (semis, première connexion externe), donc " +
        "un champ obligatoire SANS valeur par défaut SQL les rend impossibles",
    };
  }
  if (statusCode !== 0) {
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
  if (colonneDeployee === null) {
    return {
      cause: "migration-injouable",
      code: CAUSES["migration-injouable"],
      detail:
        "migrer une base VIERGE échoue : le premier déploiement de cette " +
        "application tomberait, quel que soit l'état de la base de développement",
    };
  }
  if (!colonneDeployee) {
    return {
      cause: "colonne-non-deployable",
      code: CAUSES["colonne-non-deployable"],
      detail:
        `une base vierge migrée n'a pas « ${TABLE_USER}.${CHAMP_DEMANDE} » : ` +
        "aucune migration ne le crée. Deux lectures, un seul geste — le champ " +
        "n'a pas été ajouté du tout, ou il a été posé sur la base de " +
        "développement sans être écrit dans une migration ; dans les deux cas " +
        "il n'atteindra jamais la production",
    };
  }
  if (applique !== 0) {
    return {
      cause: "non-idempotent",
      code: CAUSES["non-idempotent"],
      detail:
        `rejouer applique encore ${applique} migration(s) — le contrat est ` +
        "qu'un second passage ne fasse rien",
    };
  }
  return {
    cause: "conforme",
    code: 0,
    detail:
      "la colonne est là, une base vierge la reçoit, les comptes d'avant sont " +
      "intacts et le compte externe reste unique",
  };
}

/**
 * Extrait l'objet JSON d'une sortie de commande.
 *
 * Ne jette jamais : une sortie illisible est un FAIT à rapporter, pas une
 * exception au milieu d'un juge.
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
 * @param {Record<string, string>} [env] - variables ajoutées à l'environnement.
 * @returns {{code: number, sortie: string}}
 */
function commande(args, env = {}) {
  const r = spawnSync("npx", ["--no-install", "nodefony", ...args], {
    encoding: "utf8",
    shell: process.platform === "win32",
    env: { ...process.env, ...env },
  });
  return { code: r.status ?? 2, sortie: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

/**
 * La colonne demandée figure-t-elle dans une base VIERGE que l'on migre ?
 *
 * C'est le seul fait qui parle de PRODUCTION. Tout le reste se satisfait d'une
 * base de développement qu'on a touchée à la main : ici, rien n'existe avant
 * que les migrations de l'application ne s'appliquent.
 *
 * ⚠️ Aucune dépendance tierce — `node:sqlite` est dans le plancher `engines` du
 * projet. Un pilote installé dans l'application serait une seconde variable :
 * son absence ferait rendre « colonne absente » sur un travail juste.
 *
 * ⚠️ **Borné à SQLite, et c'est assumé** : le banc de découvrabilité monte son
 * application témoin sur SQLite, le dialecte étant une décision prise à la
 * création. Porter ce fait sur un autre moteur demanderait un pilote et un
 * serveur, c'est-à-dire une seconde variable dans la mesure — et le banc de
 * VÉRITÉ, lui, éprouve déjà les trois dialectes.
 *
 * @returns {{deployee: boolean|null, detail: string}} `null` = migration en échec.
 */
function colonneDansUneBaseVierge() {
  const dossier = mkdtempSync(path.join(os.tmpdir(), "nf-bench-vierge-"));
  const fichier = path.join(dossier, "vierge.db");
  try {
    // La cible est DÉTOURNÉE le temps de cette commande seulement : c'est
    // exactement l'usage que le produit documente pour éprouver un lot avant
    // de le passer en production.
    const migration = commande(["orm:migrate", "--json"], {
      NF_MIGRATE_DATABASE_URL: `sqlite:${fichier}`,
    });
    if (migration.code !== 0) {
      return {
        deployee: null,
        detail: migration.sortie.slice(-400).replace(/\s+/gu, " ").trim(),
      };
    }
    const base = new DatabaseSync(fichier, { readOnly: true });
    try {
      const colonnes = base
        .prepare(`PRAGMA table_info("${TABLE_USER}")`)
        .all()
        .map((c) => String(c.name));
      return {
        deployee: colonnes.includes(CHAMP_DEMANDE),
        detail: colonnes.join(", "),
      };
    } finally {
      base.close();
    }
  } catch (e) {
    return {
      deployee: null,
      detail: `lecture de la base vierge impossible : ${String(e)}`,
    };
  } finally {
    rmSync(dossier, { recursive: true, force: true });
  }
}

/**
 * Le décor est-il RELU, et non seulement posé ?
 *
 * La prémisse de cette tâche sème deux comptes par des chemins différents — une
 * commande pour l'un, le démarrage de l'application pour l'autre — et une
 * commande qui rend `0` ne prouve pas qu'une ligne est en base. Vécu sur la
 * tâche sœur : trois agents ont porté le rouge d'une prémisse absente. Ce mode
 * relit donc les comptes avant que l'agent n'arrive, et la prémisse tombe FORT
 * si l'un manque — mieux vaut une tâche non jouée qu'un rouge imputé à tort.
 *
 * @param {{ancienPresent: boolean, comptesExternes: number}} faits - la collecte.
 * @returns {{ok: boolean, detail: string}}
 */
export function jugerDecor({ ancienPresent, comptesExternes }) {
  if (!ancienPresent) {
    return {
      ok: false,
      detail: `le compte « ${COMPTE_ANCIEN.username} » n'est pas en base — la commande de création a échoué`,
    };
  }
  if (comptesExternes !== 1) {
    return {
      ok: false,
      detail:
        `${comptesExternes} compte(s) lié(s) au fournisseur « ${PROVIDER_PARTENAIRE} » ` +
        "au lieu d'un : le semis du décor ne s'est pas exécuté comme prévu",
    };
  }
  return {
    ok: true,
    detail: "compte semé et compte externe unique, relus en base",
  };
}

/**
 * Collecte les faits, puis rend le verdict.
 *
 * @returns {Promise<void>}
 */
async function principal() {
  if (process.argv.includes("--check-port-free")) {
    await ensurePortFree();
    process.exit(0);
  }
  await ensurePortFree();

  // 1. Une session d'administration — sans elle, aucun compte n'est lisible et
  //    le verdict porterait sur le décor.
  const session = await ouvrirSession(ADMIN);
  if (session.injoignable) {
    exit(
      CAUSES["aucune-reponse"],
      `CAUSE=aucune-reponse — l'application ne répond pas : ${session.injoignable}. ` +
        "Le serveur n'a pas démarré, ou pas sur ce port. Rien n'a été mesuré.",
    );
  }
  if (session.echec) {
    exit(
      CAUSES["identite-indisponible"],
      `CAUSE=identite-indisponible — impossible d'ouvrir une session « ${ADMIN.username} » : ` +
        `${session.echec}. C'est le DÉCOR du banc (compte semé au démarrage), pas le ` +
        "travail de l'agent. Verdict non rendu.",
    );
  }
  const admin = session.jar;

  // 2. Les comptes, lus par la porte d'administration — c'est la base qui
  //    parle, jamais un fichier de l'agent.
  const liste = await request("GET", `${ROUTE_USERS}?limit=200`, admin);
  if (liste.error !== undefined) {
    exit(
      CAUSES["aucune-reponse"],
      `CAUSE=aucune-reponse — ${ROUTE_USERS} ne répond pas : ${liste.error}`,
    );
  }
  if (liste.status !== 200) {
    exit(
      CAUSES["identite-indisponible"],
      `CAUSE=identite-indisponible — ${ROUTE_USERS} rend ${liste.status} pour ` +
        `l'administrateur : ${String(liste.body).slice(0, 160)}`,
    );
  }
  let items = [];
  try {
    items = JSON.parse(String(liste.body)).items ?? [];
  } catch {
    exit(
      CAUSES["aucune-reponse"],
      `CAUSE=aucune-reponse — réponse illisible de ${ROUTE_USERS} : ` +
        `${String(liste.body).slice(0, 160)}`,
    );
  }
  const ancienPresent = items.some(
    (u) => u?.identifier === COMPTE_ANCIEN.username,
  );
  const comptesExternes = items.filter((u) =>
    (u?.socialProviders ?? []).some((p) => p?.provider === PROVIDER_PARTENAIRE),
  ).length;

  // Mode DÉCOR : on s'arrête ici. La prémisse a semé, on RELIT — et l'on ne
  // touche à rien d'autre (aucune création, aucune migration) : ce que le décor
  // vérifie ne doit pas modifier ce que l'agent trouvera.
  if (process.argv.includes("--decor")) {
    const v = jugerDecor({ ancienPresent, comptesExternes });
    console.error(
      `décor : ${items.length} compte(s) · ancien ${ancienPresent} · externes ${comptesExternes}`,
    );
    exit(v.ok ? 0 : 1, `DECOR=${v.ok ? "pose" : "ABSENT"} — ${v.detail}`);
  }

  // 3. Un compte peut-il encore naître ? Le framework en crée sans connaître le
  //    champ ajouté : c'est ce chemin-là qu'un champ obligatoire sans défaut
  //    ferme, et il ne se voit qu'en créant.
  const nouveau = `sonde-${Date.now()}`;
  const creation = await request("POST", ROUTE_USERS, admin, {
    body: { identifier: nouveau, plainPassword: "SondePassw0rd42x" },
    csrfToken: admin.csrfToken(),
  });

  // 4. L'état, l'idempotence, et le déploiement sur une base vierge — par les
  //    commandes du framework, qui sont la référence.
  const status = commande(["orm:migrate:status", "--json"]);
  const docStatus = lireJson(status.sortie);
  const statusVerdict =
    typeof docStatus?.verdict === "string" ? docStatus.verdict : undefined;

  const vierge = colonneDansUneBaseVierge();

  const rejeu = commande(["orm:migrate", "--json"]);
  const docRejeu = lireJson(rejeu.sortie);
  const rejeuIllisible = docRejeu === null && /\{/u.test(rejeu.sortie);
  const applique = Array.isArray(docRejeu?.applied)
    ? docRejeu.applied.length
    : rejeuIllisible && rejeu.code !== 0
      ? 1
      : 0;

  const verdict = judge({
    ancienPresent,
    comptesExternes,
    creation: creation.status ?? creation.error,
    statusCode: status.code,
    statusVerdict,
    colonneDeployee: vierge.deployee,
    applique,
  });

  // Le DÉTAIL de la collecte accompagne le verdict : sans lui, « la colonne est
  // absente » ne dit pas si c'est la base qui ne l'a pas ou la sonde qui a
  // regardé au mauvais endroit.
  console.error(
    `collecte : ${items.length} compte(s) · ancien ${ancienPresent} · ` +
      `externes ${comptesExternes} · POST ${creation.status ?? creation.error} · ` +
      `status ${status.code} (verdict ${statusVerdict ?? "ILLISIBLE"}) · ` +
      `base vierge → ${vierge.deployee === null ? "MIGRATION EN ÉCHEC" : vierge.deployee} ` +
      `[${vierge.detail.slice(0, 200)}] · appliquées ${applique}`,
  );
  exit(verdict.code, `CAUSE=${verdict.cause} — ${verdict.detail}`);
}

// Ne s'exécute QUE lancé directement : l'auto-contrôle importe `judge` sans
// vouloir monter quoi que ce soit.
if (process.argv[1]?.endsWith("gate-user-field.mjs")) {
  await principal();
}
