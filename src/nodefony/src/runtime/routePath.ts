/**
 * Gabarit d'un chemin de route — `"/chat/messages/{id}"` — lu hors du routeur :
 * la socket qui le REMPLIT, le catalogue d'administration qui en LISTE les
 * variables, le contrôle de démarrage qui en VÉRIFIE la forme.
 *
 * La grammaire complète (contrainte en ligne `{id}(\d+)`, segment facultatif
 * `{slug}?`, format `.{format}`) appartient au routeur du framework, qui la
 * compile. Ce fichier n'en lit que la forme SIMPLE — des segments `{nom}` —, la
 * seule qu'un contrat temps réel admet : sur elle, les deux lectures
 * s'accordent, et un test les confronte (`routePath.test.ts` côté framework).
 *
 * Fichier NEUTRE (ni Node, ni DOM) : il voyage dans le paquet du navigateur.
 */

/**
 * Une variable de chemin : `{nom}`. Le nom exclut `{` et `/` — une variable
 * tient dans UN segment —, ce qui rend la lecture LINÉAIRE : avec `[^}]`, une
 * suite de « { » jamais refermés faisait relire tout le reste de la chaîne à
 * chaque position (ReDoS polynomial, 2,4 s sur 50 000 caractères).
 */
const PATH_VARIABLE = /\{([^{}/]+)\}/gu;

/**
 * Noms des variables d'un chemin de route, dans l'ordre d'apparition.
 *
 * @param path - le chemin déclaré (`/chat/messages/{id}`).
 * @returns les noms (`["id"]`), vide si le chemin n'en porte pas.
 */
export function routePathParams(path: string): string[] {
  const found: string[] = [];
  for (const match of path.matchAll(PATH_VARIABLE)) {
    if (match[1]) found.push(match[1]);
  }
  return found;
}

/**
 * Dit si un gabarit n'emploie que la forme simple : des segments `{nom}`
 * entiers, sans contrainte en ligne `(…)`, sans segment facultatif `?`, sans
 * variable collée à un littéral (`.{format}`, `v{n}`).
 *
 * @param path - le chemin déclaré.
 * @returns `true` si chaque variable occupe un segment entier, sous forme `{nom}`.
 */
export function isSimpleRouteTemplate(path: string): boolean {
  if (path.includes("(") || path.includes("?")) return false;
  for (const segment of path.split("/")) {
    if (!segment.includes("{") && !segment.includes("}")) continue;
    if (!/^\{[A-Za-z_][\w-]*\}$/u.test(segment)) return false;
  }
  return true;
}

/**
 * Remplit un gabarit simple avec ses valeurs — chacune encodée pour tenir dans
 * UN segment (`encodeURIComponent` : un `/`, un `?` ou un `#` ne peuvent pas
 * détourner l'appel vers une autre route).
 *
 * Refuse ce qu'aucun encodage ne rend sûr : une valeur vide (le segment
 * disparaîtrait), `.` ou `..` (la normalisation du chemin les résout en
 * remontant d'un cran, encodés ou non), et une variable sans valeur.
 *
 * @param template - le gabarit (`/chat/messages/{id}`).
 * @param params - les valeurs, par nom de variable.
 * @returns le chemin concret (`/chat/messages/42`).
 * @throws TypeError si une variable manque ou porte une valeur interdite ; le
 *   message nomme la variable.
 */
export function fillRoutePath(template: string, params: unknown): string {
  const values =
    typeof params === "object" && params !== null ? params : undefined;
  return template.replace(PATH_VARIABLE, (_match, name: string) => {
    const value: unknown =
      values === undefined ? undefined : Reflect.get(values, name);
    if (typeof value !== "string" && typeof value !== "number") {
      throw new TypeError(
        `paramètre de chemin « ${name} » manquant pour ${template}`,
      );
    }
    const text = String(value);
    if (text === "" || text === "." || text === "..") {
      throw new TypeError(
        `paramètre de chemin « ${name} » invalide (« ${text} ») : un segment ne peut être vide, « . » ni « .. »`,
      );
    }
    return encodeURIComponent(text);
  });
}

/**
 * Une route sert-elle ce VERBE par le pont socket (`api.request`) ? La règle UNIQUE, lue par le routeur à chaque appel et par la vérification des contrats au démarrage.
 *
 * Le transport `WEBSOCKET` est exigé (une route HTTP seule ne se ponte pas),
 * et le verbe LOGIQUE aussi : un `GET` par la socket n'atteint jamais une action
 * `POST` du même chemin — sans quoi il en contournerait la porte `@Idempotent`,
 * qui ne garde que les mutations. Seule tolérance : une route qui ne déclare
 * QUE `WEBSOCKET` sert un `GET` (forme historique du pont, lecture d'état).
 *
 * @param methods - les méthodes déclarées par la route, en MAJUSCULES ;
 *   `undefined` si elle n'en déclare aucune (tous les verbes HTTP, jamais la socket).
 * @param verb - le verbe logique demandé (`GET`, `POST`, `PUT`, `PATCH`, `DELETE`).
 * @returns `true` si le pont peut servir ce verbe par cette route.
 */
export function bridgeServesVerb(
  methods: ReadonlySet<string> | undefined,
  verb: string,
): boolean {
  if (methods === undefined || !methods.has("WEBSOCKET")) return false;
  if (methods.has(verb)) return true;
  return verb === "GET" && methods.size === 1;
}
