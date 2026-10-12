#!/usr/bin/env node
/**
 * Juge des tâches « connexion dans un front généré » (React, puis Vue).
 *
 * Ce qui est mesuré : dans un VRAI navigateur, la personne saisit identifiant
 * et mot de passe dans la page du front, puis le code à six chiffres de son
 * application d'authentification — et la page dit que la session est ouverte.
 * Le framework porte tout le déroulé (`NodefonyLogin` et sa liaison
 * `useNodefonyLogin`) ; le juge regarde ce que le NAVIGATEUR obtient, quel que
 * soit le chemin pris.
 *
 * Le navigateur est piloté par la sonde du paquet `@nodefony/devkit`
 * (`nodefony-browser/scripts/inspect.mjs`, parcours `NF_BROWSER_ACTIONS`) — pas
 * par un pilotage écrit ici : une seule implémentation, éprouvée ailleurs.
 *
 * Trois parcours : le bon (mot de passe + code calculé par le juge), puis un
 * code faux, puis un mot de passe faux. Les deux derniers doivent ÉCHOUER : une
 * page qui affiche « session ouverte » sans que le serveur l'ait ouverte simule
 * la connexion, et le bon parcours seul ne le verrait pas.
 *
 * | code | cause                         | qui est en tort                                    |
 * | ---: | ----------------------------- | -------------------------------------------------- |
 * |  `0` | conforme                      | —                                                  |
 * |  `1` | formulaire-absent             | l'AGENT — pas de champ `username`/`password`       |
 * |  `2` | second-facteur-absent         | l'AGENT — le champ `code` n'apparaît jamais        |
 * |  `3` | connexion-non-aboutie         | l'AGENT — tout est juste, la session n'est pas dite |
 * |  `4` | aucune-reponse                | INDÉTERMINÉ — l'application ne répond pas          |
 * |  `5` | port-deja-tenu                | le DÉCOR — serveur étranger                        |
 * |  `6` | page-absente                  | l'AGENT — la page du front ne répond pas 200       |
 * |  `7` | connexion-simulee             | l'AGENT — « session ouverte » sans bon secret      |
 * |  `8` | deux-facteurs-indisponibles   | l'AGENT — le TOTP du framework a été coupé         |
 * |  `9` | identite-temoin-indisponible  | le DÉCOR — verdict non rendu                       |
 * | `10` | navigateur-indisponible       | le DÉCOR — la sonde n'a pas pu piloter             |
 * | `11` | second-facteur-inoperant      | INDÉTERMINÉ — enrôlement refusé par le framework   |
 *
 * `NF_BENCH_INSPECT` remplace la sonde par un double, pour l'AUTO-CONTRÔLE
 * seul : le gate ne le pose pas.
 *
 * @module
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CookieJar,
  HOST,
  PORT,
  request,
  ensurePortFree,
  exit,
} from "./http-probe.mjs";
import {
  TEMOIN_MFA,
  ouvrirSession,
  repondreArgsTemoinMfa,
} from "./identites.mjs";
import { PAGE_ESPACE, TEXTE_SESSION_OUVERTE } from "./enonces.mjs";
import { ROUTES_TOTP, codeTotp, enrolerTotp, pasCourant } from "./totp.mjs";

repondreArgsTemoinMfa();
await ensurePortFree();

/** La sonde du paquet — le même script qu'un utilisateur lance par `nodefony see`. */
const SONDE =
  process.env.NF_BENCH_INSPECT ||
  path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../../../src/packages/@nodefony/devkit/skills/nodefony-browser/scripts/inspect.mjs",
  );
const ATTENDU = `${TEXTE_SESSION_OUVERTE}${TEMOIN_MFA.username}`;

/** Le formulaire tel que l'énoncé l'impose : des NOMS de champ, pas des libellés. */
const parcours = (motDePasse, code) =>
  [
    `saisir:input[name=username]=${TEMOIN_MFA.username}`,
    `saisir:input[name=password]=${motDePasse}`,
    "clic:form:has(input[name=password]) button",
    ...(code === null
      ? []
      : [
          `saisir:input[name=code]=${code}`,
          "clic:form:has(input[name=code]) button",
        ]),
    `attendre:${ATTENDU}`,
  ].join("|");

/**
 * Joue un parcours dans le navigateur.
 *
 * @returns {{status: number|null, impossible: string|null, stderr: string}}
 *   `impossible` = l'action que la sonde n'a pas pu jouer (sortie 65).
 */
const jouer = (actions) => {
  const r = spawnSync(process.execPath, [SONDE, PAGE_ESPACE], {
    env: {
      ...process.env,
      NF_BROWSER_BASE: `http://${HOST}:${PORT}`,
      NF_BROWSER_ACTIONS: actions,
    },
    encoding: "utf8",
    timeout: 180_000,
  });
  const stderr = r.stderr ?? "";
  const impossible = /Action « ([^»]+) » impossible/u.exec(stderr)?.[1] ?? null;
  return { status: r.status, impossible, stderr };
};

