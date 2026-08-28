import path from "node:path";
import fs from "node:fs";
import { createRequire } from "node:module";
import mongoose from "mongoose";
import type {
  ConnectOptions,
  Connection,
  Model,
  Schema,
  SchemaDefinition,
  SchemaType,
} from "mongoose";
import { Orm, entityRegistry } from "@nodefony/orm-core";
import type {
  IColumnInfo,
  IConnectionInfo,
  IEntity,
  IOrmProbe,
  IRepository,
  ITransaction,
} from "@nodefony/orm-core";
import { MongooseRepository } from "./MongooseRepository";
import { MongooseTransaction } from "./MongooseTransaction";

/** Modèle Mongoose à document libre (boundary). */
type LooseModel = Model<Record<string, unknown>>;

/**
 * Verdict d'index d'une entité — l'écart entre ce que le schéma DÉCLARE et ce
 * que la base PORTE réellement.
 *
 * C'est le pendant documentaire de l'écart de schéma SQL : MongoDB n'a pas de
 * DDL, mais un index unique qui n'existe pas est exactement une contrainte
 * absente. Le verdict est rendu structuré parce qu'il a deux publics — le
 * journal pour l'exploitant, et l'appelant (banc, sonde d'administration) qui
 * doit pouvoir en décider.
 */
export interface IIndexAudit {
  /** Nom de l'entité (clé du `entityRegistry`). */
  entity: string;
  /** Collection MongoDB sous-jacente. */
  collection: string;
  /** Index déclarés au schéma et ABSENTS de la base — la vraie alerte. */
  missing: string[];
  /** Index présents en base et non déclarés — informatif, jamais supprimé. */
  extra: string[];
  /** Motif d'un échec de construction, quand la base l'a refusée. */
  error?: string;
}

/**
 * Nom canonique d'un index à partir de sa définition (`{ identifier: 1 }` →
 * `identifier_1`) — la convention de nommage de MongoDB lui-même, pour que le
 * journal désigne l'index sous le nom qu'un exploitant lira dans la base.
 */
function indexName(definition: unknown): string {
  if (!definition || typeof definition !== "object") {
    return String(definition);
  }
  return Object.entries(definition as Record<string, unknown>)
    .map(([field, direction]) => `${field}_${String(direction)}`)
    .join("_");
}

/**
 * Adapter Mongoose **branché sur `@nodefony/orm-core`** (P5.4).
 *
 * 2ᵉ adapter, **hétérogène** au SQL : valide que le contrat enrichi
 * (`relations`/`withTransaction`) est réellement portable sur un store
 * documentaire. Distinct du service legacy `nodefony/service/orm.ts`.
 *
 * Spécificités MongoDB exposées par l'implémentation :
 * - **connexion isolée** via `mongoose.createConnection` (pas le singleton global)
 *   → indispensable au multi-ORM (plusieurs connexions logiques) ;
 * - relations sans clé étrangère SQL : `one-to-many` = **virtual populate**
 *   (réf ObjectId injectée sur l'enfant + virtuel sur le parent), `many-to-one`/
 *   `one-to-one` = champ réf sur la source. `many-to-many` → natif ;
 * - transactions = **sessions** (requièrent un replica set).
 */
export class MongooseOrm extends Orm {
  #connection: Connection | null = null;
  /**
   * Listeners de cycle de vie attachés à la connexion Mongoose — gardés pour
   * pouvoir les DÉTACHER : `disconnect()` puis `connect()` sur le même ORM
   * empilerait sinon un jeu de listeners par cycle (règle « pas de listener
   * sans cleanup »). `null` tant qu'aucune connexion n'est ouverte.
   */
  #lifecycle: Array<[string, (...a: never[]) => void]> | null = null;

  /**
   * Mongoose traduit les signaux de topologie du driver MongoDB (SDAM) : il
   * SAIT qu'un serveur est tombé, même sans le moindre trafic — d'où
   * `"events"`. C'est la seule des trois familles d'adapters du dépôt qui
   * dispose d'une surveillance de serveur indépendante des requêtes.
   */
  override get liveness(): "events" | "assumed" {
    return "events";
  }
  #models: Record<string, LooseModel> | null = null;
  #repositories: Record<string, IRepository> | null = null;
  readonly #uri: string;
  readonly #options: ConnectOptions | undefined;

