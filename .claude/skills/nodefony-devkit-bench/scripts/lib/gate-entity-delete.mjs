/**
 * Juge de la tâche « le CRUD généré peut être protégé » — sur l'action qui
 * DÉTRUIT.
 *
 * Pourquoi celle-là et pas une autre : le générateur d'entité est le seul du
 * devkit qui produise des routes destructrices, et son gabarit de controller ne
 * dit pas un mot de sécurité — là où le gabarit `rest` de `create controller`
 * pose, lui, un `@IsGranted("ROLE_ADMIN")` sur son DELETE. Un agent qui fait
 * confiance au code généré livre donc une suppression ouverte, sans qu'aucun
 * avertissement ne l'ait alerté. Ce juge le PROUVE au lieu de l'affirmer.
 *
 * Le trajet : l'administrateur crée une facture, puis trois identités tentent
 * de la supprimer. La ressource n'est détruite qu'au dernier pas — les deux
 * premiers doivent échouer, donc elle est toujours là quand l'admin arrive.
 *
 * | Sortie | Cause                          | Qui est en cause               |
 * | -----: | ------------------------------ | ------------------------------ |
 * |    `0` | conforme                       | —                              |
 * |    `1` | suppression-ouverte-a-l-anonyme| l'AGENT — n'importe qui détruit |
 * |    `2` | role-non-discriminant          | l'AGENT — tout compte détruit  |
 * |    `3` | admin-refuse                   | l'AGENT — plus personne ne peut |
 * |    `4` | aucune-reponse                 | le DÉCOR                       |
 * |    `5` | port-deja-tenu                 | le DÉCOR                       |
 * |    `6` | ressource-absente              | l'AGENT — rien n'a été monté   |
 * |    `7` | identite-admin-indisponible    | le DÉCOR                       |
 * |    `8` | creation-refusee               | l'AGENT — rien à supprimer     |
 * |    `9` | identite-temoin-indisponible   | le DÉCOR                       |
 * |   `10` | reponse-inattendue             | l'AGENT                        |
 *
 * ⚠️ **Sur une suppression, 404 compte comme un REFUS.** Répondre « cette
 * ressource n'existe pas » plutôt que « vous n'y avez pas droit » est une
 * pratique de sécurité légitime — elle ne divulgue pas l'existence de l'objet.
 * Recaler un agent qui la choisit serait punir la prudence. Le cas « la route
 * de suppression n'existe pas du tout » n'est pas perdu pour autant : il tombe
 * alors sur l'administrateur, en cause `3`.
 *
 * ⚠️ **Ce juge ne vérifie PAS que la suppression a réellement effacé la ligne.**
 * C'est le travail du banc de vérité (`verify-generated.mjs` : 204 puis 404), et
 * une cause de plus ici diluerait le verdict de sécurité dans un verdict de
 * CRUD. Un juge répond à UNE question.
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
  ADMIN,
  TEMOIN,
  estRefus,
  estSucces,
  etablirIdentites,
  repondreArgsTemoin,
} from "./identites.mjs";

/** Collection figée par l'énoncé : le juge ne devine aucun pluriel. */
const COLLECTION = "/api/invoices";

/**
 * Référence unique à chaque run — le champ est déclaré unique par l'énoncé.
 *
 * Une valeur figée ferait échouer le second run en 409, et le juge accuserait
 * l'agent d'une création refusée qui n'est que la trace du run précédent. La
 * base du décor survit d'un gate à l'autre.
 */
const REFERENCE = `BENCH-${Date.now().toString(36).toUpperCase()}`;
const FACTURE = { reference: REFERENCE, amount: 4242 };

repondreArgsTemoin();
await ensurePortFree();

// ─── 0. LE DÉCOR D'ABORD — causes 4, 7 et 9, partagées, jamais l'agent ──────
const { admin, temoin } = await etablirIdentites();

// Se munir du jeton anti-rejeu AVANT toute mutation : sans ce pas, un agent qui
// protège aussi ses écritures verrait son administrateur refusé, et le juge lui
// reprocherait une garde trop stricte. Le pourquoi complet : `semerJeton`.
await semerJeton(admin, COLLECTION);
await semerJeton(temoin, COLLECTION);

// ─── 1. L'ADMINISTRATEUR CRÉE — sans ressource, rien à mesurer ──────────────
const cree = await request("POST", COLLECTION, admin, {
  body: FACTURE,
  csrfToken: admin.csrfToken(),
});
if (cree.error) exit(4, `CAUSE=aucune-reponse — ${cree.error}`);
if (cree.status === 404) {
  exit(
    6,
    `CAUSE=ressource-absente — POST ${COLLECTION} rend 404 : la collection que l'énoncé nomme ` +
      `n'est pas montée. L'entité n'a pas été générée, pas enregistrée dans le manifeste, ou ` +
      `l'application n'a pas été rebâtie — le runtime charge le dist, pas les sources.`,
  );
}
if (!estSucces(cree.status)) {
  exit(
    8,
    `CAUSE=creation-refusee — POST ${COLLECTION} rend ${cree.status} pour l'administrateur : ` +
      `impossible de créer la facture à supprimer, donc impossible de mesurer la suppression. ` +
      `La garde n'est pas en cause. Corps : ${cree.body.slice(0, 160)}`,
  );
}

