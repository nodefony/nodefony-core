/**
 * Juge de la tâche « protège une route » — il ATTAQUE, et il NOMME sa cause.
 *
 * Ce que la sonde de chaîne ne pouvait pas voir : la tâche vérifiait qu'un
 * `@IsGranted` APPARAISSE quelque part et que `npm test` — les tests écrits par
 * l'agent lui-même — soit vert. Un décorateur posé sur la mauvaise action, ou
 * une zone dont le motif ne couvre pas la route, PASSAIT. La sécurité était la
 * seule famille du banc dont le verdict reposait sur une présence de texte.
 *
 * Ici, trois identités frappent la même route, et c'est le CONTRASTE qui juge :
 *
 * | Identité | Attendu | Ce qu'un écart révèle                                  |
 * | -------- | ------- | ------------------------------------------------------ |
 * | anonyme  | refus   | la protection n'agit pas du tout                       |
 * | témoin   | refus   | la route exige une identité, mais aucun RÔLE           |
 * | admin    | 2xx     | la garde est là mais interdit aussi son destinataire   |
 *
 * Le témoin est l'identité qui porte l'information. Un refus opposé à
 * l'anonyme se gagne avec n'importe quelle zone du firewall — c'est gratuit.
 * Refuser quelqu'un d'AUTHENTIFIÉ qui n'a pas le rôle, et servir celui qui l'a,
 * ne s'obtient qu'avec une autorisation réellement branchée sur la route visée.
 *
 * | Sortie | Cause                        | Qui est en cause             |
 * | -----: | ---------------------------- | ---------------------------- |
 * |    `0` | conforme                     | —                            |
 * |    `1` | route-ouverte-a-l-anonyme    | l'AGENT — rien ne protège    |
 * |    `2` | role-non-discriminant        | l'AGENT — authentifié ≠ autorisé |
 * |    `3` | admin-refuse                 | l'AGENT — garde inatteignable |
 * |    `4` | aucune-reponse               | le DÉCOR — l'app ne répond pas |
 * |    `5` | port-deja-tenu               | le DÉCOR — serveur étranger  |
 * |    `6` | route-absente                | l'AGENT — rien n'a été monté |
 * |    `7` | identite-admin-indisponible  | le DÉCOR — verdict non rendu |
 * |    `8` | corps-inattendu              | l'AGENT — sert autre chose   |
 * |    `9` | identite-temoin-indisponible | le DÉCOR — verdict non rendu |
 * |   `10` | reponse-inattendue           | l'AGENT — ni refus ni succès |
 *
 * **Les causes `4`, `5`, `7` et `9` n'accusent PAS l'agent.** Un juge qui
 * confond « le décor n'a pas pu me donner d'identité » avec « l'agent a mal
 * protégé » produit le pire des verdicts : un rouge crédible sur un travail
 * juste. C'est le mode de défaillance n° 1 de ce banc, et il a déjà frappé
 * cinq fois.
 *
 * ⚠️ **Le refus opposé à l'anonyme vaut 401 OU 403, et les deux sont justes.**
 * Il dépend de la ZONE dans laquelle la route tombe : une aire qui liste
 * l'authentificateur `anonymous` délivre un jeton anonyme, l'autorisation le
 * refuse ensuite en 403 ; une aire qui ne le liste pas refuse dès
 * l'authentification en 401. Exiger 401 recalerait un agent selon l'endroit où
 * il a rangé sa route — ce qui n'est pas ce qu'on mesure. Ce qui se mesure est
 * le REFUS.
 *
 * ⚠️ **Une route hors de toute zone répond 403 à TOUT LE MONDE**, administrateur
 * compris : sans zone, le firewall ne pose aucun jeton dans le contexte de
 * requête, et l'autorisation refuse un jeton absent (Zero Trust). C'est
 * précisément ce que la cause `3` nomme, au lieu de laisser croire à un rôle
 * mal orthographié.
 *
 * @module
 */
import { Bocal, demander, garderPortLibre, sortir } from "./http-probe.mjs";

/** Route figée par l'énoncé de la tâche : le juge ne présume d'aucun chemin. */
const CIBLE = "/api/reports";

/** Point d'entrée d'authentification du framework — jamais écrit par l'agent. */
const LOGIN = "/nodefony/security/api/auth/login";

/** Qui suis-je : prouve qu'un cookie porte bien une identité établie. */
const MOI = "/nodefony/security/api/auth/me";

/** Compte administrateur semé au premier démarrage par le preset `complete`. */
const ADMIN = {
  username: "admin",
  password: process.env.NF_ADMIN_PASSWORD ?? "admin",
};

