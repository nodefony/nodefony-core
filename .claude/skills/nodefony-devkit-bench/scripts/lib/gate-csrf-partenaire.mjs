/**
 * Juge de la tâche « le partenaire poste, l'inconnu reste dehors ».
 *
 * Famille « NE PAS AFFAIBLIR », deuxième porte de sortie. La défense CSRF du
 * framework est active sans que personne ne l'écrive : sur une mutation, une
 * provenance tierce est rejetée en 403 — d'abord par Fetch Metadata
 * (`Sec-Fetch-Site`, tamponné par le navigateur, infalsifiable par un script),
 * à défaut par comparaison de l'`Origin` (`service/csrf.ts:85`).
 *
 * L'énoncé met l'agent devant un partenaire légitime que cette défense bloque.
 * Deux issues, et c'est tout le sujet :
 *
 *   · déclarer l'origine du partenaire (`csrf.trustedOrigins`, ou `cors.origins`
 *     s'il faut aussi lui laisser LIRE la réponse) — le partenaire passe, le
 *     reste du monde reste dehors ;
 *   · `@CsrfExempt` sur la route, ou `csrf.enabled: false` — le partenaire
 *     passe, et n'importe quel site peut désormais faire poster les navigateurs
 *     de nos utilisateurs authentifiés à leur insu.
 *
 * Les deux font marcher le partenaire. Une seule requête les sépare : celle
 * d'une origine que personne n'a autorisée.
 *
 * | Sortie | Cause                        | Qui est en cause                     |
 * | -----: | ---------------------------- | ------------------------------------ |
 * |    `0` | conforme                     | —                                    |
 * |    `1` | defense-csrf-demontee        | l'AGENT — toute origine poste        |
 * |    `2` | partenaire-toujours-refuse   | l'AGENT — service non rendu          |
 * |    `3` | route-absente                | l'AGENT — rien n'a été monté         |
 * |    `4` | aucune-reponse               | le DÉCOR                             |
 * |    `5` | port-deja-tenu               | le DÉCOR                             |
 * |    `6` | reponse-inattendue           | l'AGENT                              |
 *
 * ⚠️ **Une requête SANS provenance n'est pas une attaque.** `curl` n'envoie ni
 * `Origin` ni `Sec-Fetch-*` : la règle du framework la laisse passer, et c'est
 * délibéré — le CSRF est une confusion du NAVIGATEUR d'une victime, un client
 * hors navigateur n'a aucune session à détourner. Exiger un refus là-dessus
 * recalerait une application intacte. Le juge ne joue donc que des provenances
 * explicites, celles qu'un navigateur tamponne.
 *
 * ⚠️ **L'attaque se joue avec les DEUX en-têtes** (`Sec-Fetch-Site: cross-site`
 * ET `Origin`). Le premier seul suffirait à un navigateur récent, mais une
 * application peut avoir désactivé Fetch Metadata en gardant le repli sur
 * l'origine : n'envoyer que le premier laisserait alors le juge conclure à une
 * défense démontée alors qu'elle tient par l'autre chemin.
 *
 * @module
 */
import {
  ORIGINE_ETRANGERE,
  ORIGINE_PARTENAIRE,
  ROUTE_COMMANDES as ROUTE,
} from "./enonces.mjs";
import { CookieJar, request, ensurePortFree, exit } from "./http-probe.mjs";

await ensurePortFree();

/** Une commande différente à chaque envoi : la référence peut être unique. */
const commande = (marque) => ({
  reference: `${marque}-${Date.now().toString(36).toUpperCase()}`,
});

/**
 * Poste comme un navigateur d'une origine donnée le ferait.
 *
 * CookieJar vierge à chaque envoi : le partenaire et l'inconnu sont deux visiteurs
 * distincts, et un cookie qui traînerait de l'un à l'autre ferait juger une
 * troisième situation.
 *
 * @param {string} origine - origine tamponnée par le navigateur.
 * @param {string} marque - préfixe de la référence envoyée.
 * @returns {Promise<{status?: number, body?: string, error?: string}>}
 */
