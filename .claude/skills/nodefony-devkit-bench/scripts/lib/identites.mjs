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
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { CookieJar, request, exit } from "./http-probe.mjs";

/** Point d'entrée d'authentification du framework — jamais écrit par l'agent. */
export const LOGIN = "/nodefony/security/api/auth/login";

/** Qui suis-je : prouve qu'un cookie porte bien une identité établie. */
export const MOI = "/nodefony/security/api/auth/me";

/**
 * Le mot de passe qu'un banc POSE quand il commande lui-même le semis.
 *
 * Un banc qui démarre en production doit fournir `NF_ADMIN_PASSWORD` — le
 * gabarit n'y applique aucun défaut, délibérément. La valeur vit ICI parce
 * qu'elle est soumise à la politique de mot de passe du produit, exactement
 * comme celle d'un utilisateur : écrite dans le banc qui l'emploie, elle a déjà
 * été rendue INVALIDE par un durcissement de la politique sans que rien ne le
 * dise — le compte n'était plus semé, et l'étape restait verte parce qu'elle ne
 * s'en servait pas. `identites.selftest.mjs` la confronte à la politique.
 */
export const MOT_DE_PASSE_POSE = "banc-verite-42";

/**
 * Ce qu'un AUTO-CONTRÔLE pose pour que le juge FRAPPE son faux serveur.
 *
 * Ces contrôles montent un serveur de pacotille et vérifient que le juge sait
 * distinguer ses causes. Il leur faut donc une valeur — n'importe laquelle,
 * mais une VRAIE : sans elle, la résolution part chercher le semis d'une
 * application qui n'existe pas ici, le juge refuse de frapper, et les dix cas
 * rendent la même cause « identité indisponible ». Une chaîne vide tenait ce
 * rôle tant qu'un repli en dur existait ; elle ne le tient plus.
 */
export const MOT_DE_PASSE_SONDE = "sonde-selftest-42x";

/** Où l'application témoin écrit son semis — le RENDU du gabarit `complete`. */
const SEMIS = path.join("nodefony", "security", "provisionUsers.ts");

/** La constante que ce fichier déclare pour le mot de passe de développement. */
const CONSTANTE_SEMIS = "DEV_ADMIN_PASSWORD";

/** Résolution mémoïsée — le fichier ne change pas pendant la vie d'un juge. */
let resolution = null;

/**
 * Le mot de passe du compte administrateur, LU là où il est posé.
 *
 * 🔴 Cette valeur ne se recopie JAMAIS. Elle a vécu ici en dur (« admin »)
 * pendant que le gabarit du framework la changeait pour `nodefony-dev-42` : la
 * politique de mot de passe par défaut refuse désormais l'ancienne (trop
 * courte), donc plus aucune session ne s'ouvrait — et les huit juges de
 * sécurité rendaient « décor absent » sur TOUTES leurs tâches, au lieu de la
 * tâche isolée qu'on croyait. Un jumeau non vérifié ne se voit pas : chaque
 * moitié reste cohérente avec elle-même.
 *
 * Deux sources, dans cet ordre, et rien d'autre :
 *
 * 1. `NF_ADMIN_PASSWORD` s'il est POSÉ — c'est le geste de l'exploitant, et le
 *    gabarit lui donne la priorité ; le banc doit lire la même priorité.
 * 2. sinon la constante du SEMIS de l'application témoin — pas celle du
 *    gabarit du dépôt : en source `registre`, l'application est rendue par un
 *    générateur venu de npm, dont le défaut peut différer du checkout.
 *
 * Rien de plus : **aucun repli en dur**. Ne pas savoir est une information, et
 * la taire derrière une valeur plausible est précisément ce qui a coûté les
 * runs ci-dessus.
 *
 * @param {string} [racine] - la racine de l'application témoin (défaut : cwd —
 *   les juges s'exécutent DANS l'application, jamais dans le dépôt).
 * @returns {{password: string, source: string}|{echec: string}} la valeur et sa
 *   provenance, ou le motif pour lequel on ne la connaît pas.
 */
export function motDePasseAdmin(racine = process.cwd()) {
  const pose = process.env.NF_ADMIN_PASSWORD;
  if (typeof pose === "string" && pose.length > 0) {
    return { password: pose, source: "NF_ADMIN_PASSWORD" };
  }
  const fichier = path.join(racine, SEMIS);
  if (!existsSync(fichier)) {
    return {
      echec:
        `ni NF_ADMIN_PASSWORD posé, ni ${SEMIS} lisible depuis ${racine} — ` +
        "impossible de savoir avec quel mot de passe le compte a été semé",
    };
  }
  const trouve = new RegExp(`${CONSTANTE_SEMIS} = "([^"]*)"`, "u").exec(
    readFileSync(fichier, "utf8"),
  );
  if (trouve === null || trouve[1].length === 0) {
    return {
      echec:
        `${CONSTANTE_SEMIS} introuvable dans ${SEMIS} — le gabarit a changé de ` +
        "forme, ou l'application a été rendue par un autre preset. Recaler " +
        "cette lecture, ne pas remettre une valeur en dur",
    };
  }
  return { password: trouve[1], source: SEMIS };
}

