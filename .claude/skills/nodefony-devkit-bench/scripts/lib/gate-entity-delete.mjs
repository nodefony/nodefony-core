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
import { Bocal, demander, garderPortLibre, sortir } from "./http-probe.mjs";
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
await garderPortLibre();

// ─── 0. LE DÉCOR D'ABORD — causes 4, 7 et 9, partagées, jamais l'agent ──────
const { admin, temoin } = await etablirIdentites();

/**
 * Sème le jeton anti-rejeu si — et seulement si — l'application en exige un.
 *
 * Une requête sûre vers une route protégée par `@CsrfProtect` dépose le cookie ;
 * sans cette protection, rien n'est déposé et l'en-tête ne sera pas envoyé. Le
 * juge s'adapte donc à ce que l'agent a fait, au lieu de présumer. Sans ce pas,
 * un agent qui protège AUSSI ses mutations contre le rejeu verrait son
 * administrateur refusé, et le juge lui reprocherait une garde trop stricte.
 *
 * @param {Bocal} bocal - bocal de l'identité concernée.
 * @returns {Promise<void>}
 */
const semerJeton = async (bocal) => {
  await demander("GET", COLLECTION, bocal);
};

await semerJeton(admin);
await semerJeton(temoin);

// ─── 1. L'ADMINISTRATEUR CRÉE — sans ressource, rien à mesurer ──────────────
const cree = await demander("POST", COLLECTION, admin, {
  corps: FACTURE,
  jeton: admin.jeton(),
});
if (cree.erreur) sortir(4, `CAUSE=aucune-reponse — ${cree.erreur}`);
if (cree.statut === 404) {
  sortir(
    6,
    `CAUSE=ressource-absente — POST ${COLLECTION} rend 404 : la collection que l'énoncé nomme ` +
      `n'est pas montée. L'entité n'a pas été générée, pas enregistrée dans le manifeste, ou ` +
      `l'application n'a pas été rebâtie — le runtime charge le dist, pas les sources.`,
  );
}
if (!estSucces(cree.statut)) {
  sortir(
    8,
    `CAUSE=creation-refusee — POST ${COLLECTION} rend ${cree.statut} pour l'administrateur : ` +
      `impossible de créer la facture à supprimer, donc impossible de mesurer la suppression. ` +
      `La garde n'est pas en cause. Corps : ${cree.corps.slice(0, 160)}`,
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
    const objet = JSON.parse(cree.corps);
    if (objet && objet.id !== undefined && objet.id !== null) {
      return String(objet.id);
    }
  } catch {
    /* corps non JSON — on tentera l'en-tête */
  }
  const emplacement = cree.entetes?.location;
  return emplacement ? String(emplacement).split("/").pop() : "";
})();

if (!identifiant) {
  sortir(
    8,
    `CAUSE=creation-refusee — POST ${COLLECTION} rend ${cree.statut} mais aucun identifiant ` +
      `n'est lisible, ni dans le corps (clé « id ») ni dans l'en-tête Location. Il n'y a rien ` +
      `à supprimer. Corps : ${cree.corps.slice(0, 160)}`,
  );
}

const ELEMENT = `${COLLECTION}/${identifiant}`;

/**
 * Sur une suppression, 404 est un refus légitime (ne pas divulguer l'existence).
 *
 * @param {number} statut - code reçu.
 * @returns {boolean} vrai si la suppression a été refusée d'une façon ou d'une autre.
 */
const suppressionRefusee = (statut) => estRefus(statut) || statut === 404;

// ─── 2. L'ANONYME — la destruction est-elle ouverte à tous ? ────────────────
const parAnonyme = await demander("DELETE", ELEMENT, new Bocal());
if (parAnonyme.erreur)
  sortir(4, `CAUSE=aucune-reponse-anonyme — ${parAnonyme.erreur}`);
if (estSucces(parAnonyme.statut)) {
  sortir(
    1,
    `CAUSE=suppression-ouverte-a-l-anonyme — DELETE ${ELEMENT} rend ${parAnonyme.statut} SANS ` +
      `aucune identité : n'importe qui détruit les données. Le CRUD généré ne porte aucune ` +
      `garde — c'est au développeur de la poser, et rien dans le code produit ne le rappelle.`,
  );
}
if (!suppressionRefusee(parAnonyme.statut)) {
  sortir(
    10,
    `CAUSE=reponse-inattendue — DELETE ${ELEMENT} rend ${parAnonyme.statut} à un anonyme : ni ` +
      `refus (401/403/404), ni succès. Corps : ${parAnonyme.corps.slice(0, 160)}`,
  );
}

// ─── 3. LE TÉMOIN — avoir un compte ne donne pas le droit de détruire ───────
const parTemoin = await demander("DELETE", ELEMENT, temoin, {
  jeton: temoin.jeton(),
});
if (parTemoin.erreur)
  sortir(4, `CAUSE=aucune-reponse-temoin — ${parTemoin.erreur}`);
if (estSucces(parTemoin.statut)) {
  sortir(
    2,
    `CAUSE=role-non-discriminant — « ${TEMOIN.username} » (authentifié, aucun rôle ` +
      `d'administration) supprime la facture (${parTemoin.statut}). La suppression exige une ` +
      `IDENTITÉ mais aucun RÔLE : tout titulaire d'un compte peut détruire les données d'un ` +
      `autre. C'est le contournement le plus fréquent sur un CRUD généré.`,
  );
}
if (!suppressionRefusee(parTemoin.statut)) {
  sortir(
    10,
    `CAUSE=reponse-inattendue-temoin — DELETE ${ELEMENT} rend ${parTemoin.statut} à un ` +
      `utilisateur authentifié : ni refus ni succès. Corps : ${parTemoin.corps.slice(0, 160)}`,
  );
}

// ─── 4. L'ADMINISTRATEUR — la garde laisse-t-elle passer son destinataire ? ─
const parAdmin = await demander("DELETE", ELEMENT, admin, {
  jeton: admin.jeton(),
});
if (parAdmin.erreur)
  sortir(4, `CAUSE=aucune-reponse-admin — ${parAdmin.erreur}`);
if (!estSucces(parAdmin.statut)) {
  sortir(
    3,
    `CAUSE=admin-refuse — « ${ADMIN.username} », porteur de ROLE_ADMIN, obtient ` +
      `${parAdmin.statut} en supprimant une facture qu'il vient de créer. Plus personne ne peut ` +
      `détruire : la protection a été posée sur une action ou un rôle qui exclut son ` +
      `destinataire — ou la route de suppression n'existe pas. Corps : ` +
      `${parAdmin.corps.slice(0, 160)}`,
  );
}

console.log(
  `ok — ${ELEMENT} : anonyme refusé (${parAnonyme.statut}), « ${TEMOIN.username} » authentifié ` +
    `refusé (${parTemoin.statut}), « ${ADMIN.username} » a supprimé (${parAdmin.statut})`,
);
process.exit(0);
