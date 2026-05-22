import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { Sequelize } from "sequelize";
import type {
  DataType,
  Model,
  ModelAttributeColumnOptions,
  ModelAttributes,
  ModelStatic,
  Options,
} from "sequelize";
import { Orm, entityRegistry } from "@nodefony/orm-core";
import type {
  IColumnInfo,
  IConnectionInfo,
  IEntity,
  IRepository,
  ITransaction,
} from "@nodefony/orm-core";

/**
 * Type SQL lisible d'un attribut Sequelize **sans coupler au dialecte** :
 * `String(type)` rend le SQL concret (`VARCHAR(255)`) quand le `DataType` est lié,
 * sinon repli sur sa clé abstraite (`STRING`, `INTEGER`). Jamais de `throw`.
 */
function sequelizeColumnType(type: DataType): string {
  if (typeof type === "string") {
    return type;
  }
  try {
    const sql = String(type);
    if (sql && sql !== "[object Object]") {
      return sql;
    }
  } catch {
    // toString lié au dialecte peut throw avant sync → repli sur la clé.
  }
  return (type as { key?: string }).key ?? "unknown";
}
import { SequelizeRepository } from "./SequelizeRepository";
import { SequelizeTransaction } from "./SequelizeTransaction";

/**
 * Adapter Sequelize **branché sur `@nodefony/orm-core`** (P5.4).
 *
 * Implémentation propre et minimale du contrat {@link Orm}/`IOrm`, **distincte**
 * du service legacy `nodefony/service/orm.ts` (qui étend l'ancien `Orm` du core
 * `nodefony`). Sert de banc de validation de l'abstraction multi-ORM avant de
 * migrer le driver de production (P7.1).
 *
 * Flux : à `connect()` (template de {@link Orm}), instancie un `Sequelize`
 * natif, **compile les entités enregistrées** pour cet ORM (lues dans
 * `entityRegistry` via leur `schema`/`relations`), câble les associations,
 * puis `sync()` (dev/test ; la prod passera par migrations). Chaque entité reçoit
 * son `model` compilé ; `getRepository(name)` sert un {@link SequelizeRepository}.
 *
 * Limites assumées (ADR-0003) : pas de jointure/eager-load via le repository
 * portable → `getNativeConnection()` ; transaction managée → threader la tx aux
 * repositories reste du ressort natif.
 */
export class SequelizeOrm extends Orm {
  #sequelize: Sequelize | null = null;
  #connected = false;
  /** Version du moteur SQL capturée à la connexion (la requête est async). */
  #engineVersion: string | undefined;
  /** Modèles compilés indexés par nom logique d'entité (lazy). */
  #models: Record<string, ModelStatic<Model>> | null = null;
  /** Repositories mémoïsés par nom d'entité (lazy). */
  #repositories: Record<string, IRepository> | null = null;
  readonly #options: Options;

  /**
   * @param name - clé unique de l'ORM dans le `ormRegistry` (ex. `"db_test"`).
   * @param options - options de connexion Sequelize (dialect, storage, host...).
   */
  constructor(name: string, options: Options) {
    super(name);
    this.#options = options;
  }