/**
 * Compte administrateur semé au premier démarrage par le preset `complete`.
 *
 * Le mot de passe est un ACCESSEUR : il se résout au premier usage, dans le
 * répertoire de l'application témoin. À l'import, ce répertoire n'est pas
 * forcément celui d'une application — les auto-contrôles chargent ce module
 * depuis le dépôt.
 */
export const ADMIN = {
  username: "admin",
  get password() {
    resolution ??= motDePasseAdmin();
    return resolution.password ?? "";
  },
  /** Le motif pour lequel le mot de passe est INCONNU, ou `undefined`. */
  get echec() {
    resolution ??= motDePasseAdmin();
    return resolution.echec;
  },
  /** D'où vient la valeur employée — pour le DIRE dans le journal du banc. */
  get source() {
    resolution ??= motDePasseAdmin();
    return resolution.source;
  },
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
  // Ne pas FRAPPER avec un mot de passe qu'on ne connaît pas : l'échec
  // ressemblerait à « ce compte n'existe pas » et enverrait chercher un défaut
  // de semis, alors que c'est le banc qui ne sait pas quoi présenter.
  if (identite.echec !== undefined) {
    return { echec: `mot de passe inconnu du banc — ${identite.echec}` };
  }
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

/**
 * Rend le verdict de la PRÉMISSE — sans passer par `exit`, délibérément.
 *
 * `exit` est fait pour un JUGE : il avertit qu'une sortie rouge ne nomme pas sa
 * cause (`CAUSE=<nom>`), parce que le banc s'en sert pour dire à QUI le rouge
 * est opposable. Une prémisse ne juge personne — elle est lue par le lanceur
 * AVANT que l'agent existe, et rien ne lui sera jamais imputé. Constaté sur une
 * application réelle : la sortie s'accompagnait de « ce juge sort en erreur SANS
 * nommer sa cause », un défaut d'instrument annoncé là où il n'y en a pas.
 * Émettre une `CAUSE=` pour faire taire l'avertissement aurait été pire : le
 * classement des causes ne connaît pas celle-là, et il aurait fallu l'y ranger
 * comme si un agent pouvait en répondre.
 *
 * @param {number} code - `0` la prémisse tient, `1` elle manque.
 * @param {string} message - ce que le lanceur affichera.
 * @returns {never}
 */
const rendreVerdictDecor = (code, message) => {
  console.error(message);
  process.exit(code);
};

/**
 * `--constater` : la PRÉMISSE d'identité, éprouvée AVANT que l'agent arrive.
 *
 * Huit juges ouvrent une session `ADMIN` pour mesurer une protection. Quand ce
 * compte n'est pas joignable, ils rendent un rouge de DÉCOR — la bonne conduite,
 * mais trop tard : la tâche a été jouée, l'agent payé, et le run est
 * inutilisable pour cette tâche. On aura payé un verdict qu'on savait d'avance
 * ne pas pouvoir rendre.
 *
 * Ce mode fait le MÊME geste que le juge fera — ouvrir une session, pas lire une
 * ligne en base : un compte présent dont le mot de passe diffère de celui que le
 * banc présente est exactement le cas qui a vidé les huit juges, et aucune
 * lecture de table ne l'aurait vu. Il ne crée rien, ne migre rien, ne touche à
 * rien : ce que la prémisse constate ne doit pas modifier ce que l'agent
 * trouvera.
 *
 * Sorties : `0` la prémisse tient · `1` elle manque, et le motif la nomme.
 *
 * @returns {Promise<void>} sort du processus si le drapeau est présent.
 */
export const constaterIdentiteAdmin = async () => {
  if (!process.argv.includes("--constater")) return;
  const session = await ouvrirSession(ADMIN);
  if (session.injoignable) {
    rendreVerdictDecor(
      1,
      `DECOR=ABSENT — l'application ne répond pas sur ${LOGIN} : ` +
        `${session.injoignable}. Elle n'a pas démarré, ou pas sur ce port.`,
    );
  }
  if (session.echec) {
    rendreVerdictDecor(
      1,
      `DECOR=ABSENT — le compte « ${ADMIN.username} » n'ouvre pas de session : ` +
        `${session.echec}. Il est semé au premier démarrage par le preset ` +
        `complete ; sans lui les juges de sécurité ne mesurent rien.`,
    );
  }
  rendreVerdictDecor(
    0,
    `DECOR=pose — session « ${ADMIN.username} » ouverte et cookie rejoué ` +
      `(mot de passe : ${ADMIN.source}).`,
  );
};

// Ne s'exécute QUE lancé directement : les juges importent ce module pour ses
// identités, sans vouloir constater quoi que ce soit.
//
// La comparaison porte sur l'URL du module, pas sur son NOM de fichier : une
// copie mutée s'appelle autrement, et une garde écrite en `endsWith` la rendrait
// inerte — le débranchement passerait alors pour vert sans avoir rien exercé.
if (
  process.argv[1] !== undefined &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  await constaterIdentiteAdmin();
}
