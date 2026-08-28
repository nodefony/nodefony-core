/**
 * Erreurs typées du socle ORM — **data-level uniquement** (aucun couplage à une
 * couche API/transport : ces erreurs décrivent des fautes sur les données, pas
 * sur une requête HTTP/GraphQL). Une surface API qui les rencontre décide
 * elle-même comment les projeter (400, erreur GraphQL…), l'ORM n'en sait rien.
 */

/**
 * Levée quand un critère de repository référence un **champ inconnu** de l'entité
 * ciblée.
 *
 * Garde-fou « ultra solide » + **portabilité** : sans elle, un champ inconnu est
 * traité différemment selon l'adapter — Drizzle l'**ignore** (la condition
 * disparaît → la requête peut renvoyer **toute** la table), Mongoose le **garde**
 * (→ **0 résultat**). Le même critère mal typé donnerait donc des résultats
 * opposés selon l'ORM (rupture de la promesse « swap d'ORM ») et une faute de
 * frappe (`emial`) passerait silencieusement. On échoue **tôt et pareil** sur les
 * deux drivers.
 *
 * Les requêtes natives/calculées (opérateurs logiques `$or`, sous-requêtes…) ne
 * relèvent **pas** du critère portable : passer par `IOrm.getNativeConnection()`.
 */
export class UnknownCriteriaField extends Error {
  /** Champ fautif (clé du critère non résolue sur l'entité). */
  readonly field: string;
  /** Nom logique de l'entité ciblée. */
  readonly entity: string;
  /** Champs connus de l'entité (aide au diagnostic / faute de frappe). */
  readonly known: readonly string[];

  /**
   * @param field - champ inconnu rencontré dans le critère.
   * @param entity - entité ciblée (nom logique).
   * @param known - champs connus de l'entité.
   */
  constructor(field: string, entity: string, known: readonly string[]) {
    super(
      `Unknown criteria field "${field}" on entity "${entity}". ` +
        `Known fields: ${known.join(", ")}. ` +
        `For native/computed queries (logical $or, sub-queries…), use getNativeConnection().`,
    );
    this.name = "UnknownCriteriaField";
    this.field = field;
    this.entity = entity;
    this.known = known;
  }
}

/**
 * Levée quand l'option de lecture `order` n'est pas un tableau de couples
 * `[champ, "ASC" | "DESC"]`.
 *
 * Symétrique de {@link UnknownCriteriaField}, sous la même règle « jamais un skip
 * silencieux » : avant cette garde, une forme voisine mais fausse — `{ age: "asc" }`
 * au lieu de `[["age", "ASC"]]` — faisait partir la requête **sans `ORDER BY`**, et
 * l'appelant recevait des lignes non triées qu'il croyait triées. Le sens est vérifié
 * en casse exacte : un `"desc"` minuscule aurait produit un tri **ASC**, soit
 * l'inverse de l'intention.
 *
 * TypeScript attrape déjà le cas au typage ; la surface réelle est l'appel non typé
 * ou construit dynamiquement — exactement là où un tri faux ne se voit pas. La
 * normalisation d'une entrée utilisateur (casse, `champ:sens`) appartient à la
 * frontière qui la reçoit (`parsePageQuery`), jamais au repository.
 */
export class InvalidOrderOption extends Error {
  /** Nom logique de l'entité ciblée. */
  readonly entity: string;
  /** Ce qui a été reçu, décrit par sa FORME (jamais la valeur : pas de fuite de données). */
  readonly received: string;

  /**
   * @param entity - entité ciblée (nom logique).
   * @param received - description de la forme reçue (ex. `an object`, `pair #0 is not an array`).
   */
  constructor(entity: string, received: string) {
    super(
      `Invalid "order" option on entity "${entity}": expected an array of ` +
        `[field, "ASC" | "DESC"] pairs, received ${received}. ` +
        `Example: { order: [["createdAt", "DESC"]] }.`,
    );
    this.name = "InvalidOrderOption";
    this.entity = entity;
    this.received = received;
  }
}
