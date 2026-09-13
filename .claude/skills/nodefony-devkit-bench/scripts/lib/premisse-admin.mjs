/**
 * La prémisse d'identité, CONSTATÉE avant qu'un agent ne soit lancé.
 *
 * Huit juges de sécurité ouvrent une session d'administration pour mesurer une
 * protection. Quand ce compte n'est pas en base, le juge rend
 * `identite-admin-indisponible` : il dit correctement que c'est le DÉCOR et non
 * l'agent — mais la tâche a été jouée, l'agent payé, et le verdict est perdu.
 * On aura payé plusieurs minutes de modèle pour une réponse qu'on savait
 * d'avance ne pas pouvoir rendre.
 *
 * Ce module est le constat, appelé depuis la PRÉMISSE d'une tâche (chaînée en
 * `&&` : elle échoue, la tâche n'est pas jouée). Il ne réimplémente rien —
 * `ouvrirSession(ADMIN)` est la même fonction que celle des juges, pour la
 * raison qui vaut partout ici : deux gardes de prémisse divergeraient, et
 * chacune passerait ses propres tests. Le jour où le point d'entrée
 * d'authentification change, ce fichier suit sans être touché.
 *
 * Ce qu'il ne fait PAS : démarrer l'application. L'appelant décide de ce qui
 * tourne — le constat ne peut pas être à la fois le décor et son juge.
 *
 * | Sortie | Sens                                                          |
 * | -----: | ------------------------------------------------------------- |
 * |    `0` | l'identité d'administration est établie — la tâche peut jouer  |
 * |    `4` | rien ne répond : l'application n'est pas là                    |
 * |    `7` | elle répond, mais ce compte ne s'ouvre pas                     |
 *
 * Usage : `node lib/premisse-admin.mjs`
 *
 * @module
 */
import { ADMIN, LOGIN, ouvrirSession } from "./identites.mjs";
import { exit } from "./http-probe.mjs";

const session = await ouvrirSession(ADMIN);

if (session.injoignable) {
  exit(
    4,
    `CAUSE=aucune-reponse — prémisse NON tenue : l'application ne répond pas sur ${LOGIN} ` +
      `(${session.injoignable}). La tâche n'est pas jouée — aucun agent n'a été lancé, ` +
      "et c'est voulu : son verdict aurait porté sur un décor absent.",
  );
}

if (session.echec) {
  exit(
    7,
    `CAUSE=identite-admin-indisponible — prémisse NON tenue : impossible d'ouvrir une session ` +
      `« ${ADMIN.username} » (${session.echec}). Le compte est semé au premier démarrage par le ` +
      "preset complete ; quand la table des utilisateurs n'existe pas encore, ce semis échoue, le " +
      "noyau l'écarte en fail-soft et l'application démarre SANS administrateur — `nodefony doctor` " +
      "le dit alors sous « briques ignorées ». La tâche n'est pas jouée, aucun agent n'a été lancé.",
  );
}

console.log(
  `prémisse tenue : session « ${ADMIN.username} » ouverte et rejouée — la tâche peut être jouée`,
);
