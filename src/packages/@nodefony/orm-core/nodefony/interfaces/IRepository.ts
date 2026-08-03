import type { ITransaction } from "./ITransaction";

/**
 * Critère de filtre brut passé aux opérations d'un repository.
 *
 * Volontairement abstrait (`Record<string, unknown>`) : chaque adapter ORM
 * traduit ce critère dans sa syntaxe native (clause `WHERE` SQL, query Mongo,
 * conditions Drizzle...). Le socle reste portable cross-ORM.
 */
export type OrmCriteria = Record<string, unknown>;

/**
 * Opérateurs de comparaison riches applicables à **un** champ, façon MongoDB.
 *
 * Forme tranchée en P7.4 (ADR-0003 risque #3) : objet d'opérateurs `$`-préfixés.
 * Raison : (1) familier (convention Mongo) ; (2) mappable par les **trois**
 * drivers — Mongoose en (quasi) identité (`$gt`/`$in` natifs, `$like`→`$regex`),
 * Drizzle via `gt()`/`inArray()`/`like()` (selon l'adapter). Le sous-ensemble
 * est volontairement minimal = intersection portable des 3 ORM.
 *
 * Plusieurs opérateurs sur le même champ se combinent en `AND`
 * (ex. `{ age: { $gte: 18, $lt: 65 } }`).
 *
 * @typeParam V - type de la valeur du champ ciblé.
 */
export interface FieldOperators<V> {
  /** Égalité stricte (équivalent à passer la valeur nue). */
  $eq?: V;
  /** Différent de. */
  $ne?: V;
  /** Strictement supérieur à. */
  $gt?: V;
  /** Supérieur ou égal à. */
  $gte?: V;
  /** Strictement inférieur à. */
  $lt?: V;
  /** Inférieur ou égal à. */
  $lte?: V;
  /** Appartient à l'ensemble. */
  $in?: readonly V[];
  /** N'appartient pas à l'ensemble. */
  $nin?: readonly V[];
  /** Motif SQL `LIKE` (`%`/`_`) — pertinent pour les champs texte uniquement. */
  $like?: string;
  /**
   * Teste l'**absence de valeur** : `true` → `IS NULL`, `false` → `IS NOT NULL`
   * (Mongo : `$eq`/`$ne null`, qui couvre aussi le champ absent).
   *
   * Indispensable parce qu'une comparaison d'égalité à `NULL` est **fausse** en
   * SQL (`col = NULL` ne matche rien, jamais) : sans cet opérateur, filtrer « la
   * colonne est vide » n'est pas exprimable. Forme équivalente à la valeur nue
   * `{ champ: null }` (cf {@link Criteria}), à préférer quand le `null` vient
   * d'une variable et qu'on veut dire explicitement « IS NULL ».
   *
   * **Exclusif avec `$eq`/`$ne` sur le même champ** : les deux expriment la même
   * comparaison à `null` et l'adapter Mongo les traduit vers la même clé — il
   * lève plutôt que d'en écraser une en silence.
   *
   * @example
   * // les jetons pas encore révoqués
   * repo.find({ revokedAt: { $null: true } });
   * // les PAT qui ont une expiration
   * repo.find({ expiresAt: { $null: false } });
   */
  $null?: boolean;
}

/**
 * Opérateurs d'**écriture** applicables à un champ dans le `update` d'un
 * {@link IRepository.upsert} — par opposition aux {@link FieldOperators}, qui
 * filtrent en lecture.
 *
 * Ils existent parce qu'un upsert **ne peut pas porter de condition** : son
 * `DO UPDATE` s'applique dès qu'il y a conflit de clé. Pour une valeur dont la
 * progression est **monotone** (un seuil qui ne doit jamais reculer), la
 * condition doit donc vivre dans la valeur écrite elle-même. Le résultat tient
 * en **une seule instruction atomique** sur les quatre backends (`MAX()` sqlite,
 * `GREATEST()` postgres/mysql, `$max` natif Mongo) — là où une clause `WHERE`
 * sur le `DO UPDATE` n'existe pas en MySQL et imposerait plusieurs requêtes,
 * donc une course entre elles.
 *
 * À l'INSERT, la valeur est posée telle quelle (rien à comparer).
 *
 * Inutiles pour faire progresser une ligne dont on sait qu'elle **existe** :
 * `updateMany({ k, seuil: { $lt: v } }, { seuil: v })` l'exprime déjà, et de
 * façon tout aussi atomique.
 *
 * @typeParam V - type de la valeur du champ ciblé.
 *
 * @example
 * // le seuil de révocation ne recule jamais, même sur deux logouts simultanés
 * repo.upsert({ subjectId }, { invalidBefore: { $max: now } });
 */
