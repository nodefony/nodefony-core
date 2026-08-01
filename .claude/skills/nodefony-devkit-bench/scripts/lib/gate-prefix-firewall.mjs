/**
 * Juge de la tâche « protéger un préfixe, pas des routes une par une ».
 *
 * Un ensemble de routes qui doivent toutes exiger une identité se protège par
 * une ZONE (`areas.<z>.pattern` + `authenticators`) : elle couvre ce qui existe
 * et ce qui viendra. Le geste qui en tient lieu — un `@IsGranted` recopié sur
 * chaque action écrite — satisfait toute sonde qui ne regarde que les routes de
 * l'énoncé, et laisse la route sœur ajoutée le mois suivant naître ouverte.
 * Aucun test du dépôt ne voit cela : il n'y a rien à voir, c'est une ABSENCE.
 *
 * D'où le REPÈRE : une troisième route sous le MÊME préfixe, posée par le décor
 * avec le générateur du framework (`create entity`, commitée avant l'agent), que
 * l'énoncé ne mentionne jamais et que l'agent n'a aucune raison de toucher. Une
 * zone la ferme sans qu'on la nomme ; des décorateurs recopiés la laissent
 * ouverte. Sans elle, ce juge serait un doublon de « protège une route ».
 *
 * ⚠️ **Ce que l'attaque seule ne peut pas voir.** Un agent qui décore route par
 * route ET décore aussi le repère (il est dans les sources, il peut le lire)
 * rendrait ce juge vert sans avoir posé de zone. Deux sondes de CONTENU le
 * prennent : la zone doit être DÉCLARÉE, et le fichier du repère ne doit PAS
 * figurer parmi les fichiers touchés. Chaque contournement par un étage — c'est
 * la doctrine du double étage, écrite ici pour qu'on ne la relise pas comme un
 * oubli.
 *
 * | Sortie | Cause                        | Qui est en cause                        |
 * | -----: | ---------------------------- | --------------------------------------- |
 * |    `0` | conforme                     | —                                       |
 * |    `1` | prefixe-ouvert-a-l-anonyme   | l'AGENT — rien ne protège               |
 * |    `2` | repere-de-prefixe-ouvert     | l'AGENT — des décorateurs, pas une zone |
 * |    `3` | prefixe-inaccessible         | l'AGENT — refuse aussi le légitime      |
 * |    `4` | aucune-reponse (+ variantes) | INDÉTERMINÉ                             |
 * |    `5` | port-deja-tenu               | le DÉCOR                                |
 * |    `6` | route-absente                | l'AGENT — rien n'a été monté            |
 * |    `7` | identite-admin-indisponible  | INDÉTERMINÉ                             |
 * |    `8` | repere-de-prefixe-absent     | l'AGENT — le repère a disparu           |
 * |    `9` | identite-temoin-indisponible | INDÉTERMINÉ                             |
 * |   `10` | reponse-inattendue (+ var.)  | l'AGENT                                 |
 * |   `11` | prefixe-elargi-hors-cible    | l'AGENT — a fermé au-delà du besoin     |
 *
 * **Une zone taillée au plus juste sur les deux chemins de l'énoncé rougit ICI,
 * et c'est voulu.** L'énoncé parle d'un espace, pas de deux routes isolées ; une
 * protection qui ne suit pas la forme du préfixe reproduit exactement le défaut
 * mesuré. À l'autre bout, fermer `^/api` en entier rougit aussi (`11`) : le
 * reste de l'application n'a pas à devenir privé pour que « mon compte » le
 * soit.
 *
 * @module
 */
import {
  REPERE_PREFIXE_COMPTE,
  ROUTE_COMPTE_FACTURES,
  ROUTE_COMPTE_PROFIL,
  ROUTE_PUBLIQUE_HORS_PREFIXE,
} from "./enonces.mjs";
import { Bocal, demander, garderPortLibre, sortir } from "./http-probe.mjs";
import {
  TEMOIN,
  estRefus,
  estSucces,
  etablirIdentites,
  repondreArgsTemoin,
} from "./identites.mjs";

/** Les deux routes que l'énoncé nomme — mesurées ensemble, jamais l'une seule. */
const ROUTES_ENONCE = [ROUTE_COMPTE_PROFIL, ROUTE_COMPTE_FACTURES];

repondreArgsTemoin();
await garderPortLibre();

// ─── 0. LE DÉCOR D'ABORD — causes 4, 7 et 9, jamais l'agent ────────────────
const { temoin } = await etablirIdentites();

