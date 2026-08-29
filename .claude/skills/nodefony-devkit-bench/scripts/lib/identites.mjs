/**
 * Les trois identités des juges de sécurité — UNE implémentation.
 *
 * Toute tâche qui mesure une protection frappe la même route avec les mêmes
 * trois profils : personne, quelqu'un sans le rôle, quelqu'un avec. Ce qui
 * change d'une tâche à l'autre est ce qu'on FRAPPE et ce qu'on en conclut ;
 * ce qui ne change jamais est d'où viennent les identités, ce que « refuser »
 * veut dire, et le fait qu'une identité manquante n'accuse PAS l'agent.
 *
 * Recopier ce bloc dans chaque juge le ferait diverger en silence : le jour où
 * le point d'entrée d'authentification change, un juge continuerait de sortir
 * « identité indisponible » et son rouge serait imputé au travail mesuré.
 *
 * Les causes émises ici sont communes à tous les juges qui l'utilisent :
 *
 * | Sortie | Cause                        | Qui est en cause              |
 * | -----: | ---------------------------- | ----------------------------- |
 * |    `4` | aucune-reponse               | le DÉCOR — l'app ne répond pas |
 * |    `7` | identite-admin-indisponible  | le DÉCOR — verdict non rendu  |
 * |    `9` | identite-temoin-indisponible | le DÉCOR — verdict non rendu  |
 *
 * @module
 */
import { CookieJar, request, exit } from "./http-probe.mjs";

/** Point d'entrée d'authentification du framework — jamais écrit par l'agent. */
export const LOGIN = "/nodefony/security/api/auth/login";

/** Qui suis-je : prouve qu'un cookie porte bien une identité établie. */
export const MOI = "/nodefony/security/api/auth/me";

/** Compte administrateur semé au premier démarrage par le preset `complete`. */
export const ADMIN = {
  username: "admin",
  password: process.env.NF_ADMIN_PASSWORD || "admin",
};

/**
 * Le témoin : authentifié, sans le moindre rôle d'administration.
 *
 * Créé par le gate (`security:user:add`), pas par l'agent — aucun énoncé ne lui
 * demande de compte, et faire dépendre le verdict de ce qu'il aurait deviné
 * mesurerait autre chose.
 */
export const TEMOIN = {
  username: "bench-temoin",
  password: "TemoinPassw0rd42x",
};

/** Un refus du framework : 401 (identité exigée) ou 403 (rôle refusé). */
export const estRefus = (status) => status === 401 || status === 403;

/** Un succès : n'importe quel 2xx — 200 pour une lecture, 204 pour un DELETE. */
export const estSucces = (status) => status >= 200 && status < 300;

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
 *
 * @returns {void} sort du processus si le drapeau est présent.
 */
export const repondreArgsTemoin = () => {
  if (!process.argv.includes("--temoin-args")) return;
  console.log(`${TEMOIN.username} --password ${TEMOIN.password}`);
  process.exit(0);
};

/**
 * Ouvre une session et rend son jar — ou la raison de l'échec.
 *
 * Distingue l'application INJOIGNABLE du compte introuvable : « rien ne
 * répond » et « ce compte n'existe pas » appellent deux gestes différents, et
 * les confondre envoie chercher un défaut de seed alors que le serveur n'a
 * jamais démarré.
 *
 * @param {{username: string, password: string}} identite - identifiants.
 * @returns {Promise<{jar?: CookieJar, echec?: string, injoignable?: string}>} jar, ou motif.
 */
export const ouvrirSession = async (identite) => {
  const jar = new CookieJar();
  const r = await request("POST", LOGIN, jar, { body: identite });
  if (r.error) return { injoignable: r.error };
  if (r.status !== 200) {
    return {
      echec: `POST ${LOGIN} rend ${r.status} — ${r.body.slice(0, 160)}`,
    };
  }
  // Le 200 ne suffit pas : c'est le COOKIE rejoué qui doit établir l'identité.
  const moi = await request("GET", MOI, jar);
  if (moi.error) return { injoignable: `GET ${MOI} — ${moi.error}` };
  if (moi.status !== 200 || !moi.body.includes(identite.username)) {
    return {
      echec:
        `GET ${MOI} rend ${moi.status} et ne reconnaît pas « ${identite.username} » : ` +
        `le cookie de session n'est pas rejoué. Corps : ${moi.body.slice(0, 120)}`,
    };
  }
  return { jar };
};

/**
 * Établit les deux identités, ou termine le juge sur une cause de DÉCOR.
 *
 * C'est le PREMIER geste de tout juge de sécurité : sans identités, aucune
 * mesure n'a de sens, et rendre un verdict sur l'agent serait l'accuser d'une
 * panne du banc.
 *
 * @returns {Promise<{admin: CookieJar, temoin: CookieJar}>} les deux bocaux prêts.
 */
export const etablirIdentites = async () => {
  const admin = await ouvrirSession(ADMIN);
  if (admin.injoignable) {
    exit(
      4,
      `CAUSE=aucune-reponse — l'application ne répond pas sur ${LOGIN} : ${admin.injoignable}. ` +
        `Le serveur n'a pas démarré, ou pas sur ce port. Rien n'a été mesuré.`,
    );
  }
  if (admin.echec) {
    exit(
      7,
      `CAUSE=identite-admin-indisponible — impossible d'ouvrir une session « ${ADMIN.username} » : ` +
        `${admin.echec}. C'est le DÉCOR du banc qui manque (compte semé au premier démarrage par ` +
        `le preset complete), pas le travail de l'agent. Verdict non rendu.`,
    );
  }

  const temoin = await ouvrirSession(TEMOIN);
  if (temoin.injoignable) {
    exit(
      4,
      `CAUSE=aucune-reponse-temoin — l'application a cessé de répondre entre deux connexions : ` +
        `${temoin.injoignable}.`,
    );
  }
  if (temoin.echec) {
    exit(
      9,
      `CAUSE=identite-temoin-indisponible — impossible d'ouvrir une session « ${TEMOIN.username} » : ` +
        `${temoin.echec}. Le compte témoin est créé par le gate (security:user:add), pas par ` +
        `l'agent. Sans lui on ne mesure que l'anonyme, ce qui ne prouve rien. Verdict non rendu.`,
    );
  }

  return { admin: admin.jar, temoin: temoin.jar };
};