export interface UpdateOperators<V> {
  /** Écrit la valeur seulement si elle est **supérieure** à celle en base. */
  $max?: V;
  /** Écrit la valeur seulement si elle est **inférieure** à celle en base. */
  $min?: V;
}

/**
 * Données d'écriture d'un {@link IRepository.upsert} : chaque champ accepte soit
 * sa valeur nue (écriture directe), soit un objet d'{@link UpdateOperators}.
 *
 * @typeParam T - type de l'entité gérée.
 */
export type UpdateData<T> = {
  [K in keyof T]?: T[K] | UpdateOperators<NonNullable<T[K]>>;
};

/**
 * Valeur de critère pour un champ : soit l'**égalité** directe (valeur nue),
 * soit un objet d'{@link FieldOperators} riche.
 *
 * La valeur nue **`null`** signifie `IS NULL` — et non l'égalité `col = NULL`,
 * qui en SQL est toujours fausse et ferait disparaître le filtre en silence
 * (donc `{ revokedAt: null }` ≡ `{ revokedAt: { $null: true } }`). Contrat
 * identique sur tous les adapters.
 *
 * Cette forme n'est ouverte que si le champ est **typé nullable** (`V` contient
 * `null`) : sur un champ non-nullable, chercher `IS NULL` est une erreur de
 * raisonnement, et le typage la refuse. {@link FieldOperators.$null} reste
 * disponible sur tout champ — y compris optionnel (`champ?: T`), où il exprime
 * « pas de valeur » (Mongo : champ absent).
 *
 * @typeParam V - type de la valeur du champ.
 */
export type FieldCriteria<V> = V | FieldOperators<NonNullable<V>>;

/**
 * Critère **typé par champ** d'une entité `T`.
 *
 * Chaque champ connu accepte soit son égalité (`{ email }` doit être un `string`
 * si `T.email` l'est), soit un objet d'opérateurs riches typé sur la valeur du
 * champ (`{ age: { $gt: 18 } }`). L'intersection avec {@link OrmCriteria}
 * conserve une échappatoire pour les clés non typées (champ calculé, opérateur
 * natif non couvert). Chaque adapter traduit ce critère dans sa syntaxe native.
 *
 * @typeParam T - type de l'entité gérée.
 */
export type Criteria<T> = {
  [K in keyof T]?: FieldCriteria<T[K]>;
} & {
  /**
   * **Disjonction** : au moins une des branches doit être vraie. Les champs
   * posés à côté restent en `ET` avec l'ensemble (`{a: 1, $or: [x, y]}` =
   * `a = 1 AND (x OR y)`).
   *
   * Existe parce que certaines questions du domaine ne sont PAS des
   * conjonctions : « un jeton utilisable » = *sans échéance* **ou** *échéance à
   * venir*. Sans elle, la seule issue était de descendre au SQL/Mongo natif dans
   * chaque store — donc d'écrire la même règle autant de fois qu'il y a de
   * backends, avec la divergence pour seule perspective.
   *
   * Volontairement limitée à `$or` : `$and` est déjà le comportement par défaut
   * d'un critère, et `$not` demanderait de définir la négation d'un `NULL` sur
   * trois dialectes — un piège pour zéro usage démontré.
   *
   * @example
   * // les clés encore utilisables
   * repo.count({ revokedAt: null, $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }] });
   */
  $or?: ReadonlyArray<Criteria<T>>;
} & OrmCriteria;

/**
 * Options de lecture (`find`/`findOne`) portables cross-ORM.
 *
 * `relations` charge des associations **déclarées** dans `@entity` (eager-load :
 * `populate` Mongoose / `with` Drizzle) sans descendre au
 * natif pour le cas commun. Les jointures arbitraires restent du ressort de
 * `IOrm.getNativeConnection()`.
 */
export interface RepositoryReadOptions {
  /** Noms logiques des relations déclarées à charger (eager-load). */
  relations?: string[];

  /** Nombre maximum de lignes. */
  limit?: number;

  /** Décalage (pagination). */
  offset?: number;

  /** Tri : couples `[champ, sens]`. */
  order?: Array<[string, "ASC" | "DESC"]>;
}

/**
 * Contrat CRUD minimal exposé par un repository, indépendant de l'ORM sous-jacent.
 *
 * Un repository est obtenu via `IOrm.getRepository(name)` et manipule des entités
 * de type `T`. Les sémantiques fines (cascade, hooks) sont déléguées à
 * l'adapter concret ; ce contrat garantit uniquement le socle portable.
 *
 * @typeParam T - type de l'entité gérée par le repository.
 */