  /**
   * @param name - clé unique de l'ORM dans le `ormRegistry`.
   * @param uri - URI de connexion MongoDB (replica set requis pour les tx).
   * @param options - options de connexion Mongoose (auth, pool, timeouts).
   */
  constructor(name: string, uri: string, options?: ConnectOptions) {
    super(name);
    this.#uri = uri;
    this.#options = options;
  }

  /** Entités enregistrées ciblant cet ORM. */
  #ownEntities(): IEntity[] {
    return entityRegistry
      .list()
      .filter((entity) => entity.connector === this.name);
  }

  /** FK déterministe camelCase `<entité>Id` (réf ObjectId côté enfant). */
  #foreignKey(entityName: string): string {
    return `${entityName.charAt(0).toLowerCase()}${entityName.slice(1)}Id`;
  }

  protected async onConnect(): Promise<void> {
    // Un `connect()` rejoué ne doit pas laisser derrière lui les écoutes de
    // la connexion précédente : elles resteraient ACTIVES et indétachables,
    // et un `disconnected` venu d'une connexion abandonnée ferait basculer
    // un ORM dont la connexion courante est parfaitement saine.
    if (this.#connection) {
      this.#unwireLifecycle();
      await this.#connection.close().catch(() => undefined);
      this.#connection = null;
    }
    const connection = mongoose.createConnection(
      this.#uri,
      this.#delaisSains(),
    );
    await connection.asPromise();
    this.#connection = connection;
    this.#wireLifecycle(connection);
    this.#models = Object.create(null) as Record<string, LooseModel>;

    const entities = this.#ownEntities();

    // 1) Schémas (virtuels activés à la sérialisation pour exposer `id`/populates).
    const schemas = new Map<string, Schema>();
    for (const entity of entities) {
      schemas.set(
        entity.name,
        new mongoose.Schema(entity.schema as SchemaDefinition, {
          toObject: { virtuals: true },
          toJSON: { virtuals: true },
          // Horodatages auto (createdAt/updatedAt) si l'entité les déclare.
          timestamps: entity.timestamps ?? false,
        }),
      );
    }

    // 2) Relations : pas de FK SQL → refs ObjectId + virtual populate.
    for (const entity of entities) {
      if (!entity.relations) {
        continue;
      }
      const sourceSchema = schemas.get(entity.name);
      for (const relation of entity.relations) {
        const targetSchema = schemas.get(relation.target);
        if (!sourceSchema || !targetSchema) {
          throw new Error(
            `MongooseOrm "${this.name}": relation target "${relation.target}" ` +
              `(from "${entity.name}.${relation.field}") not registered for this ORM.`,
          );
        }
        switch (relation.type) {
          case "one-to-many": {
            // Réf sur l'enfant + virtuel populate sur le parent.
            const fk = relation.foreignKey ?? this.#foreignKey(entity.name);
            if (!targetSchema.path(fk)) {
              targetSchema.add({
                [fk]: {
                  type: mongoose.Schema.Types.ObjectId,
                  ref: entity.name,
                },
              });
            }
            sourceSchema.virtual(relation.field, {
              ref: relation.target,
              localField: "_id",
              foreignField: fk,
            });
            break;
          }
          case "many-to-one":
          case "one-to-one": {
            // Champ réf sur la source (populate par le nom du champ).
            const fk = relation.foreignKey ?? relation.field;
            if (!sourceSchema.path(fk)) {
              sourceSchema.add({
                [fk]: {
                  type: mongoose.Schema.Types.ObjectId,
                  ref: relation.target,
                },
              });
            }
            break;
          }
          case "many-to-many":
            throw new Error(
              `MongooseOrm "${this.name}": many-to-many ("${entity.name}.${relation.field}") ` +
                `non portable — déclarer via getNativeConnection().`,
            );
        }
      }
    }

    // 3) Compilation des modèles.
    for (const entity of entities) {
      const model = connection.model(
        entity.name,
        schemas.get(entity.name) as Schema,
      ) as unknown as LooseModel;
      this.#models[entity.name] = model;
      entity.model = model;
    }

    // 4) Constat des index — LANCÉ, pas attendu (cf verifyIndexes).
    const audit = this.verifyIndexes();
    this.#indexAudit = audit;
    // Le démarrage ne l'attend pas : sans ce filet, un rejet inattendu de la
    // passe deviendrait un rejet ORPHELIN, qui tue le process en Node.
    void audit.catch(() => undefined);
  }

  /**
   * Constat d'index en cours — la promesse de la passe lancée au `connect()`.
   *
   * Exposée pour que ce qui doit SAVOIR puisse attendre (un banc, une sonde
   * d'administration, un futur point de disponibilité) sans que le démarrage,
   * lui, ait à le faire.
   */
  #indexAudit: Promise<IIndexAudit[]> | null = null;

  /** Constat d'index de la connexion courante, ou `null` hors connexion. */
  get pendingIndexAudit(): Promise<IIndexAudit[]> | null {
    return this.#indexAudit;
  }

  /**
   * Constate l'écart entre les index DÉCLARÉS par les schémas et ceux que la
   * base porte réellement, et journalise tout manque en `CRITIC`.
   *
   * **Pourquoi c'est nécessaire.** Mongoose construit les index en tâche de
   * fond à la compilation des modèles, et l'issue de cette construction n'était
   * écoutée par personne. Or plusieurs de ces index portent des contraintes
   * d'unicité dont dépend l'authentification. Reproduit sur un serveur réel :
   * une collection portant déjà des doublons fait échouer la construction de
   * l'index unique — et le process continue, code de sortie 0, **sans un seul
   * message**, avec pour seul index `_id_`. La contrainte n'existe pas, et rien
   * ne le dit : c'est la dégradation silencieuse que la doctrine interdit.
   *
   * **Pourquoi APRÈS `init()`.** Un `diffIndexes()` lancé aussitôt après la
   * compilation annonce comme manquants des index dont la construction est
   * simplement en cours — mesuré. `init()` est le point où la construction est
   * terminée, en succès comme en échec ; c'est donc là, et pas avant, que
   * l'écart veut dire quelque chose.
   *
   * **Pourquoi ce n'est pas attendu au démarrage.** Construire un index sur une
   * grosse collection prend des minutes ; faire patienter le pod changerait son
   * comportement bien au-delà de ce défaut. Le constat court donc en tâche de
   * fond et parle dès qu'il sait — {@link MongooseOrm.pendingIndexAudit} permet
   * de l'attendre quand il le faut.
   *
   * **Ce que cette méthode ne fait PAS** : réparer. `syncIndexes()` de mongoose
   * SUPPRIME les index non déclarés — irréversible, et catastrophique sur une
   * base qu'un exploitant a indexée à la main. Réparer reste un geste explicite.
   *
   * @returns un verdict par entité (vide si la connexion est déjà close).
   */
  async verifyIndexes(): Promise<IIndexAudit[]> {
    const models = this.#models;
    if (!models) {
      return [];
    }
    const audits: IIndexAudit[] = [];
    for (const [name, model] of Object.entries(models)) {
      const audit: IIndexAudit = {
        entity: name,
        collection: model.collection?.name ?? name,
        missing: [],
        extra: [],
      };
      try {
        // `init()` résout quand la construction est finie ; il REJETTE quand la
        // base l'a refusée — le seul endroit où ce motif est disponible.
        await model.init();
      } catch (error) {
        audit.error = error instanceof Error ? error.message : String(error);
      }
      try {
        const diff = await model.diffIndexes();
        audit.missing = diff.toCreate.map(indexName);
        audit.extra = diff.toDrop.map(indexName);
      } catch (error) {
        // Une connexion refermée pendant le constat n'est pas un défaut du
        // schéma : le dire serait un faux signal, et le taire une régression.
        if (this.isConnected()) {
          audit.error ??=
            error instanceof Error ? error.message : String(error);
        } else {
          return audits;
        }
      }
      this.#reportIndexAudit(audit);
      audits.push(audit);
    }
    return audits;
  }

  /**
   * Porte un verdict d'index au journal, à la hauteur de ce qu'il signifie.
   *
   * Un index manquant est un `CRITIC` : la contrainte que le code croit tenir
   * n'est pas tenue. Un index en trop n'est qu'une information — il vient
   * souvent d'un exploitant qui savait ce qu'il faisait, et rien ici ne le
   * supprimera.
   */
  #reportIndexAudit(audit: IIndexAudit): void {
    if (audit.error) {
      this.log(
        `index de "${audit.entity}" (collection "${audit.collection}") : ` +
          `la base a refusé la construction — ${audit.error}`,
        "CRITIC",
      );
    }
    if (audit.missing.length > 0) {
      this.log(
        `index DÉCLARÉS mais ABSENTS de la collection "${audit.collection}" ` +
          `(entité "${audit.entity}") : ${audit.missing.join(", ")} — toute ` +
          `contrainte d'unicité qu'ils portent n'est PAS appliquée`,
        "CRITIC",
      );
    }
    if (audit.extra.length > 0) {
      this.log(
        `index présents en base et non déclarés sur "${audit.collection}" : ` +
          `${audit.extra.join(", ")} — laissés en place`,
        "INFO",
      );
    }
  }

  /**
   * Délais d'attente **par défaut**, plus courts que ceux du driver.
   *
   * Le driver MongoDB attend **30 s** pour trouver un serveur utilisable
   * (`serverSelectionTimeoutMS`) et autant pour établir une connexion
   * (`connectTimeoutMS`) — vérifié au source, `connection_string.js`. Mesuré
   * sur une base arrêtée : une requête PEND 30 s avant d'échouer. Pour une
   * requête HTTP c'est absurde : le client a abandonné depuis longtemps, et
   * le worker reste bloqué à attendre une base dont on sait déjà qu'elle ne
   * répond pas.
   *
   * **5 s** est tenable parce que `retryReads`/`retryWrites` valent `true`
   * par défaut : une opération qui échoue en sélection est RETENTÉE, ce qui
   * porte la fenêtre effective à une dizaine de secondes — de quoi absorber
   * l'élection d'un nouveau primaire sans faire attendre le client deux fois
   * plus longtemps que nécessaire.
   *
   * `socketTimeoutMS` n'est délibérément PAS touché (le driver le laisse
   * infini) : le borner ici tuerait les agrégations longues légitimes. Ce
   * rôle revient à `timeoutMS` (CSOT), que seule l'application peut fixer en
   * connaissance de ses opérations.
   *
   * 🔴 **Un choix EXPLICITE gagne toujours** — qu'il vienne des options ou de
   * la chaîne de connexion. Poser un défaut n'autorise pas à écraser une
   * intention : une URI qui porte `?serverSelectionTimeoutMS=20000` dit ce
   * qu'elle veut, et l'objet d'options primerait silencieusement sur elle.
   */
  #delaisSains(): ConnectOptions {
    const fournis = this.#options ?? {};
    const dansUri = (cle: string): boolean =>
      new RegExp(`[?&]${cle}=`, "iu").test(this.#uri);
    const defauts: ConnectOptions = {};
    if (
      fournis.serverSelectionTimeoutMS === undefined &&
      !dansUri("serverSelectionTimeoutMS")
    ) {
      defauts.serverSelectionTimeoutMS = 5_000;
    }
    if (
      fournis.connectTimeoutMS === undefined &&
      !dansUri("connectTimeoutMS")
    ) {
      defauts.connectTimeoutMS = 5_000;
    }
    return { ...defauts, ...fournis };
  }

  /**
   * Traduit les événements du driver en signaux du contrat `orm-core`.
   *
   * Mongoose SAIT quand le serveur tombe — le setter de `readyState` émet
   * l'état, et le driver câble `serverDescriptionChanged` (topologie simple)
   * ou `topologyDescriptionChanged` (replica set : perte du primaire). Rien
   * n'écoutait, d'où une santé ORM qui affirmait « connecté » pendant toute
   * une coupure. `error` est écouté AUSSI parce qu'une `Connection` est un
   * `EventEmitter` : sans auditeur, une erreur émise ferait tomber le process.
   */
  #wireLifecycle(connection: Connection): void {
    const lost = (why: string) => (): void => this.connectionLost(why);
    const listeners: Array<[string, (...a: never[]) => void]> = [
      ["disconnected", lost("mongoose: disconnected")],
      ["close", lost("mongoose: close")],
      [
        "error",
        ((e: Error) =>
          this.connectionLost(
            `mongoose: ${e?.message ?? String(e)}`,
          )) as unknown as (...a: never[]) => void,
      ],
      ["reconnected", (): void => this.connectionRestored()],
      ["connected", (): void => this.connectionRestored()],
    ];
    for (const [event, handler] of listeners) {
      connection.on(event, handler as (...a: unknown[]) => void);
    }
    this.#lifecycle = listeners;
  }

  /** Détache les listeners de cycle de vie (anti-fuite, anti-empilement). */
  #unwireLifecycle(): void {
    const connection = this.#connection;
    if (connection && this.#lifecycle) {
      for (const [event, handler] of this.#lifecycle) {
        connection.removeListener(event, handler as (...a: unknown[]) => void);
      }
    }
    this.#lifecycle = null;
  }

  async disconnect(): Promise<void> {
    // `alive` d'abord, puis détacher : `close()` émet `close`, et un ORM
    // qu'on ferme volontairement n'a pas « perdu » sa connexion — le compter
    // comme un incident polluerait le tableau de bord à chaque arrêt propre.
    // Le PUITS qui suit n'est pas un détail : une `Connection` est un
    // `EventEmitter`, et la détacher entièrement juste avant de la fermer
    // rouvrirait — le temps de la fermeture — le défaut que ce câblage ferme.
    this.alive = false;
    this.stopHeartbeat();
    this.#unwireLifecycle();
    const connection = this.#connection;
    if (connection) {
      const sink = (): void => undefined;
      connection.on("error", sink);
      await connection.close();
    }
    this.#connection = null;
    this.#models = null;
    this.#repositories = null;
    this.#indexAudit = null;
  }

  getRepository<T = unknown>(name: string): IRepository<T> {
    const model = this.#models?.[name];
    if (!model) {
      throw new Error(
        `MongooseOrm "${this.name}": no entity model registered under "${name}".`,
      );
    }
    if (this.#repositories === null) {
      this.#repositories = Object.create(null) as Record<string, IRepository>;
    }
    let repository = this.#repositories[name];
    if (repository === undefined) {
      repository = new MongooseRepository(model, this.name);
      this.#repositories[name] = repository;
    }
    return repository as IRepository<T>;
  }

  async transaction<R>(work: (tx: ITransaction) => Promise<R>): Promise<R> {
    const connection = this.#connection;
    if (!connection) {
      throw new Error(`MongooseOrm "${this.name}": not connected.`);
    }
    const session = await connection.startSession();
    let result: R;
    try {
      // Managée : commit si la closure résout, abort si elle rejette (+ retries).
      await session.withTransaction(async () => {
        result = await work(new MongooseTransaction(session));
      });
    } finally {
      await session.endSession();
    }
    return result!;
  }

  getNativeConnection<C = unknown>(): C {
    if (!this.#connection) {
      throw new Error(`MongooseOrm "${this.name}": not connected.`);
    }
    return this.#connection as C;
  }

  /**
   * Ping bas-coût : commande `{ ping: 1 }` sur la base native (`admin().command`)
   * — round-trip réel vers MongoDB pour le diagnostic du data plane.
   *
   * @throws si la connexion (ou sa base native) n'est pas prête, ou si la base
   *   ne répond pas.
   */
  async ping(): Promise<void> {
    const db = this.#connection?.db;
    if (!db) {
      throw new Error(`MongooseOrm "${this.name}": not connected.`);
    }
    await db.admin().command({ ping: 1 });
  }

  /**
   * Sonde Mongo (best-effort) : connexions du serveur (`serverStatus`) → pool.
   * Round-trip réseau → uniquement pendant un abonnement actif. `{}` si indispo.
   *
   * @returns sonde `pool` + `extra`, ou `{}`.
   */
  async probe(): Promise<IOrmProbe> {
    const db = this.#connection?.db;
    if (!db) return {};
    try {
      const status = (await db.admin().serverStatus()) as {
        connections?: { current?: number; available?: number };
        version?: string;
      };
      const conn = status.connections;
      return {
        pool: {
          borrowed: conn?.current,
          available: conn?.available,
        },
        extra: status.version ? { serverVersion: status.version } : {},
      };
    } catch {
      return {};
    }
  }

  /**
   * Colonnes normalisées d'une entité depuis les `paths` du schéma Mongoose —
   * alimente le graphe canonique / ERD / contexte IA. Pas de PK SQL : `_id` est
   * la clé primaire implicite de tout document.
   *
   * @param name - nom logique de l'entité.
   * @returns colonnes (`[]` si l'entité n'est pas connue de cet ORM).
   */
  override describeEntity(name: string): IColumnInfo[] {
    const model = this.#models?.[name];
    if (!model) {
      return [];
    }
    const paths = model.schema.paths as Record<string, SchemaType>;
    // `field`, pas `path` : le module `node:path` est importé dans ce fichier et
    // s'en sert plus bas (`path.dirname`) — un `path` local le masquerait.
    return Object.entries(paths).map(([field, schemaType]) => ({
      name: field,
      // `instance` = type Mongoose ("String", "ObjectId", "Number", "Date"...).
      type: schemaType.instance || "Mixed",
      primaryKey: field === "_id",
      nullable: field === "_id" ? false : schemaType.isRequired !== true,
      unique: (schemaType.options as { unique?: unknown }).unique === true,
    }));
  }

  /**
   * Décrit la connexion : driver `mongodb` + cible (hôte:port/base, **sans
   * credentials**) + version de la lib `mongoose`. Aucun secret n'est exposé
   * dans le data plane (l'URI est nettoyée de tout `user:pass@`).
   *
   * @returns driver + cible nettoyée + version de l'ORM.
   */
  override describeConnection(): IConnectionInfo {
    return {
      driver: "mongodb",
      target: this.safeTarget(),
      ormVersion: MongooseOrm.#ormVersion(),
    };
  }

  /**
   * Cible affichable de l'URI, **sans credentials** : `hôte:port/base`. Jamais
   * de `user:pass@` (anti info-leak dans le data plane / les logs).
   */
  safeTarget(): string {
    try {
      const url = new URL(this.#uri);
      url.username = "";
      url.password = "";
      return `${url.host}${url.pathname}`;
    } catch {
      // URI multi-hôtes (`mongodb://h1,h2/db`) non parsable par URL → regex.
      return this.#uri
        .replace(/^mongodb(\+srv)?:\/\//, "")
        .replace(/^[^@/]*@/, "")
        .replace(/\?.*$/, "");
    }
  }

  /** Version de la lib `mongoose` (résolue + cachée une seule fois). */
  static #cachedOrmVersion: string | null | undefined;
  static #ormVersion(): string | undefined {
    if (MongooseOrm.#cachedOrmVersion === undefined) {
      MongooseOrm.#cachedOrmVersion =
        MongooseOrm.#resolvePkgVersion("mongoose") ?? null;
    }
    return MongooseOrm.#cachedOrmVersion ?? undefined;
  }

  /**
   * Version d'un package npm via son `package.json` (`createRequire` + remontée
   * FS). `require("<pkg>/package.json")` direct échoue souvent : `exports` ne
   * publie pas toujours `./package.json`.
   */
  static #resolvePkgVersion(name: string): string | undefined {
    try {
      const req = createRequire(import.meta.url);
      let dir = path.dirname(req.resolve(name));
      for (let i = 0; i < 8; i++) {
        const pkgPath = path.join(dir, "package.json");
        if (fs.existsSync(pkgPath)) {
          const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as {
            name?: string;
            version?: string;
          };
          if (pkg.name === name) return pkg.version;
        }
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
      }
    } catch {
      /* package introuvable / illisible → version inconnue */
    }
    return undefined;
  }
}