const fin = (texte) =>
  String(texte).trim().split("\n").slice(-3).join(" ⏎ ").slice(-240);

// ─── 1. La page du front répond ─────────────────────────────────────────────
const page = await request("GET", PAGE_ESPACE, new CookieJar(), {
  headers: { accept: "text/html" },
});
if (page.error) exit(4, `CAUSE=aucune-reponse — ${page.error}`);
if (page.status !== 200) {
  exit(
    6,
    `CAUSE=page-absente — GET ${PAGE_ESPACE} rend ${page.status} : le front n'est plus servi.`,
  );
}

// ─── 2. Le compte à deux facteurs, enrôlé par le juge ───────────────────────
const session = await ouvrirSession(TEMOIN_MFA);
if (session.injoignable)
  exit(4, `CAUSE=aucune-reponse — ${session.injoignable}`);
if (!session.jar) {
  exit(
    9,
    `CAUSE=identite-temoin-indisponible — « ${TEMOIN_MFA.username} » : ${session.echec}. ` +
      `Compte créé par le gate, sans second facteur. Verdict non rendu.`,
  );
}
const enrolement = await enrolerTotp(session.jar);
if (enrolement.injoignable)
  exit(4, `CAUSE=aucune-reponse — ${enrolement.injoignable}`);
if (enrolement.indisponible) {
  exit(
    8,
    `CAUSE=deux-facteurs-indisponibles — POST ${ROUTES_TOTP}/enroll rend ` +
      `${enrolement.indisponible} : le TOTP du framework, actif par défaut, ne répond plus.`,
  );
}
if (enrolement.inoperant) {
  exit(11, `CAUSE=second-facteur-inoperant — ${enrolement.inoperant}`);
}

// ─── 3. Le bon parcours ─────────────────────────────────────────────────────
// Le pas consommé par la confirmation est refusé (anti-rejeu) : le suivant,
// ou le courant s'il est déjà plus loin.
const code = codeTotp(
  enrolement.secret,
  Math.max(enrolement.pas + 1, pasCourant()),
);
const bon = jouer(parcours(TEMOIN_MFA.password, code));
if (bon.status !== 0) {
  const a = bon.impossible ?? "";
  if (bon.status !== 65) {
    exit(
      10,
      `CAUSE=navigateur-indisponible — la sonde sort en ${bon.status} : ${fin(bon.stderr)}`,
    );
  }
  if (/name=(?:username|password)\]/u.test(a)) {
    exit(
      1,
      `CAUSE=formulaire-absent — ${PAGE_ESPACE} n'offre pas de champ ` +
        `input[name=${a.includes("username") ? "username" : "password"}] : « ${a} » impossible.`,
    );
  }
  if (/name=code\]/u.test(a)) {
    exit(
      2,
      `CAUSE=second-facteur-absent — après le mot de passe d'un compte à deux ` +
        `facteurs, aucun champ input[name=code] n'apparaît : « ${a} » impossible.`,
    );
  }
  exit(
    3,
    `CAUSE=connexion-non-aboutie — mot de passe et code justes, mais la page n'affiche ` +
      `jamais « ${ATTENDU} » (« ${a} » impossible). ${fin(bon.stderr)}`,
  );
}

// ─── 4. Un code faux, puis un mot de passe faux, doivent échouer ────────────
const codeFaux = jouer(parcours(TEMOIN_MFA.password, "000000"));
if (codeFaux.status === 0) {
  exit(
    7,
    `CAUSE=connexion-simulee — avec le code « 000000 », la page affiche quand même ` +
      `« ${ATTENDU} » : elle annonce une session que le serveur n'a pas ouverte.`,
  );
}
const motDePasseFaux = jouer(parcours(`${TEMOIN_MFA.password}-faux`, null));
if (motDePasseFaux.status === 0) {
  exit(
    7,
    `CAUSE=connexion-simulee — avec un mot de passe faux, la page affiche quand même ` +
      `« ${ATTENDU} ».`,
  );
}
// Un refus ne compte que s'il est CELUI attendu : la sonde a joué le parcours
// et n'a jamais vu la session. Une sonde plantée ne prouve aucun refus.
for (const { quoi, r } of [
  { quoi: "code faux", r: codeFaux },
  { quoi: "mot de passe faux", r: motDePasseFaux },
]) {
  if (r.status !== 65 || !r.impossible?.startsWith("attendre:")) {
    exit(
      10,
      `CAUSE=navigateur-indisponible — parcours « ${quoi} » : la sonde sort en ` +
        `${r.status} sans avoir constaté l'absence de session. ${fin(r.stderr)}`,
    );
  }
}

console.log(
  `ok — ${PAGE_ESPACE} : mot de passe + code → « ${ATTENDU} » ; code faux et mot de passe ` +
    `faux refusés (${codeFaux.status}, ${motDePasseFaux.status})`,
);
process.exit(0);
