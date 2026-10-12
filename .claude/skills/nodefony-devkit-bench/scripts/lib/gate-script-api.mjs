#!/usr/bin/env node
/**
 * Juge de la tâche « un script appelle l'API protégée ».
 *
 * Ce qui est mesuré : un programme sans personne devant (tâche planifiée,
 * agent) s'authentifie par une CLÉ, jamais en remplissant le formulaire de
 * connexion. Le juge émet une clé par le chemin du framework, la REMET au
 * script de l'agent par l'environnement, et lance ce script comme le ferait
 * l'ordonnanceur — puis le relance avec une clé fausse : un script qui sort en
 * succès quand on le refuse ne surveille rien.
 *
 * | code | cause                       | qui est en tort                                   |
 * | ---: | --------------------------- | ------------------------------------------------- |
 * |  `0` | conforme                    | —                                                 |
 * |  `1` | ouverte-sans-cle            | l'AGENT — un anonyme lit la route                 |
 * |  `2` | cle-refusee                 | l'AGENT — la clé n'ouvre pas la route             |
 * |  `3` | script-echoue               | l'AGENT — avec la bonne clé, le script échoue     |
 * |  `4` | aucune-reponse              | INDÉTERMINÉ — l'application ne répond pas         |
 * |  `5` | port-deja-tenu              | le DÉCOR — serveur étranger                       |
 * |  `6` | route-absente               | l'AGENT — la route n'est pas montée               |
 * |  `7` | script-ne-verifie-rien      | l'AGENT — refusé, le script sort quand même en 0  |
 * |  `8` | identite-admin-indisponible | le DÉCOR — verdict non rendu                      |
 * |  `9` | emission-de-cle-impossible  | le DÉCOR — verdict non rendu                      |
 * | `10` | reponse-inattendue          | l'AGENT — ni succès, ni refus                     |
 * | `11` | script-absent               | l'AGENT — le script demandé n'existe pas          |
 * | `12` | script-sans-fin             | l'AGENT — le script ne rend pas la main           |
 *
 * ⚠️ **Le script reçoit un environnement MINIMAL** : son adresse, sa clé, et de
 * quoi trouver `node`. Il ne voit ni le mot de passe d'administration ni rien
 * de ce que le banc pose : la seule preuve d'identité à sa portée est la clé.
 *
 * @module
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import {
  CookieJar,
  HOST,
  PORT,
  request,
  ensurePortFree,
  exit,
} from "./http-probe.mjs";
import {
  ADMIN,
  EMISSION_CLE,
  emettreCle,
  estRefus,
  estSucces,
  ouvrirSession,
} from "./identites.mjs";
import {
  ROUTE_RAPPORT_MACHINE,
  SCRIPT_RAPPORT,
  VAR_CLE_RAPPORT,
  VAR_URL_RAPPORT,
} from "./enonces.mjs";

await ensurePortFree();

/** Ce que rend la route : `{ "ok": true }`, sérialisé ou affiché par `console.log`. */
const REPONSE_ATTENDUE = /["']?ok["']?\s*:\s*true/u;
/** Une clé de la bonne forme, que l'application n'a jamais émise. */
const CLE_FAUSSE = "nf_banc_cle_jamais_emise_0000000000000000";
/** Réglable pour l'AUTO-CONTRÔLE seul : le gate ne le pose pas. */
const DELAI_SCRIPT_MS =
  Number(process.env.NF_BENCH_SCRIPT_TIMEOUT_MS) || 30_000;

const extrait = (r) => `${r.status} — ${String(r.body ?? "").slice(0, 160)}`;
const fin = (texte) =>
  String(texte ?? "")
    .trim()
    .slice(-200);

/** Lance le script comme l'ordonnanceur : rien d'autre que son adresse et sa clé. */
const lancerScript = (cle) => {
  const env = {
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? "",
    [VAR_URL_RAPPORT]: `http://${HOST}:${PORT}`,
    [VAR_CLE_RAPPORT]: cle,
  };
  // Sans elle, `node` ne démarre pas sous Windows.
  if (process.env.SystemRoot) env.SystemRoot = process.env.SystemRoot;
  return spawnSync(process.execPath, [SCRIPT_RAPPORT], {
    env,
    encoding: "utf8",
    timeout: DELAI_SCRIPT_MS,
  });
};

// ─── 1. Décor : une session d'administration, puis une clé ──────────────────
const admin = await ouvrirSession(ADMIN);
if (admin.injoignable) exit(4, `CAUSE=aucune-reponse — ${admin.injoignable}`);
if (!admin.jar) {
  exit(
    8,
    `CAUSE=identite-admin-indisponible — « ${ADMIN.username} » : ${admin.echec}. ` +
      `C'est le DÉCOR qui manque. Verdict non rendu.`,
  );
}

// ─── 2. La route : fermée à l'anonyme, ouverte à la clé ─────────────────────
const anonyme = await request("GET", ROUTE_RAPPORT_MACHINE, new CookieJar());
if (anonyme.error) exit(4, `CAUSE=aucune-reponse — ${anonyme.error}`);
if (anonyme.status === 404) {
  exit(
    6,
    `CAUSE=route-absente — GET ${ROUTE_RAPPORT_MACHINE} rend 404 : la route n'est pas montée.`,
  );
}
if (estSucces(anonyme.status)) {
  exit(
    1,
    `CAUSE=ouverte-sans-cle — GET ${ROUTE_RAPPORT_MACHINE} rend ${anonyme.status} sans ` +
      `aucune preuve d'identité.`,
  );
}
if (!estRefus(anonyme.status)) {
  exit(
    10,
    `CAUSE=reponse-inattendue — GET ${ROUTE_RAPPORT_MACHINE} anonyme rend ${extrait(anonyme)}`,
  );
}

const emise = await emettreCle(admin.jar, "bench-script");
if (!emise.cle) {
  exit(
    9,
    `CAUSE=emission-de-cle-impossible — ${emise.echec}. Les clés d'API sont-elles ` +
      `activées (${EMISSION_CLE}) ? Verdict non rendu.`,
  );
}
const direct = await request("GET", ROUTE_RAPPORT_MACHINE, new CookieJar(), {
  headers: { authorization: `Bearer ${emise.cle}` },
});
if (direct.error) exit(4, `CAUSE=aucune-reponse — ${direct.error}`);
if (!estSucces(direct.status)) {
  exit(
    2,
    `CAUSE=cle-refusee — une clé d'API valide, présentée en Authorization: Bearer, ` +
      `obtient ${extrait(direct)} : la route n'est pas ouverte aux programmes.`,
  );
}

// ─── 3. Le script, avec la bonne clé ────────────────────────────────────────
if (!existsSync(SCRIPT_RAPPORT)) {
  exit(11, `CAUSE=script-absent — ${SCRIPT_RAPPORT} n'existe pas.`);
}
const bon = lancerScript(emise.cle);
if (bon.error?.code === "ETIMEDOUT" || bon.signal) {
  exit(
    12,
    `CAUSE=script-sans-fin — node ${SCRIPT_RAPPORT} n'a pas rendu la main en ` +
      `${DELAI_SCRIPT_MS / 1000} s : une tâche planifiée resterait pendue.`,
  );
}
if (bon.status !== 0 || !REPONSE_ATTENDUE.test(bon.stdout)) {
  exit(
    3,
    `CAUSE=script-echoue — avec une clé valide dans ${VAR_CLE_RAPPORT}, node ` +
      `${SCRIPT_RAPPORT} sort en ${bon.status}. Sortie : « ${fin(bon.stdout)} » ; ` +
      `erreurs : « ${fin(bon.stderr)} »`,
  );
}

// ─── 4. Le script, avec une clé que l'application n'a jamais émise ──────────
const faux = lancerScript(CLE_FAUSSE);
if (faux.error?.code === "ETIMEDOUT" || faux.signal) {
  exit(
    12,
    `CAUSE=script-sans-fin — refusé, node ${SCRIPT_RAPPORT} ne rend pas la main en ` +
      `${DELAI_SCRIPT_MS / 1000} s.`,
  );
}
if (faux.status === 0) {
  exit(
    7,
    `CAUSE=script-ne-verifie-rien — avec une clé fausse, node ${SCRIPT_RAPPORT} sort ` +
      `en 0 : l'ordonnanceur croirait le relevé fait. Sortie : « ${fin(faux.stdout)} »`,
  );
}

console.log(
  `ok — ${ROUTE_RAPPORT_MACHINE} : anonyme ${anonyme.status}, clé ${direct.status} ; ` +
    `${SCRIPT_RAPPORT} sort en 0 avec la clé, en ${faux.status} sans`,
);
process.exit(0);