  /** Entités enregistrées dans `entityRegistry` ciblant cet ORM. */
  #ownEntities(): IEntity[] {
    return entityRegistry.list().filter((entity) => entity.orm === this.name);
  }

  /**
   * Nom de clé étrangère déterministe (camelCase) `<entité>Id`.
   *
   * Sequelize génère par défaut une FK PascalCase (`UserId`) ; on force le
   * camelCase (`userId`) pour un contrat stable et lisible côté repository
   * portable (le critère `{ userId }` doit matcher la colonne).
   */
  #foreignKey(entityName: string): string {
    return `${entityName.charAt(0).toLowerCase()}${entityName.slice(1)}Id`;
  }

  protected async onConnect(): Promise<void> {
    const sequelize = new Sequelize(this.#options);
    await sequelize.authenticate();
    this.#sequelize = sequelize;
    // Version du moteur capturée maintenant : `databaseVersion()` est async, alors
    // que `describeConnection()` (data plane) est synchrone.
    this.#engineVersion = await sequelize
      .databaseVersion()
      .catch(() => undefined);
    this.#models = Object.create(null) as Record<string, ModelStatic<Model>>;

    const entities = this.#ownEntities();

    // 1) Compilation des modèles depuis le schéma natif de chaque entité.
    for (const entity of entities) {
      const model = sequelize.define(
        entity.name,
        entity.schema as ModelAttributes,
        { tableName: entity.name, timestamps: false },
      );
      this.#models[entity.name] = model;
      entity.model = model;
    }

    // 2) Câblage des associations déclaratives.
    for (const entity of entities) {
      if (!entity.relations) {
        continue;
      }
      const source = this.#models[entity.name];
      for (const relation of entity.relations) {
        const target = this.#models[relation.target];
        if (!target) {
          throw new Error(
            `SequelizeOrm "${this.name}": relation target "${relation.target}" ` +
              `(from "${entity.name}.${relation.field}") not registered for this ORM.`,
          );
        }
        switch (relation.type) {
          case "one-to-many":
            // FK sur la cible, nommée d'après la source (`userId` sur Room).
            source.hasMany(target, {
              as: relation.field,
              foreignKey: relation.foreignKey ?? this.#foreignKey(entity.name),
            });
            break;
          case "many-to-one":
            // FK sur la source, nommée d'après la cible (inverse cohérent).
            source.belongsTo(target, {
              as: relation.field,
              foreignKey:
                relation.foreignKey ?? this.#foreignKey(relation.target),
            });
            break;
          case "one-to-one":
            source.hasOne(target, {
              as: relation.field,
              foreignKey: relation.foreignKey ?? this.#foreignKey(entity.name),
            });
            break;
          case "many-to-many":
            throw new Error(
              `SequelizeOrm "${this.name}": many-to-many ("${entity.name}.${relation.field}") ` +
                `non portable — déclarer via getNativeConnection().`,
            );
        }
      }
    }

    // 3) Création du schéma (dev/test uniquement ; prod = migrations).
    await sequelize.sync();
    this.#connected = true;
  }

  async disconnect(): Promise<void> {
    if (this.#sequelize) {
      await this.#sequelize.close();
    }
    this.#sequelize = null;
    this.#connected = false;
    this.#engineVersion = undefined;
    this.#models = null;
    this.#repositories = null;
  }

  isConnected(): boolean {
    return this.#connected;
  }

  getRepository<T = unknown>(name: string): IRepository<T> {
    const model = this.#models?.[name];
    if (!model) {
      throw new Error(
        `SequelizeOrm "${this.name}": no entity model registered under "${name}".`,
      );
    }
    if (this.#repositories === null) {
      this.#repositories = Object.create(null) as Record<string, IRepository>;
    }
    let repository = this.#repositories[name];
    if (repository === undefined) {
      repository = new SequelizeRepository(model);
      this.#repositories[name] = repository;
    }
    return repository as IRepository<T>;
  }

  async transaction<R>(work: (tx: ITransaction) => Promise<R>): Promise<R> {
    const sequelize = this.#sequelize;
    if (!sequelize) {
      throw new Error(`SequelizeOrm "${this.name}": not connected.`);
    }
    // Transaction managée : commit si la closure résout, rollback si elle rejette.
    return sequelize.transaction((native) =>
      work(new SequelizeTransaction(sequelize, native)),
    );
  }

  getNativeConnection<C = unknown>(): C {
    if (!this.#sequelize) {
      throw new Error(`SequelizeOrm "${this.name}": not connected.`);
    }
    return this.#sequelize as C;
  }

  /**
   * Colonnes normalisées d'une entité depuis les attributs Sequelize compilés
   * (`getAttributes`) — alimente le graphe canonique / ERD / contexte IA.
   *
   * @param name - nom logique de l'entité.
   * @returns colonnes (`[]` si l'entité n'est pas connue de cet ORM).
   */
  override describeEntity(name: string): IColumnInfo[] {
    const model = this.#models?.[name];
    if (!model) {
      return [];
    }
    const attributes = model.getAttributes() as Record<
      string,
      ModelAttributeColumnOptions
    >;
    return Object.entries(attributes).map(([key, attr]) => ({
      // `field` = nom de colonne en base ; défaut = clé de l'attribut.
      name: attr.field ?? key,
      type: sequelizeColumnType(attr.type),
      primaryKey: attr.primaryKey === true,
      // Sequelize : NULL autorisé par défaut, jamais sur une PK.
      nullable: attr.primaryKey === true ? false : attr.allowNull !== false,
      // `unique` peut être un booléen, une chaîne (index nommé) ou un objet.
      unique: attr.unique != null && attr.unique !== false,
    }));
  }

  /**
   * Décrit la connexion sous-jacente : dialecte (= driver, `sqlite`/`postgres`/
   * `mysql`/`mariadb`…), cible lisible et versions (moteur + lib Sequelize).
   *
   * **Sécurité** : aucune fuite. Cible SQLite = chemin **relatif** au cwd (jamais
   * d'absolu → pas d'arborescence FS du serveur) ; cible serveur = `host:port/base`
   * **sans** credential (username/password jamais inclus). Cf règle info-leak FS.
   *
   * @returns driver + cible (relative/`:memory:`/`host:port/db`) + versions.
   */
  override describeConnection(): IConnectionInfo {
    return {
      driver: String(
        this.#options.dialect ?? this.#sequelize?.getDialect() ?? "sequelize",
      ),
      target: this.#safeTarget(),
      version: this.#engineVersion,
      ormVersion: SequelizeOrm.#ormVersion(),
    };
  }

  /**
   * Cible affichable, sans fuite : SQLite → `:memory:` ou chemin **relatif** au
   * cwd (basename si hors projet) ; serveur → `host:port/base` **sans** credential.
   */
  #safeTarget(): string | undefined {
    const dialect = String(this.#options.dialect ?? "");
    if (dialect === "sqlite") {
      const storage = this.#options.storage;
      if (!storage || storage === ":memory:") {
        return ":memory:";
      }
      if (!path.isAbsolute(storage)) {
        return storage;
      }
      const rel = path.relative(process.cwd(), storage);
      return rel && !rel.startsWith("..") ? rel : path.basename(storage);
    }
    // Dialectes serveur : host:port/base — JAMAIS username/password.
    const host = this.#options.host ?? "localhost";
    const port = this.#options.port != null ? `:${this.#options.port}` : "";
    const database = this.#options.database ? `/${this.#options.database}` : "";
    return `${host}${port}${database}`;
  }

  /** Version de la lib `sequelize` (résolue + cachée une seule fois). */
  static #cachedOrmVersion: string | null | undefined;
  static #ormVersion(): string | undefined {
    if (SequelizeOrm.#cachedOrmVersion === undefined) {
      SequelizeOrm.#cachedOrmVersion =
        SequelizeOrm.#resolvePkgVersion("sequelize") ?? null;
    }
    return SequelizeOrm.#cachedOrmVersion ?? undefined;
  }

  /**
   * Version d'un package npm via son `package.json` — `createRequire` + remontée
   * FS (`require("<pkg>/package.json")` direct échoue souvent : `exports` ne
   * publie pas toujours `./package.json`).
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