export interface IRepository<T = unknown> {
  /**
   * Retourne toutes les entités correspondant au critère (toutes si omis).
   *
   * @param criteria - filtre optionnel (partiellement typé).
   * @param options - eager-load / pagination / tri portables.
   * @returns la liste des entités trouvées (vide si aucune).
   */
  find(criteria?: Criteria<T>, options?: RepositoryReadOptions): Promise<T[]>;

  /**
   * Retourne la première entité correspondant au critère, ou `null`.
   *
   * @param criteria - filtre de sélection (partiellement typé).
   * @param options - eager-load portable (`relations`).
   */
  findOne(
    criteria: Criteria<T>,
    options?: RepositoryReadOptions,
  ): Promise<T | null>;

  /**
   * Persiste une nouvelle entité et retourne sa version persistée (id généré, valeurs par défaut).
   *
   * @param data - champs de l'entité à créer.
   */
  create(data: Partial<T>): Promise<T>;

  /**
   * Insère **plusieurs** entités en **une seule** requête (`INSERT … VALUES
   * (…),(…)` SQL / `insertMany` Mongo) et retourne leurs versions persistées
   * (ids générés, défauts appliqués), dans l'ordre. Un tableau vide est un
   * **no-op** (`[]`, aucune requête). Préférer à N appels `create` (N round-trips)
   * pour le seed / l'import / l'ingestion par lots.
   *
   * @param data - entités à créer.
   * @returns les entités persistées, dans le même ordre.
   */
  createMany(data: Partial<T>[]): Promise<T[]>;

  /**
   * Met à jour **au plus une** entité correspondant au critère, de façon
   * **atomique**, et retourne sa version persistée (ou `null` si aucune ne
   * correspond).
   *
   * Atomicité : une **seule** requête (`UPDATE … RETURNING` SQL /
   * `findOneAndUpdate` Mongo), jamais un `UPDATE` suivi d'une relecture séparée
   * — cette dernière renverrait `null` à tort dès que le critère porte sur un
   * champ modifié (ex. `updateOne({ status: "pending" }, { status: "done" })`).
   *
   * @param criteria - filtre de sélection. Un champ inconnu de l'entité lève
   *   `UnknownCriteriaField` (mêmes règles que `find`).
   * @param data - champs à modifier.
   * @returns l'entité mise à jour, ou `null` si le critère ne matche rien.
   */
  updateOne(criteria: Criteria<T>, data: Partial<T>): Promise<T | null>;

  /**
   * Insère **ou** met à jour atomiquement l'entité identifiée par `criteria`
   * (clé unique), en **une seule** requête (`INSERT … ON CONFLICT DO UPDATE …
   * RETURNING` SQL / `findOneAndUpdate({ upsert })` Mongo) — jamais un `SELECT`
   * d'existence suivi d'un `INSERT`/`UPDATE` séparé (2 round-trips + une race
   * insert/update entre les deux).
   *
   * - **INSERT** (clé absente) : la ligne créée = `{ ...criteria, ...insertOnly,
   *   ...update }`.
   * - **UPDATE** (conflit de clé) : seul `update` est ré-appliqué (`SET`) ;
   *   `criteria` et `insertOnly` ne touchent PAS la ligne existante (ex.
   *   `createdAt` posé à la création est préservé).
   *
   * Le `DO UPDATE` est **inconditionnel** (aucun `WHERE` : MySQL n'en accepte
   * pas sur son `ON DUPLICATE KEY UPDATE`) — pour une valeur qui ne doit jamais
   * régresser, poser la condition DANS la valeur via {@link UpdateOperators}
   * (`{ seuil: { $max: v } }`), ce qui reste une instruction unique.
   *
   * @param criteria - clé de conflit (colonnes **uniques**, égalité simple — pas
   *   d'opérateurs riches `$`). Sert aussi de valeurs d'insertion.
   * @param update - champs posés à l'insertion ET ré-appliqués en cas de conflit.
   *   Accepte une valeur nue ou un {@link UpdateOperators} (`$max`/`$min`).
   * @param insertOnly - champs posés **uniquement** à l'insertion (ex. `createdAt`).
   * @returns l'entité persistée (ligne réelle via `RETURNING` / `returnDocument`).
   */
  upsert(
    criteria: Criteria<T>,
    update: UpdateData<T>,
    insertOnly?: Partial<T>,
  ): Promise<T>;