/**
 * L'identifiant de la ressource créée, tel que le contrat de ressource le rend.
 *
 * Lu dans le corps, et non déduit de l'en-tête `Location` : les deux le
 * portent, mais le corps est la source que les tests générés consomment eux
 * aussi. À défaut, on retombe sur `Location`, dont le format est
 * `<collection>/<id>`.
 */
const identifiant = (() => {
  try {
    const objet = JSON.parse(cree.body);
    if (objet && objet.id !== undefined && objet.id !== null) {
      return String(objet.id);
    }
  } catch {
    /* corps non JSON — on tentera l'en-tête */
  }
  const emplacement = cree.headers?.location;
  return emplacement ? String(emplacement).split("/").pop() : "";
})();

if (!identifiant) {
  exit(
    8,
    `CAUSE=creation-refusee — POST ${COLLECTION} rend ${cree.status} mais aucun identifiant ` +
      `n'est lisible, ni dans le body (clé « id ») ni dans l'en-tête Location. Il n'y a rien ` +
      `à supprimer. Corps : ${cree.body.slice(0, 160)}`,
  );
}

const ELEMENT = `${COLLECTION}/${identifiant}`;

/**
 * Sur une suppression, 404 est un refus légitime (ne pas divulguer l'existence).
 *
 * @param {number} statut - code reçu.
 * @returns {boolean} vrai si la suppression a été refusée d'une façon ou d'une autre.
 */
const suppressionRefusee = (status) => estRefus(status) || status === 404;

// ─── 2. L'ANONYME — la destruction est-elle ouverte à tous ? ────────────────
const parAnonyme = await request("DELETE", ELEMENT, new CookieJar());
if (parAnonyme.error)
  exit(4, `CAUSE=aucune-reponse-anonyme — ${parAnonyme.error}`);
if (estSucces(parAnonyme.status)) {
  exit(
    1,
    `CAUSE=suppression-ouverte-a-l-anonyme — DELETE ${ELEMENT} rend ${parAnonyme.status} SANS ` +
      `aucune identité : n'importe qui détruit les données. Le CRUD généré ne porte aucune ` +
      `garde — c'est au développeur de la poser, et rien dans le code produit ne le rappelle.`,
  );
}
if (!suppressionRefusee(parAnonyme.status)) {
  exit(
    10,
    `CAUSE=reponse-inattendue — DELETE ${ELEMENT} rend ${parAnonyme.status} à un anonyme : ni ` +
      `refus (401/403/404), ni succès. Corps : ${parAnonyme.body.slice(0, 160)}`,
  );
}

// ─── 3. LE TÉMOIN — avoir un compte ne donne pas le droit de détruire ───────
const parTemoin = await request("DELETE", ELEMENT, temoin, {
  csrfToken: temoin.csrfToken(),
});
if (parTemoin.error)
  exit(4, `CAUSE=aucune-reponse-temoin — ${parTemoin.error}`);
if (estSucces(parTemoin.status)) {
  exit(
    2,
    `CAUSE=role-non-discriminant — « ${TEMOIN.username} » (authentifié, aucun rôle ` +
      `d'administration) supprime la facture (${parTemoin.status}). La suppression exige une ` +
      `IDENTITÉ mais aucun RÔLE : tout titulaire d'un compte peut détruire les données d'un ` +
      `autre. C'est le contournement le plus fréquent sur un CRUD généré.`,
  );
}
if (!suppressionRefusee(parTemoin.status)) {
  exit(
    10,
    `CAUSE=reponse-inattendue-temoin — DELETE ${ELEMENT} rend ${parTemoin.status} à un ` +
      `utilisateur authentifié : ni refus ni succès. Corps : ${parTemoin.body.slice(0, 160)}`,
  );
}

// ─── 4. L'ADMINISTRATEUR — la garde laisse-t-elle passer son destinataire ? ─
const parAdmin = await request("DELETE", ELEMENT, admin, {
  csrfToken: admin.csrfToken(),
});
if (parAdmin.error) exit(4, `CAUSE=aucune-reponse-admin — ${parAdmin.error}`);
if (!estSucces(parAdmin.status)) {
  exit(
    3,
    `CAUSE=admin-refuse — « ${ADMIN.username} », porteur de ROLE_ADMIN, obtient ` +
      `${parAdmin.status} en supprimant une facture qu'il vient de créer. Plus personne ne peut ` +
      `détruire : la protection a été posée sur une action ou un rôle qui exclut son ` +
      `destinataire — ou la route de suppression n'existe pas. Corps : ` +
      `${parAdmin.body.slice(0, 160)}`,
  );
}

console.log(
  `ok — ${ELEMENT} : anonyme refusé (${parAnonyme.status}), « ${TEMOIN.username} » authentifié ` +
    `refusé (${parTemoin.status}), « ${ADMIN.username} » a supprimé (${parAdmin.status})`,
);
process.exit(0);
