#!/usr/bin/env node
/**
 * Juge de la tâche « protéger une page et y ramener l'utilisateur après connexion ».
 *
 * Ce qui est mesuré : un visiteur anonyme qui OUVRE la page est conduit à la
 * page de connexion, celle-ci sait où le ramener, un connecté voit la page — et
 * rien de tout cela n'ouvre une redirection vers un autre site. Le framework
 * porte chaque morceau (zone `entryPoint`, `?from=` assaini par
 * `safeRedirectPath`, `this.user`) : le juge regarde si l'application RÉSULTANTE
 * se comporte ainsi, quel que soit le chemin pris.
 *
 * | code | cause                          | qui est en tort                                    |
 * | ---: | ------------------------------ | -------------------------------------------------- |
 * |  `0` | conforme                       | —                                                  |
 * |  `1` | page-ouverte                   | l'AGENT — un anonyme voit la page                  |
 * |  `2` | pas-de-retour                  | l'AGENT — refus sec, aucune conduite à la connexion |
 * |  `3` | redirection-externe            | l'AGENT — la conduite part sur une autre origine   |
 * |  `4` | aucune-reponse                 | INDÉTERMINÉ — l'application ne répond pas          |
 * |  `5` | port-deja-tenu                 | le DÉCOR — serveur étranger                        |
 * |  `6` | route-absente                  | l'AGENT — la page n'est pas montée                 |
 * |  `7` | retour-perdu                   | l'AGENT — la connexion ne sait pas où ramener      |
 * |  `8` | page-de-connexion-absente      | l'AGENT — la conduite mène à une page morte        |
 * |  `9` | api-redirigee                  | l'AGENT — un appel d'API reçoit une redirection    |
 * | `10` | corps-inattendu                | l'AGENT — la page ne dit pas qui est connecté      |
 * | `11` | redirection-ouverte            | l'AGENT — `?from=` hostile repris tel quel         |
 * | `12` | identite-temoin-indisponible   | le DÉCOR — verdict non rendu                       |
 * | `13` | reponse-inattendue             | l'AGENT — ni page, ni refus, ni redirection        |
 *
 * ⚠️ **La conduite ne vaut que pour une NAVIGATION.** Un `fetch` ou un client
 * d'API qui reçoit un 302 vers une page HTML ne sait qu'en faire : il doit
 * garder son 401. C'est ce que fait la zone `entryPoint` du framework, et ce que
 * défait une redirection écrite à la main dans le contrôleur — la cause `9` le
 * distingue.
 *
 * ⚠️ **L'origine piégée n'est pas dans l'énoncé.** Le juge la joue sur la page
 * de connexion réellement atteinte : si l'agent a remplacé la page ou écrit son
 * propre retour, c'est son code qui reçoit le piège.
 *
 * @module
 */
import { CookieJar, request, ensurePortFree, exit } from "./http-probe.mjs";
import {
  TEMOIN,
  estRefus,
  estSucces,
  ouvrirSession,
  repondreArgsTemoin,
} from "./identites.mjs";
import { ORIGINE_PIEGE, PAGE_COMPTE } from "./enonces.mjs";

repondreArgsTemoin();
await ensurePortFree();

/** Ce qu'envoie un navigateur qui OUVRE une page (Fetch Metadata). */
const NAVIGATION = {
  accept: "text/html,application/xhtml+xml",
  "sec-fetch-mode": "navigate",
  "sec-fetch-dest": "document",
  "sec-fetch-site": "none",
};
/** Ce qu'envoie un appel d'API. */
const API = { accept: "application/json", "sec-fetch-mode": "cors" };

const estRedirection = (status) => status >= 300 && status < 400;
/** Un chemin de CETTE origine — ni `//hôte`, ni `/\hôte`, ni schéma. */
const estLocal = (cible) => /^\/(?![/\\])/u.test(cible);

// ─── 1. L'anonyme qui OUVRE la page ─────────────────────────────────────────
const nav = await request("GET", PAGE_COMPTE, new CookieJar(), {
  headers: NAVIGATION,
});
if (nav.error) exit(4, `CAUSE=aucune-reponse — ${nav.error}`);
if (nav.status === 404) {
  exit(
    6,
    `CAUSE=route-absente — GET ${PAGE_COMPTE} rend 404 : la page n'est pas montée.`,
  );
}
if (estSucces(nav.status)) {
  exit(
    1,
    `CAUSE=page-ouverte — GET ${PAGE_COMPTE} rend ${nav.status} à un anonyme : rien ne ` +
      `protège la page. Corps : ${nav.body.slice(0, 120)}`,
  );
}
if (estRefus(nav.status)) {
  exit(
    2,
    `CAUSE=pas-de-retour — un anonyme qui ouvre ${PAGE_COMPTE} reçoit ${nav.status} : la page ` +
      `est protégée, mais le visiteur reste devant un refus au lieu d'être conduit à la ` +
      `connexion.`,
  );
}
if (!estRedirection(nav.status)) {
  exit(
    13,
    `CAUSE=reponse-inattendue — GET ${PAGE_COMPTE} rend ${nav.status} à un anonyme. ` +
      `Corps : ${nav.body.slice(0, 160)}`,
  );
}
const location = String(nav.headers.location ?? "");
if (!estLocal(location)) {
  exit(
    3,
    `CAUSE=redirection-externe — la conduite à la connexion vise « ${location} », hors de ` +
      `cette origine.`,
  );
}
const versConnexion = new URL(location, "http://local");
if (versConnexion.searchParams.get("from") !== PAGE_COMPTE) {
  exit(
    7,
    `CAUSE=retour-perdu — l'anonyme est conduit à « ${location} » : la page de connexion ` +
      `ne saura pas le ramener sur ${PAGE_COMPTE} (\`from\` attendu).`,
  );
}