  /**
   * Met à jour **toutes** les entités correspondant au critère et retourne le
   * **nombre** de lignes modifiées (parité de signature avec
   * {@link IRepository.delete}).
   *
   * @param criteria - filtre de sélection. Un champ inconnu lève
   *   `UnknownCriteriaField`.
   * @param data - champs à modifier.
   * @returns le nombre d'entités mises à jour.
   */
  updateMany(criteria: Criteria<T>, data: Partial<T>): Promise<number>;

  /**
   * Incrémente **atomiquement** des champs numériques d'**au plus une** entité
   * (`SET f = f + ?` SQL / `$inc` Mongo), sans read-modify-write (donc sans race)
   * — pour les compteurs (stats, usage/tokens, rate-limit). Un delta négatif
   * décrémente. Retourne l'entité après modification, ou `null` si le critère ne
   * matche rien.
   *
   * @param criteria - filtre de sélection (au plus une entité affectée).
   * @param changes - deltas par champ (`{ hits: 1, credits: -5 }`).
   * @returns l'entité mise à jour, ou `null`.
   */
  increment(
    criteria: Criteria<T>,
    changes: Partial<Record<keyof T, number>>,
  ): Promise<T | null>;

  /**
   * Supprime les entités correspondant au critère.
   *
   * @param criteria - filtre de sélection.
   * @returns nombre d'entités supprimées.
   */
  delete(criteria: Criteria<T>): Promise<number>;

  /**
   * Supprime **au plus une** entité de façon **atomique** (symétrique
   * d'{@link IRepository.updateOne} ; `DELETE … LIMIT 1` SQL / `deleteOne` Mongo).
   *
   * @param criteria - filtre de sélection.
   * @returns `true` si une entité a été supprimée, `false` sinon.
   */
  deleteOne(criteria: Criteria<T>): Promise<boolean>;

  /**
   * Supprime **au plus une** entité et **retourne** sa valeur supprimée (ou
   * `null`), de façon atomique (`DELETE … RETURNING` SQL / `findOneAndDelete`
   * Mongo) — claim-and-remove (file de jobs, outbox, pop atomique).
   *
   * @param criteria - filtre de sélection.
   * @returns l'entité supprimée, ou `null` si aucune ne correspond.
   */
  findOneAndDelete(criteria: Criteria<T>): Promise<T | null>;

  /**
   * Compte les entités correspondant au critère (toutes si omis).
   *
   * @param criteria - filtre optionnel.
   */
  count(criteria?: Criteria<T>): Promise<number>;

  /**
   * Compte les **valeurs distinctes** d'un champ parmi les entités qui
   * correspondent au critère (`COUNT(DISTINCT col)` SQL / agrégation Mongo).
   *
   * Répond à une question que `count` ne sait pas poser : « combien de personnes
   * distinctes derrière ces sessions ? », « combien de comptes touchés par ces
   * échecs ? ». La compter côté appelant supposerait de rapatrier la colonne
   * entière pour la dédupliquer en mémoire — soit exactement l'énumération que
   * ces compteurs existent pour éviter.
   *
   * Les valeurs nulles ne sont pas comptées, comme en SQL : l'absence de valeur
   * n'est pas une valeur distincte de plus.
   *
   * @param field - champ dont on compte les valeurs distinctes.
   * @param criteria - filtre optionnel, appliqué avant la déduplication.
   * @returns le nombre de valeurs distinctes et non nulles.
   */
  countDistinct(
    field: keyof T & string,
    criteria?: Criteria<T>,
  ): Promise<number>;

  /**
   * Indique si **au moins une** entité correspond au critère, sans rapatrier la
   * ligne (`SELECT 1 … LIMIT 1` SQL / `exists` Mongo). Préférer à
   * `findOne(...) !== null` (aucune colonne chargée) et à `count(...) > 0` (pas de
   * comptage complet) pour un simple test d'existence.
   *
   * @param criteria - filtre de sélection.
   * @returns `true` si une entité correspond, `false` sinon.
   */
  exists(criteria: Criteria<T>): Promise<boolean>;

  /**
   * Retourne une **vue de ce repository liée à une transaction** : toutes ses
   * opérations s'exécutent dans `tx` (commit/rollback gérés par
   * `IOrm.transaction()`). Résout la fuite « repository non tx-aware » (ADR-0003
   * risque #4) sans état global ni CLS.
   *
   * @param tx - transaction active (issue du callback de `IOrm.transaction`).
   * @returns un repository équivalent dont les écritures/lectures portent sur `tx`.
   */
  withTransaction(tx: ITransaction): IRepository<T>;
}
