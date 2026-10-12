#!/usr/bin/env node
/**
 * Juge de la tâche « exiger deux facteurs et une connexion récente ».
 *
 * Ce qui est mesuré : l'action sensible (`POST` du virement) n'est permise qu'à
 * une connexion qui a employé le second facteur ET qui date de moins de
 * {@link AGE_MAX_CONNEXION_S} secondes. Le framework porte la règle
 * (`@RequireAuthentication`, `authAt`/`amr` posés par chaque connexion) ; le
 * juge regarde si l'application RÉSULTANTE se comporte ainsi, quel que soit le
 * chemin pris.
 *
 * Le parcours joue trois personnes : l'anonyme, le témoin connecté au mot de
 * passe seul, et un témoin à qui le juge enrôle un TOTP — il calcule lui-même
 * les codes, comme le ferait son téléphone. Puis il ATTEND que la connexion
 * vieillisse : seule une session réellement ancienne prouve que l'âge est lu.
 *
 * | code | cause                          | qui est en tort                                      |
 * | ---: | ------------------------------ | ---------------------------------------------------- |
 * |  `0` | conforme                       | —                                                    |
 * |  `1` | ouvert-a-tous                  | l'AGENT — un anonyme vire                            |
 * |  `2` | mot-de-passe-suffit            | l'AGENT — le second facteur n'est pas exigé          |
 * |  `3` | connexion-ancienne-acceptee    | l'AGENT — l'âge de la connexion n'est pas lu         |
 * |  `4` | aucune-reponse                 | INDÉTERMINÉ — l'application ne répond pas            |
 * |  `5` | port-deja-tenu                 | le DÉCOR — serveur étranger                          |
 * |  `6` | route-absente                  | l'AGENT — la route n'est pas montée                  |
 * |  `7` | deux-facteurs-refuses          | l'AGENT — même une connexion conforme est refusée    |
 * |  `8` | deux-facteurs-indisponibles    | l'AGENT — le TOTP du framework a été coupé           |
 * |  `9` | identite-temoin-indisponible   | le DÉCOR — verdict non rendu                         |
 * | `10` | reponse-inattendue             | l'AGENT — ni succès, ni refus                        |
 * | `11` | second-facteur-inoperant       | INDÉTERMINÉ — enrôlement ou code refusé              |
 * | `12` | second-facteur-non-exige       | l'AGENT — un compte enrôlé entre au mot de passe     |
 * | `13` | jeton-csrf-absent              | INDÉTERMINÉ — 403 sans que le juge ait pu se munir   |
 *
 * ⚠️ **Refuser tout le monde n'est pas protéger.** La cause `7` existe pour
 * l'exigence mal nommée (`amr: ["totp"]`, `["mfa"]` — le facteur s'appelle
 * `otp`, RFC 8176) : elle refuse aussi la personne qui a fait exactement ce
 * qu'il fallait, et aucun des trois refus précédents ne le verrait.
 *
 * L'attente se règle par `NF_BENCH_STEPUP_WAIT_MS`, pour l'AUTO-CONTRÔLE seul :
 * le gate ne la pose pas, et c'est l'âge de l'énoncé, plus une marge, qui
 * s'applique.
 *
 * @module
 */
import {
  CookieJar,
  request,
  ensurePortFree,
  exit,
  semerJeton,
} from "./http-probe.mjs";
import {
  LOGIN,
  TEMOIN,
  TEMOIN_MFA,
  estRefus,
  estSucces,
  ouvrirSession,
  repondreArgsTemoin,
  repondreArgsTemoinMfa,
} from "./identites.mjs";
import {
  AGE_MAX_CONNEXION_S,
  CORPS_VIREMENT,
  ROUTE_VIREMENT,
} from "./enonces.mjs";
import { codeTotp, pasCourant } from "./totp.mjs";

repondreArgsTemoin();
repondreArgsTemoinMfa();
await ensurePortFree();

/** Routes libre-service du second facteur — celles du framework. */
const TOTP = "/nodefony/security/api/totp";
/** Second temps d'une connexion à deux facteurs, après le `202`. */
const LOGIN_TOTP = `${LOGIN}/totp`;
/** Combien attendre pour que la connexion soit plus vieille que l'énoncé. */
const ATTENTE_MS =
  Number(process.env.NF_BENCH_STEPUP_WAIT_MS) ||
  (AGE_MAX_CONNEXION_S + 5) * 1000;

