/**
 * Valeur d'un compteur tel qu'il traverse HTTP : un nombre, ou `null` quand le
 * backend branché ne sait pas répondre.
 *
 * `null` n'est pas `0`, et c'est tout l'intérêt de ce type. Un store en curseur
 * (Redis `SCAN`) refuse le comptage exact — il coûterait un parcours complet du
 * keyspace — et le dit en rendant `-1` ({@link UNKNOWN_COUNT}). Sans un canal
 * distinct pour l'inconnu, cette réponse arriverait au navigateur sous la forme
 * d'un zéro, et une console d'administration afficherait « 0 session » là où il
 * y en a des milliers.
 */
export type FacetCount = number | null;

/**
 * Ce qu'un store rend quand il ne PEUT pas compter — convention de tous les
 * backends du dépôt (`countSessions`, `countTokens`, `countEndpoints`).
 *
 * Une valeur sentinelle plutôt qu'une exception : ne pas savoir compter est un
 * état nominal d'un backend en curseur, pas une panne.
 */
export const UNKNOWN_COUNT = -1;

/**
 * Les compteurs rendus, une clé par facette déclarée.
 *
 * Le type dérive de la déclaration : ajouter une facette à la constante ajoute
 * sa clé ici, et le consommateur qui l'oublie ne compile plus.
 */
export type FacetCounts<S> = { [K in keyof S]: FacetCount };

/**
 * Compte plusieurs **facettes** d'une même collection en un seul geste.
 *
 * Une facette est une question fermée posée à la collection entière — « combien
 * de sessions authentifiées ? », « combien de clés révoquées ? ». C'est ce que
 * les cartes en tête d'un écran d'administration prétendent afficher, et ce
 * qu'elles calculaient jusqu'ici **sur la page chargée** : avec une fenêtre de
 * 25 lignes, une carte annonçant « 3 comptes actifs » décrit trois lignes
 * visibles, pas l'annuaire. Un nombre présenté sans qualificatif est lu comme un
 * total ; le corriger d'une mention en petits caractères ne le rend pas vrai.
 *
 * L'algorithme vit ici en **un seul exemplaire** ; ce qui varie d'une ressource
 * à l'autre est la **donnée** — la table des facettes — qui se déclare à côté du
 * contrat de la ressource, jamais sous forme de fonction.
 *
 * Aucune facette n'est dérivée d'une autre (`inactive = total - active`) : deux
 * facettes peuvent se recouvrir (un compte peut être à la fois désactivé et
 * verrouillé), et une soustraction rendrait alors un nombre que rien ne compte.
 * Chaque facette est une question posée telle quelle au store.
 *
 * @param facets - nom public → filtre à appliquer. Un filtre vide compte tout.
 * @param count - le compteur du store, appelé une fois par facette. Il rend
 *   {@link UNKNOWN_COUNT} lorsqu'il ne sait pas compter.
 * @returns un compteur par facette, `null` là où le store a répondu « inconnu ».
 *
 * @remarks **Cold path d'administration.** Les facettes partent en parallèle
 *   (une requête `COUNT` chacune) : c'est acceptable pour quatre questions
 *   posées à l'ouverture d'un écran, et ce ne serait pas acceptable dans un
 *   chemin de requête. Ne pas rejouer ces comptages à chaque tour de page — ils
 *   ne dépendent ni de `limit`, ni de `offset`, ni de l'ordre.
 *
 * @example
 * ```ts
 * const SESSION_FACETS = {
 *   total: {},
 *   authenticated: { authenticated: true },
 *   anonymous: { authenticated: false },
 * } as const satisfies IFacetSpec<ISessionListQuery>;
 *
 * const counts = await countFacets(SESSION_FACETS, (q) => storage.countSessions(q));
 * // → { total: 1204, authenticated: 87, anonymous: 1117 }   (Redis : que des null)
 * ```
 */
export async function countFacets<S extends Readonly<Record<string, object>>>(
  facets: S,
  count: (query: S[keyof S]) => number | Promise<number>,
): Promise<FacetCounts<S>> {
  const names = Object.keys(facets) as Array<keyof S & string>;
  const values = await Promise.all(
    names.map(async (name) => {
      const n = await count(facets[name]);
      return Number.isFinite(n) && n >= 0 ? n : null;
    }),
  );

  const out = {} as FacetCounts<S>;
  for (let i = 0; i < names.length; i++) {
    out[names[i]] = values[i];
  }
  return out;
}

/**
 * Déclaration des facettes d'une ressource : nom public → filtre de sa requête
 * de liste.
 *
 * Le paramètre `Q` est le contrat de liste de la ressource
 * (`ISessionListQuery`, `ITokenListQuery`…), ce qui interdit à la compilation
 * de déclarer une facette sur un champ que le store ne sait pas filtrer. C'est
 * la garde qui empêche de réintroduire le compteur approximatif : une facette
 * qui n'est pas exprimable comme un filtre du contrat n'est pas une facette —
 * elle exige soit d'étendre le contrat, soit une capacité déclarée à part
 * (le cas d'un décompte de valeurs distinctes, qu'un `COUNT` filtré ne rend
 * pas).
 */
export type IFacetSpec<Q> = Readonly<Record<string, Partial<Q>>>;
