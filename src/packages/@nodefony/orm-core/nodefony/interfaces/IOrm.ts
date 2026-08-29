import type { IRepository } from "./IRepository";
import type { ITransaction } from "./ITransaction";
import type { IColumnInfo, IConnectionInfo } from "./IOrmGraph";
import type { IOrmProbe } from "./IOrmProbe";
import type { IOrmMigrationReply } from "./IOrmMigrations";

/**
 * Contrat d'une instance ORM gérée par le framework (une par connexion logique).
 *
 * Implémenté par chaque adapter (`@nodefony/mongoose`, `@nodefony/drizzle`...) et enregistré dans `OrmRegistry` sous un nom unique
 * (ex. `"db_principale"`, `"db_logs"`) pour le support multi-ORM simultané.
 */
export interface IOrm {
  /** Nom unique de l'instance dans le registre (clé `OrmRegistry.get`). */
  readonly name: string;

  /** Établit la connexion sous-jacente et compile les entités enregistrées. */
  connect(): Promise<void>;

  /** Ferme proprement la connexion et libère le pool. */
  disconnect(): Promise<void>;

  /** Indique si la connexion est actuellement active. */
  isConnected(): boolean;

  /**
   * Retourne le repository typé d'une entité enregistrée.
   *
   * @param name - nom logique de l'entité (ex. `"User"`).
   * @typeParam T - type de l'entité gérée.
   * @returns le repository CRUD de l'entité.
   * @throws si aucune entité de ce nom n'est enregistrée pour cet ORM.
   */
  getRepository<T = unknown>(name: string): IRepository<T>;

  /**
   * Exécute un travail dans une transaction : commit si résolu, rollback si rejeté.
   *
   * @param work - callback recevant la transaction active.
   * @typeParam R - type du résultat retourné par le travail.
   */
  transaction<R>(work: (tx: ITransaction) => Promise<R>): Promise<R>;

  /**
   * Expose la connexion native du driver (trappe SQL/commandes brutes).
   *
   * Anti-blocage indispensable : autorise une requête brute non couverte par
   * l'abstraction (tag `sql` Drizzle, `connection` Mongoose, etc.) — typiquement
   * une projection de colonnes, une CTE ou une agrégation.
   *
   * **Passer le type de l'adapter, jamais rien.** Le paramètre retombe sur
   * `unknown` s'il est omis, et la seule issue devient alors un `as any` : c'est
   * le contraire de ce que cette trappe cherche à offrir. Le type vient de
   * l'adapter employé — `DrizzleDb` exporté par `@nodefony/drizzle`,
   * `Connection` du paquet `mongoose` pour `@nodefony/mongoose` :
   *
   * ```ts
   * import type { DrizzleDb } from "@nodefony/drizzle";
   * const db = orm.getNativeConnection<DrizzleDb>();
   * ```
   *
   * @typeParam C - type natif attendu, exporté par l'adapter employé.
   */
  getNativeConnection<C = unknown>(): C;

  /**
   * Décrit les colonnes normalisées d'une entité pour le graphe canonique
   * (data plane ORM / ERD / contexte IA). **Optionnel** : un adapter qui ne
   * l'implémente pas laisse le graphe sans colonnes (relations seules).
   *
   * @param name - nom logique de l'entité.
   * @returns colonnes normalisées, ou `[]` si inconnu/non implémenté.
   */
  describeEntity?(name: string): IColumnInfo[];

  /**
   * Décrit la connexion sous-jacente (driver + cible lisible) pour le data plane
   * ORM / dashboard. **Optionnel** : un adapter qui ne l'implémente pas laisse le
   * connecteur sans détail de connexion. Ne DOIT jamais exposer de credential
   * (mot de passe retiré de la cible).
   *
   * @returns infos de connexion, ou `undefined` si non implémenté.
   */
  describeConnection?(): IConnectionInfo;

  /**
   * Ping bas-coût de la connexion (round-trip réel vers la base) pour le
   * diagnostic du data plane. **Optionnel** : un adapter qui ne l'implémente pas
   * laisse le diagnostic mesurer une latence `null` (état dérivé d'`isConnected`).
   * SQL → `SELECT 1` ; Mongo → `admin().ping`. Doit **rejeter** si la base ne
   * répond pas (la latence et l'erreur alimentent le moniteur de connexion).
   *
   * @throws si la base est injoignable.
   */
  ping?(): Promise<void>;

  /**
   * Sonde profonde driver-spécifique (stockage, pool…) pour le contrôle total
   * des ORM via le hub temps réel. **Optionnel** : un adapter qui ne l'implémente
   * pas ne rapporte que les métriques génériques (latence, cycle de vie).
   * Best-effort : ne DOIT jamais throw (retourner un objet partiel/vide).
   *
   * @returns métriques driver, ou objet vide si rien à rapporter.
   */
  probe?(): Promise<IOrmProbe>;

  /**
   * État des migrations de ce connecteur — **capacité optionnelle**, et son
   * ABSENCE est une réponse.
   *
   * Un ORM qui ne l'implémente pas ne porte pas de migrations par fichiers
   * versionnés : le plan d'administration le DIT en le nommant, plutôt que de
   * rendre une page vide. Les autres bases résorbent l'écart entre le code et
   * le schéma autrement — la question est la même, la réponse n'est pas la
   * même.
   *
   * ⚠️ **Lecture seule, et sans privilège emprunté** : cette méthode ne doit
   * rien appliquer, et ne doit pas emprunter le compte réservé au travail de
   * migration. Un serveur qui répond à une requête d'administration n'a aucune
   * raison de détenir le droit de modifier un schéma.
   *
   * @returns l'état, ou l'empêchement qui explique pourquoi il n'y en a pas.
   */
  migrationStatus?(): Promise<IOrmMigrationReply>;
}
