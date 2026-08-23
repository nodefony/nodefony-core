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
   * Une perte est-elle EN SOUFFRANCE, c'est-à-dire constatée et pas encore
   * réparée ?
   *
   * Sans ce drapeau, l'idempotence de {@link Orm.connectionRestored} reposait
   * sur le seul `alive` — et `alive` vaut encore `false` PENDANT
   * l'établissement, puisqu'il n'est posé qu'au retour de `onConnect()`. Or un
   * adapter câble ses écoutes AVANT son premier échange (il le doit : ce
   * premier échange peut échouer), si bien que le client initial émettait un
   * signal de « retour » que rien n'arrêtait : **chaque boot comptait une
   * reconnexion et annonçait `onOrmRestored` avant même `onOrmReady`**
   * (mesuré : `reconnectCount = 1` sur un connecteur qui vient de naître).
   * Une reprise n'a de sens que s'il y a eu une perte : c'est ce que ce
   * drapeau exprime, et il rend la garde vraie à tout instant du cycle de vie.
   */
  #lostPending = false;

  /**
   * **Ce que cet adapter sait VRAIMENT de l'état de sa connexion** — déclaré,
   * jamais supposé.
   *
   * `"events"` : le driver signale les pertes et les reprises, l'adapter les
   * traduit ; `isConnected()` est un CONSTAT.
   * `"assumed"` : rien ne signale quoi que ce soit (base embarquée, driver
   * muet) ; `isConnected()` dit seulement « la connexion a été établie et
   * n'a pas été fermée » — une supposition.
   *
   * **Le défaut est `"assumed"`, et il n'est pas abstrait — délibérément.**
   * Le rendre obligatoire forcerait chaque adapter à répondre, mais casserait
   * la compilation de tout adapter existant : ajouter un ORM deviendrait une
   * rupture. Le défaut prudent protège aussi bien de l'oubli, parce qu'il dit
   * la VÉRITÉ sur un adapter qui n'a rien câblé — il ne sait pas. Ce qu'il
   * faut empêcher, ce n'est pas le silence : c'est qu'un silence se fasse
   * passer pour un constat.
   */
  get liveness(): "events" | "assumed" {
    return "assumed";
  }

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
    // Rappeler `connect()` sur un ORM déjà connecté est PERMIS : le dépôt
    // s'en sert pour rejouer un DDL de développement sur une base existante,
    // et l'interdire casserait un usage documenté — le contrat n'a pas à
    // légiférer sur ce que chaque adapter sait faire. Ce qui doit être vrai,
    // en revanche, c'est qu'un second établissement ne laisse derrière lui
    // ni pool ouvert ni écoute orpheline : c'est à `onConnect()` de reprendre
    // ses propres ressources, et le contrat de test l'exige de chacun.
    this.#lostPending = false;
    const t0 = performance.now();
    try {
      await this.onConnect();
      this.alive = true;
      connectionMonitor.recordConnect(this.name, performance.now() - t0);
      this.startHeartbeat();
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
    this.#lostPending = true;
    connectionMonitor.recordLost(this.name);
    this.log(`connexion perdue : ${reason}`, "WARNING");
    this.fire("onOrmLost", this, reason);
  }

  /**
   * **Le driver a RÉTABLI la connexion** — à appeler par l'adapter depuis
   * l'événement natif correspondant (`pool.on("connect")`, `reconnected`…).
   *
   * **Une reprise n'existe que s'il y a eu une perte.** `pg` émet `connect` et
   * `acquire` à chaque client pris au pool, y compris quand rien n'est tombé,
   * et y compris pendant l'établissement initial : sans cette condition, un
   * pool qui grandit sous la charge — ou simplement une application qui
   * démarre — compterait des reconnexions imaginaires.
   */
  protected connectionRestored(): void {
    if (this.alive || !this.#lostPending) {
      return;
    }
    this.alive = true;
    this.#lostPending = false;
    connectionMonitor.recordReconnect(this.name);
    this.log("connexion rétablie", "INFO");
    this.fire("onOrmRestored", this);
  }

  /**
   * Période du battement de cœur, en millisecondes. `0` le désactive.
   *
   * **Pourquoi le framework doit fournir ça** : le driver MongoDB surveille ses
   * serveurs en permanence (SDAM) et sait donc qu'une base est tombée même sans
   * le moindre trafic. `pg` et `mysql2` n'ont RIEN de tel — ils n'apprennent
   * l'état du serveur que par leurs requêtes. Mesuré : sur ces deux dialectes,
   * une coupure survenue pendant qu'une requête était en vol, ou un serveur
   * simplement GELÉ (qui ne ferme rien), n'émettent aucun événement : l'état
   * restait « connecté » indéfiniment. Un battement comble cette asymétrie —
   * il ne réinvente rien, il donne aux drivers muets ce que Mongo a déjà.
   *
   * Pourquoi pas une instrumentation des requêtes : son coût croît avec le
   * trafic, pour une information qui ne change qu'aux rares instants de panne ;
   * et il faudrait distinguer une erreur de connexion d'une contrainte violée.
   * Ici le coût est CONSTANT et connu d'avance : une requête légère par période.
   */
  protected heartbeatMs = 30_000;

  /**
   * Délai au-delà duquel un battement sans réponse vaut une PERTE.
   *
   * Sans lui, le battement ne sert à rien contre le cas qui l'a justifié :
   * une base GELÉE ne ferme rien et ne répond pas, donc `ping()` PEND — et
   * le battement pendait avec elle, indéfiniment, sans jamais conclure
   * (mesuré : 30 s de gel, aucune détection). Une sonde doit avoir sa
   * propre montre, sinon elle hérite de la panne qu'elle est censée voir.
   */
  protected heartbeatTimeoutMs = 5_000;

  /** Minuterie du battement — `null` tant qu'il ne bat pas (aucun coût). */
  #heartbeat: ReturnType<typeof setInterval> | null = null;

  /** Un battement est-il en vol ? Évite qu'un ping lent en déclenche un autre. */
  #beating = false;

  /**
   * Démarre le battement si l'adapter sait répondre à un `ping()` et que la
   * période n'est pas nulle. Idempotent.
   *
   * La minuterie est `unref()` : elle ne doit JAMAIS retenir le process en vie
   * — un banc, un script CLI ou un test qui se termine ne doit pas attendre le
   * prochain battement pour rendre la main.
   */
  protected startHeartbeat(): void {
    if (this.#heartbeat !== null || this.heartbeatMs <= 0) {
      return;
    }
    if (typeof (this as IOrm).ping !== "function") {
      return;
    }
    const timer = setInterval(() => {
      void this.#beat();
    }, this.heartbeatMs);
    timer.unref?.();
    this.#heartbeat = timer;
  }

  /** Arrête le battement et libère la minuterie. Idempotent. */
  protected stopHeartbeat(): void {
    if (this.#heartbeat !== null) {
      clearInterval(this.#heartbeat);
      this.#heartbeat = null;
    }
    this.#beating = false;
  }

  /**
   * Un battement : sonde la base et met l'état à jour.
   *
   * Ne fait RIEN si un battement précédent n'a pas rendu la main — sur une base
   * gelée, le ping peut pendre longtemps, et empiler les sondes ne ferait
   * qu'empiler des connexions sur un serveur déjà en difficulté.
   */
  async #beat(): Promise<void> {
    // Déconnecté sans perte en souffrance = arrêt VOLONTAIRE : on cesse de
    // battre. Le faire ici plutôt que d'exiger un appel dans le
    // `disconnect()` de chaque adapter est délibéré — un adapter tiers qui
    // l'oublierait continuerait de sonder un pool fermé. Après une PERTE, en
    // revanche, le battement doit continuer : c'est lui qui verra le retour.
    if (!this.alive && !this.#lostPending) {
      this.stopHeartbeat();
      return;
    }
    if (this.#beating) {
      return;
    }
    this.#beating = true;
    let montre: ReturnType<typeof setTimeout> | null = null;
    try {
      await Promise.race([
        (this as IOrm).ping?.() ?? Promise.resolve(),
        new Promise<never>((_, rejeter) => {
          montre = setTimeout(() => {
            rejeter(
              new Error(`aucune réponse en ${this.heartbeatTimeoutMs} ms`),
            );
          }, this.heartbeatTimeoutMs);
          montre.unref?.();
        }),
      ]);
      this.connectionRestored();
    } catch (e) {
      this.connectionLost(
        `battement : ${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      if (montre !== null) {
        clearTimeout(montre);
      }
      this.#beating = false;
    }
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