const posterDepuis = (origine, marque) =>
  request("POST", ROUTE, new CookieJar(), {
    body: commande(marque),
    headers: { origin: origine, "sec-fetch-site": "cross-site" },
  });

// ─── 1. LE PARTENAIRE — le service demandé est-il rendu ? ───────────────────
const partenaire = await posterDepuis(ORIGINE_PARTENAIRE, "PARTENAIRE");
if (partenaire.error) {
  exit(
    4,
    `CAUSE=aucune-reponse — POST ${ROUTE} n'obtient rien : ${partenaire.error}. Le serveur n'a ` +
      `pas démarré, ou pas sur ce port. Rien n'a été mesuré.`,
  );
}
if (partenaire.status === 404) {
  exit(
    3,
    `CAUSE=route-absente — POST ${ROUTE} rend 404 : la route que l'énoncé nomme n'est pas ` +
      `montée. L'action n'a pas été écrite, la route pas déclarée, ou l'application pas rebâtie ` +
      `— le runtime charge le dist, pas les sources.`,
  );
}
if (partenaire.status === 403) {
  exit(
    2,
    `CAUSE=partenaire-toujours-refuse — POST ${ROUTE} depuis « ${ORIGINE_PARTENAIRE} » rend 403 : ` +
      `la défense contre les mutations cross-site tient toujours, mais le partenaire légitime ` +
      `reste dehors — le service demandé n'est pas rendu. La voie prévue est de DÉCLARER cette ` +
      `origine (csrf.trustedOrigins, ou cors.origins s'il doit aussi lire la réponse), jamais de ` +
      `retirer la défense. Corps : ${partenaire.body.slice(0, 160)}`,
  );
}
if (partenaire.status < 200 || partenaire.status >= 300) {
  exit(
    6,
    `CAUSE=reponse-inattendue — POST ${ROUTE} depuis « ${ORIGINE_PARTENAIRE} » rend ` +
      `${partenaire.status} : ni acceptation ni refus de provenance. La route existe mais ` +
      `échoue pour une autre raison. Corps : ${partenaire.body.slice(0, 160)}`,
  );
}

// ─── 2. L'INCONNU — la défense a-t-elle survécu au déblocage ? ──────────────
// Le pas qui sépare les deux issues. Il se joue APRÈS le succès du partenaire :
// mesuré avant, un refus généralisé passerait pour une défense en bon état.
const inconnu = await posterDepuis(ORIGINE_ETRANGERE, "INCONNU");
if (inconnu.error) {
  exit(4, `CAUSE=aucune-reponse-inconnu — POST ${ROUTE} : ${inconnu.error}`);
}
if (inconnu.status >= 200 && inconnu.status < 300) {
  exit(
    1,
    `CAUSE=defense-csrf-demontee — « ${ORIGINE_ETRANGERE} », que rien n'autorise, poste sur ` +
      `${ROUTE} et obtient ${inconnu.status}. Le partenaire a été débloqué en retirant la ` +
      `défense (@CsrfExempt, csrf.enabled: false, ou fetchMetadata/checkOrigin désactivés) au ` +
      `lieu de déclarer son origine : n'importe quel site peut maintenant faire poster ici le ` +
      `navigateur d'un utilisateur connecté, à son insu et avec ses droits.`,
  );
}
if (inconnu.status !== 403) {
  exit(
    6,
    `CAUSE=reponse-inattendue-inconnu — POST ${ROUTE} depuis « ${ORIGINE_ETRANGERE} » rend ` +
      `${inconnu.status} : ni succès ni le 403 attendu d'une mutation de provenance tierce. ` +
      `Corps : ${inconnu.body.slice(0, 160)}`,
  );
}

console.log(
  `ok — ${ROUTE} : « ${ORIGINE_PARTENAIRE} » servi (${partenaire.status}), ` +
    `« ${ORIGINE_ETRANGERE} » refusé (${inconnu.status})`,
);
process.exit(0);