// ─── 2. La page de connexion atteinte existe, et ramène où il faut ──────────
const connexion = await request("GET", location, new CookieJar(), {
  headers: NAVIGATION,
});
if (connexion.error)
  exit(4, `CAUSE=aucune-reponse-connexion — ${connexion.error}`);
if (connexion.status !== 200) {
  exit(
    8,
    `CAUSE=page-de-connexion-absente — la conduite mène à ${location}, qui rend ` +
      `${connexion.status}.`,
  );
}
if (!connexion.body.includes(PAGE_COMPTE)) {
  exit(
    7,
    `CAUSE=retour-perdu — ${location} ne reprend nulle part ${PAGE_COMPTE} : après ` +
      `connexion, le visiteur ne sera pas ramené.`,
  );
}

// ─── 3. Le piège : un `from` hostile ne doit JAMAIS ressortir ───────────────
for (const piege of [
  `//${ORIGINE_PIEGE}`,
  `https://${ORIGINE_PIEGE}`,
  `/\\${ORIGINE_PIEGE}`,
]) {
  const cible = `${versConnexion.pathname}?from=${encodeURIComponent(piege)}`;
  const r = await request("GET", cible, new CookieJar(), {
    headers: NAVIGATION,
  });
  if (r.error) exit(4, `CAUSE=aucune-reponse-connexion — ${r.error}`);
  const sortie = estRedirection(r.status)
    ? String(r.headers.location ?? "")
    : r.body;
  if (sortie.includes(ORIGINE_PIEGE)) {
    exit(
      11,
      `CAUSE=redirection-ouverte — GET ${cible} reprend « ${piege} » ` +
        `(${estRedirection(r.status) ? "en redirection" : "dans la page"}) : un lien piégé ` +
        `renverrait l'utilisateur, fraîchement connecté, chez un tiers.`,
    );
  }
}

// ─── 4. Un appel d'API garde son refus ──────────────────────────────────────
const api = await request("GET", PAGE_COMPTE, new CookieJar(), {
  headers: API,
});
if (api.error) exit(4, `CAUSE=aucune-reponse-api — ${api.error}`);
if (estRedirection(api.status)) {
  exit(
    9,
    `CAUSE=api-redirigee — un appel d'API anonyme sur ${PAGE_COMPTE} reçoit ${api.status} ` +
      `vers ${api.headers.location} : la conduite à la connexion doit viser la seule ` +
      `navigation, un client d'API attend son 401.`,
  );
}

// ─── 5. Le connecté voit SA page ────────────────────────────────────────────
const session = await ouvrirSession(TEMOIN);
if (session.injoignable)
  exit(4, `CAUSE=aucune-reponse-temoin — ${session.injoignable}`);
if (!session.jar) {
  exit(
    12,
    `CAUSE=identite-temoin-indisponible — ${session.echec}. Verdict non rendu.`,
  );
}
const vu = await request("GET", PAGE_COMPTE, session.jar, {
  headers: NAVIGATION,
});
if (vu.error) exit(4, `CAUSE=aucune-reponse-temoin — ${vu.error}`);
if (!estSucces(vu.status)) {
  exit(
    13,
    `CAUSE=reponse-inattendue — « ${TEMOIN.username} », connecté, obtient ${vu.status} sur ` +
      `${PAGE_COMPTE}. Corps : ${vu.body.slice(0, 160)}`,
  );
}
if (!vu.body.includes(TEMOIN.username)) {
  exit(
    10,
    `CAUSE=corps-inattendu — ${PAGE_COMPTE} est servie à « ${TEMOIN.username} » mais ne ` +
      `nomme pas la personne connectée. Corps : ${vu.body.slice(0, 160)}`,
  );
}

console.log(
  `ok — ${PAGE_COMPTE} : anonyme conduit à ${location}, piège « ${ORIGINE_PIEGE} » neutralisé, ` +
    `API refusée (${api.status}), « ${TEMOIN.username} » servi`,
);
process.exit(0);