/** Ce qu'envoie un client d'API : un refus doit rester un refus, pas une page. */
const API = { accept: "application/json" };

const extrait = (r) =>
  `${r.status}${r.headers?.["www-authenticate"] ? ` (www-authenticate : ${r.headers["www-authenticate"]})` : ""} — ${String(r.body ?? "").slice(0, 160)}`;

/** Le virement, avec le jeton anti-rejeu qu'un vrai client aurait semé. */
const virer = async (jar, corps = CORPS_VIREMENT) => {
  if (!jar.csrfToken()) await semerJeton(jar, ROUTE_VIREMENT, "/api");
  return request("POST", ROUTE_VIREMENT, jar, {
    body: corps,
    csrfToken: jar.csrfToken(),
    headers: API,
  });
};

const lireJson = (texte) => {
  try {
    return JSON.parse(texte);
  } catch {
    return null;
  }
};

// ─── 1. L'anonyme ───────────────────────────────────────────────────────────
const anonyme = await virer(new CookieJar());
if (anonyme.error) exit(4, `CAUSE=aucune-reponse — ${anonyme.error}`);
if (anonyme.status === 404) {
  exit(
    6,
    `CAUSE=route-absente — POST ${ROUTE_VIREMENT} rend 404 : la route n'est pas montée.`,
  );
}
if (estSucces(anonyme.status)) {
  exit(
    1,
    `CAUSE=ouvert-a-tous — POST ${ROUTE_VIREMENT} rend ${anonyme.status} à un anonyme : ` +
      `n'importe qui vire. Corps : ${String(anonyme.body).slice(0, 120)}`,
  );
}
if (!estRefus(anonyme.status)) {
  exit(
    10,
    `CAUSE=reponse-inattendue — POST ${ROUTE_VIREMENT} anonyme rend ${extrait(anonyme)}`,
  );
}

// ─── 2. Le témoin, connecté au mot de passe SEUL ────────────────────────────
const temoin = await ouvrirSession(TEMOIN);
if (temoin.injoignable)
  exit(4, `CAUSE=aucune-reponse-temoin — ${temoin.injoignable}`);
if (!temoin.jar) {
  exit(
    9,
    `CAUSE=identite-temoin-indisponible — « ${TEMOIN.username} » : ${temoin.echec}. ` +
      `Compte créé par le gate, pas par l'agent. Verdict non rendu.`,
  );
}
const motDePasse = await virer(temoin.jar);
if (motDePasse.error)
  exit(4, `CAUSE=aucune-reponse-temoin — ${motDePasse.error}`);
if (estSucces(motDePasse.status)) {
  exit(
    2,
    `CAUSE=mot-de-passe-suffit — « ${TEMOIN.username} », connecté au mot de passe seul, ` +
      `vire (${motDePasse.status}) : le second facteur n'est pas exigé.`,
  );
}
if (!estRefus(motDePasse.status)) {
  exit(
    10,
    `CAUSE=reponse-inattendue — « ${TEMOIN.username} » (mot de passe seul) obtient ` +
      extrait(motDePasse),
  );
}

// ─── 3. Le témoin à deux facteurs : enrôlement, puis connexion complète ─────
const mfa = await ouvrirSession(TEMOIN_MFA);
if (mfa.injoignable) exit(4, `CAUSE=aucune-reponse-mfa — ${mfa.injoignable}`);
if (!mfa.jar) {
  exit(
    9,
    `CAUSE=identite-temoin-indisponible — « ${TEMOIN_MFA.username} » : ${mfa.echec}. ` +
      `Compte créé par le gate, SANS second facteur : un 202 ici veut dire qu'il a déjà ` +
      `été enrôlé (juge rejoué sur la même application). Verdict non rendu.`,
  );
}
const enrolement = await request("POST", `${TOTP}/enroll`, mfa.jar, {
  headers: API,
});
if (enrolement.error) exit(4, `CAUSE=aucune-reponse-mfa — ${enrolement.error}`);
if (enrolement.status === 404 || enrolement.status === 503) {
  exit(
    8,
    `CAUSE=deux-facteurs-indisponibles — POST ${TOTP}/enroll rend ${enrolement.status} : ` +
      `le TOTP du framework, actif par défaut, ne répond plus — personne ne peut ` +
      `satisfaire une exigence de second facteur.`,
  );
}
const secret = lireJson(enrolement.body)?.secretBase32;
if (enrolement.status !== 200 || typeof secret !== "string") {
  exit(
    11,
    `CAUSE=second-facteur-inoperant — POST ${TOTP}/enroll rend ${extrait(enrolement)}`,
  );
}
const pas = pasCourant();
const confirmation = await request("POST", `${TOTP}/confirm`, mfa.jar, {
  body: { code: codeTotp(secret, pas) },
  headers: API,
});
if (confirmation.error)
  exit(4, `CAUSE=aucune-reponse-mfa — ${confirmation.error}`);