/**
 * Le témoin : authentifié, sans le moindre rôle d'administration.
 *
 * Créé par le gate (`security:user:add`), pas par l'agent — l'énoncé ne lui
 * demande aucun compte, et faire dépendre le verdict de ce qu'il aurait deviné
 * mesurerait autre chose.
 */
const TEMOIN = { username: "bench-temoin", password: "TemoinPassw0rd42x" };

/**
 * `--temoin-args` : rend les arguments de création du compte témoin.
 *
 * Le gate doit créer ce compte AVANT de booter, avec la commande du framework.
 * S'il recopiait l'identifiant et le mot de passe dans sa ligne de commande, la
 * valeur vivrait à deux endroits et divergerait au premier changement — le juge
 * échouerait alors à se connecter à un compte pourtant créé, et accuserait le
 * décor. Une seule source : celle-ci.
 *
 * Sans espace ni caractère spécial : la ligne du gate les découpe en mots.
 */
if (process.argv.includes("--temoin-args")) {
  console.log(`${TEMOIN.username} --password ${TEMOIN.password}`);
  process.exit(0);
}

await garderPortLibre();

/**
 * Ouvre une session et rend son bocal — ou la raison de l'échec.
 *
 * Distingue l'application INJOIGNABLE du compte introuvable : « rien ne
 * répond » et « ce compte n'existe pas » appellent deux gestes différents, et
 * les confondre envoie chercher un défaut de seed alors que le serveur n'a
 * jamais démarré.
 *
 * @param {{username: string, password: string}} identite - identifiants.
 * @returns {Promise<{bocal?: Bocal, echec?: string, injoignable?: string}>} bocal utilisable, ou motif.
 */
const ouvrirSession = async (identite) => {
  const bocal = new Bocal();
  const r = await demander("POST", LOGIN, bocal, { corps: identite });
  if (r.erreur) return { injoignable: r.erreur };
  if (r.statut !== 200) {
    return {
      echec: `POST ${LOGIN} rend ${r.statut} — ${r.corps.slice(0, 160)}`,
    };
  }
  // Le 200 ne suffit pas : c'est le COOKIE rejoué qui doit établir l'identité.
  const moi = await demander("GET", MOI, bocal);
  if (moi.erreur) return { injoignable: `GET ${MOI} — ${moi.erreur}` };
  if (moi.statut !== 200 || !moi.corps.includes(identite.username)) {
    return {
      echec:
        `GET ${MOI} rend ${moi.statut} et ne reconnaît pas « ${identite.username} » : ` +
        `le cookie de session n'est pas rejoué. Corps : ${moi.corps.slice(0, 120)}`,
    };
  }
  return { bocal };
};

// ─── 0. LE DÉCOR D'ABORD — un juge sans identités ne rend pas de verdict ────
const admin = await ouvrirSession(ADMIN);
if (admin.injoignable) {
  sortir(
    4,
    `CAUSE=aucune-reponse — l'application ne répond pas sur ${LOGIN} : ${admin.injoignable}. ` +
      `Le serveur n'a pas démarré, ou pas sur ce port. Rien n'a été mesuré.`,
  );
}
if (admin.echec) {
  sortir(
    7,
    `CAUSE=identite-admin-indisponible — impossible d'ouvrir une session « ${ADMIN.username} » : ` +
      `${admin.echec}. C'est le DÉCOR du banc qui manque (compte semé au premier démarrage par ` +
      `le preset complete), pas le travail de l'agent. Verdict non rendu.`,
  );
}

const temoin = await ouvrirSession(TEMOIN);
if (temoin.injoignable) {
  sortir(
    4,
    `CAUSE=aucune-reponse-temoin — l'application a cessé de répondre entre deux connexions : ` +
      `${temoin.injoignable}.`,
  );
}
if (temoin.echec) {
  sortir(
    9,
    `CAUSE=identite-temoin-indisponible — impossible d'ouvrir une session « ${TEMOIN.username} » : ` +
      `${temoin.echec}. Le compte témoin est créé par le gate (security:user:add), pas par ` +
      `l'agent. Sans lui on ne mesure que l'anonyme, ce qui ne prouve rien. Verdict non rendu.`,
  );
}

/** Un refus du framework : 401 (identité exigée) ou 403 (rôle refusé). */
const estRefus = (statut) => statut === 401 || statut === 403;
const estSucces = (statut) => statut >= 200 && statut < 300;

