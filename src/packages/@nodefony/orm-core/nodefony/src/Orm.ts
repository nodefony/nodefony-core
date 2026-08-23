import { Service } from "nodefony";
import type { Container, Event, DefaultOptionsService } from "nodefony";
import type {
  IColumnInfo,
  IConnectionInfo,
  IOrm,
  IRepository,
  ITransaction,
} from "../interfaces/index";
import { performance } from "node:perf_hooks";
import { ormRegistry } from "./OrmRegistry";
import { connectionMonitor } from "./ConnectionMonitor";

/**
 * Classe de base abstraite de tout ORM Nodefony — câble {@link Service} (DI,
 * Syslog, bus d'événements) et le contrat {@link IOrm}, et s'auto-enregistre
 * dans le {@link ormRegistry} process-wide à la construction.
 *
 * Les drivers concrets (`@nodefony/mongoose`, `@nodefony/drizzle`...)
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
   * État de vie de la connexion — source UNIQUE de `isConnected()`.
   *
   * `protected` et non `#privé` : `disconnect()` est implémenté par chaque
   * adapter et doit pouvoir le remettre à `false`.
   */
  protected alive = false;

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
   * Instrumente le {@link connectionMonitor} (latence + reconnexion en cas de
   * succès, erreur de connexion en cas d'échec).
   */
  async connect(): Promise<void> {
    const t0 = performance.now();
    try {
      await this.onConnect();
      this.alive = true;
      connectionMonitor.recordConnect(this.name, performance.now() - t0);
    } catch (e) {
      this.alive = false;
      connectionMonitor.recordError(
        this.name,
        e instanceof Error ? e.message : String(e),
      );
      throw e;
    }
    this.fire("onOrmReady", this);
  }

  /**
   * **Le driver a PERDU la connexion** — à appeler par l'adapter depuis
   * l'événement natif de son driver (`pool.on("error")` côté `pg`,
   * `connection.on("disconnected")` côté Mongoose…).
   *
   * Idempotent : un driver émet souvent plusieurs erreurs pour une seule
   * coupure (une par connexion du pool). Seule la PREMIÈRE bascule l'état,
   * compte l'incident et émet `onOrmLost` — sinon un pool de 10 connexions
   * ferait dix fois le tour du framework pour un seul serveur tombé.
   *
   * @param reason - cause lisible, sans credential (elle est journalisée).
   */
  protected connectionLost(reason: string): void {
    connectionMonitor.recordError(this.name, reason);
    if (!this.alive) {
      return;
    }
    this.alive = false;
    connectionMonitor.recordLost(this.name);
    this.log(`connexion perdue : ${reason}`, "WARNING");
    this.fire("onOrmLost", this, reason);
  }

  /**
   * **Le driver a RÉTABLI la connexion** — à appeler par l'adapter depuis
   * l'événement natif correspondant (`pool.on("connect")`, `reconnected`…).
   *
   * Idempotent, et pour la même raison inversée : `pg` émet `connect` à
   * CHAQUE client créé, y compris quand rien n'avait été perdu. Sans ce garde,
   * un pool qui grandit sous la charge compterait des reconnexions imaginaires.
   */
  protected connectionRestored(): void {
    if (this.alive) {
      return;
    }
    this.alive = true;
    connectionMonitor.recordReconnect(this.name);
    this.log("connexion rétablie", "INFO");
    this.fire("onOrmRestored", this);
  }

  /**
   * Indique si la connexion est active — **implémentation UNIQUE**, portée par
   * la classe de base et non par chaque adapter.
   *
   * C'est délibéré : tant que chaque adapter portait son propre booléen posé à
   * la connexion, aucun ne le remettait à `false` quand le serveur tombait —
   * la santé ORM répondait « connecté » en pleine coupure. L'état vit ici, et
   * il n'a que trois sources : `connect()`, `disconnect()`, et les deux
   * signaux que l'adapter traduit depuis son driver.
   */
  isConnected(): boolean {
    return this.alive;
  }

  /**
   * Établit la connexion native du driver (compilation des entités, pool...).
   *
   * Appelé par {@link Orm.connect} ; ne pas émettre `onOrmReady` ici.
   */
  protected abstract onConnect(): Promise<void>;

  /** Ferme la connexion et libère le pool. */
  abstract disconnect(): Promise<void>;

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
   * native (Drizzle `getTableConfig`, Mongoose paths).
   *
   * @param _name - nom logique de l'entité.
   * @returns colonnes normalisées.
   */
  describeEntity(_name: string): IColumnInfo[] {
    return [];
  }

  /**
   * Décrit la connexion sous-jacente (driver + cible). Défaut : driver vide
   * (inconnu). Les adapters surchargent (Drizzle → `sqlite` + fichier, etc.).
   * Ne DOIT jamais exposer de credential.
   *
   * @returns infos de connexion (driver vide si non renseigné).
   */
  describeConnection(): IConnectionInfo {
    return { driver: "" };
  }
}