if (confirmation.status !== 200) {
  exit(
    11,
    `CAUSE=second-facteur-inoperant — POST ${TOTP}/confirm rend ${extrait(confirmation)}`,
  );
}

// Nouvelle connexion : le compte est désormais enrôlé, le mot de passe seul
// doit s'arrêter au défi (202).
const complet = new CookieJar();
const premier = await request("POST", LOGIN, complet, {
  body: TEMOIN_MFA,
  headers: API,
});
if (premier.error) exit(4, `CAUSE=aucune-reponse-mfa — ${premier.error}`);
if (premier.status === 200) {
  exit(
    12,
    `CAUSE=second-facteur-non-exige — « ${TEMOIN_MFA.username} », enrôlé, est connecté ` +
      `par son seul mot de passe (200 au lieu du défi 202).`,
  );
}
if (premier.status !== 202) {
  exit(
    11,
    `CAUSE=second-facteur-inoperant — POST ${LOGIN} d'un compte enrôlé rend ${extrait(premier)}`,
  );
}
// Le code du pas SUIVANT : celui de la confirmation est consommé (anti-rejeu),
// et la fenêtre de ±1 pas du framework accepte le suivant dès maintenant.
const second = await request("POST", LOGIN_TOTP, complet, {
  body: { code: codeTotp(secret, pas + 1) },
  headers: API,
});
if (second.error) exit(4, `CAUSE=aucune-reponse-mfa — ${second.error}`);
if (second.status !== 200) {
  exit(
    11,
    `CAUSE=second-facteur-inoperant — POST ${LOGIN_TOTP} rend ${extrait(second)}`,
  );
}
const connecteA = Date.now();

const conforme = await virer(complet);
if (conforme.error) exit(4, `CAUSE=aucune-reponse-mfa — ${conforme.error}`);
if (conforme.status === 403 && !complet.csrfToken()) {
  exit(
    13,
    `CAUSE=jeton-csrf-absent — la connexion conforme reçoit 403 et le juge n'a pu se ` +
      `munir d'aucun jeton anti-rejeu sous /api : le refus ne dit rien du travail mesuré.`,
  );
}
if (estRefus(conforme.status)) {
  exit(
    7,
    `CAUSE=deux-facteurs-refuses — « ${TEMOIN_MFA.username} », connecté à l'instant avec ` +
      `mot de passe ET code TOTP, est refusé : ${extrait(conforme)}`,
  );
}
if (!estSucces(conforme.status)) {
  exit(
    10,
    `CAUSE=reponse-inattendue — la connexion conforme obtient ${extrait(conforme)}`,
  );
}

// ─── 4. La même connexion, devenue trop ancienne ────────────────────────────
await new Promise((r) =>
  setTimeout(r, Math.max(0, connecteA + ATTENTE_MS - Date.now())),
);
const ancienne = await virer(complet, {
  ...CORPS_VIREMENT,
  amount: CORPS_VIREMENT.amount + 1,
});
if (ancienne.error) exit(4, `CAUSE=aucune-reponse-mfa — ${ancienne.error}`);
if (estSucces(ancienne.status)) {
  exit(
    3,
    `CAUSE=connexion-ancienne-acceptee — la connexion à deux facteurs, vieille de ` +
      `${Math.round((Date.now() - connecteA) / 1000)} s, vire encore (${ancienne.status}) : ` +
      `l'âge maximal de ${AGE_MAX_CONNEXION_S} s n'est pas appliqué.`,
  );
}
if (!estRefus(ancienne.status)) {
  exit(
    10,
    `CAUSE=reponse-inattendue — la connexion ancienne obtient ${extrait(ancienne)}`,
  );
}

console.log(
  `ok — POST ${ROUTE_VIREMENT} : anonyme ${anonyme.status}, mot de passe seul ` +
    `${motDePasse.status}, deux facteurs ${conforme.status}, après ` +
    `${Math.round(ATTENTE_MS / 1000)} s ${ancienne.status}`,
);
process.exit(0);