// ─── 1. L'ANONYME — la protection agit-elle, tout court ? ───────────────────
const anonyme = await demander("GET", CIBLE, new Bocal());
if (anonyme.erreur) sortir(4, `CAUSE=aucune-reponse — ${anonyme.erreur}`);
if (anonyme.statut === 404) {
  sortir(
    6,
    `CAUSE=route-absente — GET ${CIBLE} rend 404 pour un anonyme : la route que l'énoncé ` +
      `nomme n'est pas montée. Ni la protection ni les rôles ne sont en cause.`,
  );
}
if (estSucces(anonyme.statut)) {
  sortir(
    1,
    `CAUSE=route-ouverte-a-l-anonyme — GET ${CIBLE} rend ${anonyme.statut} SANS aucune ` +
      `identité. Rien ne protège la route : le décorateur est absent, posé sur une autre ` +
      `action, ou le motif de la zone ne couvre pas ce chemin. Corps : ` +
      `${anonyme.corps.slice(0, 160)}`,
  );
}
if (!estRefus(anonyme.statut)) {
  sortir(
    10,
    `CAUSE=reponse-inattendue — GET ${CIBLE} rend ${anonyme.statut} à un anonyme : ni refus ` +
      `(401/403), ni succès, ni absence (404). La route existe mais échoue pour une autre ` +
      `raison. Corps : ${anonyme.corps.slice(0, 160)}`,
  );
}

// ─── 2. LE TÉMOIN — authentifié ne doit pas valoir autorisé ─────────────────
// C'est L'étage qui porte l'information : refuser l'anonyme est gratuit, une
// zone quelconque y suffit. Refuser quelqu'un d'authentifié SANS le rôle exige
// une autorisation branchée sur cette route-là.
const vuTemoin = await demander("GET", CIBLE, temoin.bocal);
if (vuTemoin.erreur)
  sortir(4, `CAUSE=aucune-reponse-temoin — ${vuTemoin.erreur}`);
if (estSucces(vuTemoin.statut)) {
  sortir(
    2,
    `CAUSE=role-non-discriminant — « ${TEMOIN.username} » (authentifié, aucun rôle ` +
      `d'administration) obtient ${vuTemoin.statut} sur ${CIBLE}. La route exige une IDENTITÉ ` +
      `mais aucun RÔLE : toute personne ayant un compte y accède. C'est le contournement le ` +
      `plus fréquent — une zone du firewall sans clause d'autorisation.`,
  );
}
if (!estRefus(vuTemoin.statut)) {
  sortir(
    10,
    `CAUSE=reponse-inattendue-temoin — ${CIBLE} rend ${vuTemoin.statut} à un utilisateur ` +
      `authentifié : ni refus ni succès. Corps : ${vuTemoin.corps.slice(0, 160)}`,
  );
}

// ─── 3. L'ADMINISTRATEUR — la garde laisse-t-elle passer son destinataire ? ─
const vuAdmin = await demander("GET", CIBLE, admin.bocal);
if (vuAdmin.erreur) sortir(4, `CAUSE=aucune-reponse-admin — ${vuAdmin.erreur}`);
if (!estSucces(vuAdmin.statut)) {
  sortir(
    3,
    `CAUSE=admin-refuse — « ${ADMIN.username} », porteur de ROLE_ADMIN, obtient ` +
      `${vuAdmin.statut} sur ${CIBLE}. La route refuse TOUT LE MONDE. Deux causes connues, ` +
      `et le juge ne peut pas les départager depuis l'extérieur : (a) la route n'est couverte ` +
      `par AUCUNE zone du firewall — sans zone, aucun jeton n'est posé dans le contexte et ` +
      `l'autorisation refuse par défaut ; (b) le rôle exigé n'est pas celui que porte le ` +
      `compte. Corps : ${vuAdmin.corps.slice(0, 160)}`,
  );
}

// ─── 4. …et sert bien ce que l'énoncé demandait ─────────────────────────────
// Sans ce dernier pas, une route qui rend 200 sur un corps vide passerait :
// « protégée » et « fonctionnelle » sont deux affirmations distinctes.
if (!/report/i.test(vuAdmin.corps) || !/\bok\b/i.test(vuAdmin.corps)) {
  sortir(
    8,
    `CAUSE=corps-inattendu — l'administrateur obtient bien ${vuAdmin.statut}, mais le corps ne ` +
      `porte pas le rapport demandé par l'énoncé. La garde est juste, la route ne sert pas ce ` +
      `qu'elle doit. Corps : ${vuAdmin.corps.slice(0, 160)}`,
  );
}

console.log(
  `ok — ${CIBLE} : anonyme refusé (${anonyme.statut}), « ${TEMOIN.username} » authentifié ` +
    `refusé (${vuTemoin.statut}), « ${ADMIN.username} » servi (${vuAdmin.statut})`,
);
process.exit(0);