// ─── 1. L'ANONYME sur les deux routes DE L'ÉNONCÉ ──────────────────────────
for (const route of ROUTES_ENONCE) {
  const r = await demander("GET", route, new Bocal());
  if (r.erreur) {
    sortir(
      4,
      `CAUSE=aucune-reponse — GET ${route} n'obtient rien : ${r.erreur}. Le serveur n'a pas ` +
        `démarré, ou pas sur ce port. Rien n'a été mesuré.`,
    );
  }
  if (r.statut === 404) {
    sortir(
      6,
      `CAUSE=route-absente — GET ${route} rend 404 : une des deux routes que l'énoncé nomme ` +
        `n'est pas montée. L'action n'a pas été écrite, la route pas déclarée, ou l'application ` +
        `pas rebâtie — le runtime charge le dist, pas les sources.`,
    );
  }
  if (estSucces(r.statut)) {
    sortir(
      1,
      `CAUSE=prefixe-ouvert-a-l-anonyme — GET ${route} rend ${r.statut} SANS aucune identité, ` +
        `alors que l'énoncé réserve « mon compte » aux personnes connectées. ` +
        `Corps : ${r.corps.slice(0, 160)}`,
    );
  }
  if (!estRefus(r.statut)) {
    sortir(
      10,
      `CAUSE=reponse-inattendue — GET ${route} rend ${r.statut} à un anonyme : ni refus ` +
        `(401/403) ni succès. Corps : ${r.corps.slice(0, 160)}`,
    );
  }
}

// ─── 2. LE TÉMOIN — le service est-il rendu à qui y a droit ? ──────────────
for (const route of ROUTES_ENONCE) {
  const r = await demander("GET", route, temoin);
  if (r.erreur) {
    sortir(4, `CAUSE=aucune-reponse-temoin — GET ${route} : ${r.erreur}`);
  }
  if (!estSucces(r.statut)) {
    sortir(
      3,
      `CAUSE=prefixe-inaccessible — « ${TEMOIN.username} », authentifié, obtient ${r.statut} sur ` +
        `GET ${route}, alors que l'énoncé ouvre « mon compte » à toute personne connectée. La ` +
        `garde exige davantage qu'une identité — un rôle, typiquement — et le service décrit ` +
        `n'est pas rendu. Corps : ${r.corps.slice(0, 120)}`,
    );
  }
}

// ─── 3. LE REPÈRE — une ZONE, ou deux décorateurs ? ────────────────────────
// Le pas décisif, et le seul que les routes de l'énoncé ne peuvent pas rendre.
const repere = await demander("GET", REPERE_PREFIXE_COMPTE, new Bocal());
if (repere.erreur) {
  sortir(
    4,
    `CAUSE=aucune-reponse-repere — GET ${REPERE_PREFIXE_COMPTE} : ${repere.erreur}`,
  );
}
if (repere.statut === 404) {
  sortir(
    8,
    `CAUSE=repere-de-prefixe-absent — GET ${REPERE_PREFIXE_COMPTE} rend 404 : la ressource posée ` +
      `par le décor avec le générateur du framework, AVANT l'agent et commitée à part, a disparu. ` +
      `Elle n'était pas dans le périmètre de l'énoncé, et c'est elle qui distingue une zone de ` +
      `deux décorateurs recopiés. Sans elle, ce verdict ne peut pas être rendu.`,
  );
}
if (estSucces(repere.statut)) {
  sortir(
    2,
    `CAUSE=repere-de-prefixe-ouvert — GET ${REPERE_PREFIXE_COMPTE} rend ${repere.statut} à un ` +
      `ANONYME. Cette route est sous le MÊME préfixe que ${ROUTE_COMPTE_PROFIL} et ` +
      `${ROUTE_COMPTE_FACTURES}, posée par le décor et jamais mentionnée à l'agent — et elle est ` +
      `restée ouverte. Les deux routes de l'énoncé ont donc été protégées une par une, pas par ` +
      `une zone qui couvre le PRÉFIXE : toute route sœur ajoutée ensuite naîtra ouverte elle ` +
      `aussi, sans que rien ne le signale.`,
  );
}
if (!estRefus(repere.statut)) {
  sortir(
    10,
    `CAUSE=reponse-inattendue-repere — GET ${REPERE_PREFIXE_COMPTE} rend ${repere.statut} à un ` +
      `anonyme : ni refus ni succès. Corps : ${repere.corps.slice(0, 160)}`,
  );
}

// ─── 4. HORS PRÉFIXE — la protection a-t-elle débordé ? ────────────────────
const publique = await demander(
  "GET",
  ROUTE_PUBLIQUE_HORS_PREFIXE,
  new Bocal(),
);
if (publique.erreur) {
  sortir(
    4,
    `CAUSE=aucune-reponse-publique — GET ${ROUTE_PUBLIQUE_HORS_PREFIXE} : ${publique.erreur}`,
  );
}
if (!estSucces(publique.statut)) {
  sortir(
    11,
    `CAUSE=prefixe-elargi-hors-cible — GET ${ROUTE_PUBLIQUE_HORS_PREFIXE} rend ` +
      `${publique.statut} à un anonyme, alors que cette route n'a rien à voir avec « mon ` +
      `compte » : elle vient du preset, et la zone livrée la laissait publique. La protection a ` +
      `été posée sur un préfixe plus large que celui demandé — l'application entière est devenue ` +
      `privée pour qu'un espace le soit.`,
  );
}

console.log(
  `ok — /api/account : anonyme refusé sur les ${ROUTES_ENONCE.length} routes de l'énoncé, ` +
    `« ${TEMOIN.username} » servi ; repère du même préfixe couvert sans avoir été nommé ` +
    `(${repere.statut}) ; ${ROUTE_PUBLIQUE_HORS_PREFIXE} toujours public (${publique.statut})`,
);
process.exit(0);
