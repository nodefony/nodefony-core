import { Service } from "nodefony";
import type { Container, Event, DefaultOptionsService } from "nodefony";
import type {
  IColumnInfo,
  IOrm,
  IRepository,
  ITransaction,
} from "../interfaces/index";
import { ormRegistry } from "./OrmRegistry";

/**
 * Classe de base abstraite de tout ORM Nodefony — câble {@link Service} (DI,
 * Syslog, bus d'événements) et le contrat {@link IOrm}, et s'auto-enregistre
 * dans le {@link ormRegistry} process-wide à la construction.
 *
 * Les drivers concrets (`@nodefony/sequelize`, `@nodefony/mongoose`...)
 * implémentent les opérations bas niveau ({@link Orm.onConnect}, `disconnect`,
 * `getRepository`, `transaction`, `getNativeConnection`). La connexion passe par
 * la template method {@link Orm.connect} qui émet l'événement `onOrmReady` une
 * fois le driver connecté — garantissant que tous les ORM signalent leur
 * disponibilité de façon homogène (avant le `onReady` du Kernel).
 *
 * @typeParam — aucun ; les types natifs du driver transitent via les génériques
 *   des méthodes ({@link IRepository}, {@link ITransaction}, native connection).
 */
export abstract class Orm extends Service implements IOrm {
  /**
   * @param name - clé unique de l'ORM dans le {@link ormRegistry}.
   * @param container - container DI hérité (Kernel) ou nouveau si omis.
   * @param notificationsCenter - bus d'événements partagé, `false` pour aucun.
   * @param options - options de service.
   * @throws si un ORM du même `name` est déjà enregistré.
   */
  constructor(
    name: string,
    container?: Container,
    notificationsCenter?: Event | false | null,
    options?: DefaultOptionsService,
  ) {
    super(name, container, notificationsCenter, options);
    ormRegistry.register(this.name, this);
  }

  /**
   * Connecte le driver puis émet `onOrmReady`.
   *
   * Template method : ne pas surcharger — implémenter {@link Orm.onConnect}.
   */
  async connect(): Promise<void> {
    await this.onConnect();
    this.fire("onOrmReady", this);
  }

  /**
   * Établit la connexion native du driver (compilation des entités, pool...).
   *
   * Appelé par {@link Orm.connect} ; ne pas émettre `onOrmReady` ici.
   */
  protected abstract onConnect(): Promise<void>;

  /** Ferme la connexion et libère le pool. */
  abstract disconnect(): Promise<void>;

  /** Indique si la connexion est active. */
  abstract isConnected(): boolean;

  /**
   * Repository typé d'une entité enregistrée.
   *
   * @param name - nom logique de l'entité.
   */
  abstract getRepository<T = unknown>(name: string): IRepository<T>;

  /**
   * Exécute un travail transactionnel (commit si résolu, rollback si rejeté).
   *
   * @param work - callback recevant la transaction active.
   */
  abstract transaction<R>(work: (tx: ITransaction) => Promise<R>): Promise<R>;

  /** Expose la connexion native du driver (trappe SQL/commandes brutes). */
  abstract getNativeConnection<C = unknown>(): C;

  /**
   * Décrit les colonnes d'une entité pour le graphe canonique. Défaut : `[]`
   * (relations seules dans l'ERD). Les adapters surchargent avec l'introspection
   * native (Drizzle `getTableConfig`, Sequelize `getAttributes`, Mongoose paths).
   *
   * @param _name - nom logique de l'entité.
   * @returns colonnes normalisées.
   */
  describeEntity(_name: string): IColumnInfo[] {
    return [];
  }
}
