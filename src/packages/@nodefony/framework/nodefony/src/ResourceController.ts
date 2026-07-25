import Controller from "./Controller";
import type { ControllerScope } from "./Controller";
import { HttpError } from "@nodefony/http";
import type { ContextType } from "@nodefony/http";
import { assertPageQuery } from "nodefony";
import type { IPage, IPageQuery } from "nodefony";

/**
 * Contrat structurel du service de ressource consommé par un
 * {@link ResourceController} — aligné sur `AbstractCrudService`
 * (`@nodefony/orm-core`) SANS en dépendre : le framework ne connaît pas
 * l'ORM, n'importe quel objet de cette forme convient (service DI, objet
 * en mémoire, façade distante…). `create`/`updateOne`/`delete` sont
 * optionnels : une ressource read-only n'expose que la lecture.
 */
/**
 * Options de lecture d'une liste — **pagination avant tout**.
 *
 * Elles font partie du contrat parce qu'une ressource sans borne est une fuite qui
 * attend son heure : le jour où la table grossit, `find()` charge tout en mémoire.
 * Miroir structurel de `RepositoryReadOptions` (`@nodefony/orm-core`), sans dépendre
 * de l'ORM.
 */
export interface IResourceReadOptions {
  /** Nombre maximum d'enregistrements rendus. */
  limit?: number;
  /** Enregistrements sautés (⚠️ se dégrade sur les grandes tables — curseur à venir). */
  offset?: number;
  /**
   * Tri, sous la forme `[[champ, sens], …]` — même écriture que `IPageQuery.order`
   * (core) et que `RepositoryReadOptions` (orm-core).
   *
   * Typé plutôt que libre : une porte qui doit deviner la forme attendue finit
   * par la caster, et le tri se perd en silence — la pagination devient alors
   * fausse par intermittence, ce qui est pire qu'absente.
   */
  order?: Array<[string, "ASC" | "DESC"]>;
  /** Associations à charger avec l'enregistrement. */
  relations?: string[];
}

/**
 * Requête de page telle qu'une porte la passe au service — `IPageQuery` du core,
 * plus les critères que la sous-classe a EXPLICITEMENT décidé d'exposer.
 *
 * Miroir structurel de `PageQuery<T>` (orm-core) sans dépendre de l'ORM : le
 * framework ne connaît pas `Criteria<T>`.
 */
export interface IResourcePageQuery extends IPageQuery {
  /** Critères de filtrage — jamais dérivés de la query string automatiquement. */
  criteria?: Record<string, unknown>;
}

export interface IResourceService<T = unknown> {
  find(
    criteria?: Record<string, unknown>,
    options?: IResourceReadOptions,
  ): Promise<T[]> | T[];
  /**
   * Lit par identifiant. `options.relations` charge les associations en une fois
   * (`AbstractCrudService` le transmet au repository, qui sait les résoudre).
   */
  findById(
    id: string,
    options?: IResourceReadOptions,
  ): Promise<T | null> | T | null;
  /**
   * Rend une PAGE plutôt qu'un tableau nu — `AbstractCrudService` l'hérite déjà
   * (`findPage` → `paginate`).
   *
   * Optionnel : une ressource read-only ou une façade en mémoire n'a pas à
   * l'implémenter, `listPageResource` sait alors reconstituer la page à partir
   * de `find`.
   */
  findPage?(page: IResourcePageQuery): Promise<IPage<T>> | IPage<T>;
  create?(data: Partial<T>): Promise<T> | T;
  updateOne?(
    criteria: Record<string, unknown>,
    data: Partial<T>,
  ): Promise<T | null> | T | null;
  delete?(criteria: Record<string, unknown>): Promise<number> | number;
}

/**
 * Controller de ressource **souverain** (V4.2 — POC API souveraine, Phase 2) :
 * la logique métier est écrite UNE fois dans le service de ressource, les
 * actions de la sous-classe ne sont que des portes (REST, WS-RPC `invoke`,
 * GraphQL à venir) qui retournent la **valeur brute** — `returnController`
 * l'auto-JSON en REST, le pont WS l'enveloppe (`{id,result}`), sans réécrire
 * l'action par transport.
 *
 * **Stateless par construction** :
 * - `static scope = "singleton"` : UNE instance partagée (cache Router, V4.3).
 *   L'état per-request n'existe PAS sur `this` — il arrive par les arguments
 *   décorés (`@Param`/`@Body`/`@Query`) et par les helpers hérités qui
 *   retrouvent la requête courante via l'ALS (V4.1).
 * - le seul champ est `resource`, posé 1× au constructor (état de BOOT,
 *   immuable ensuite — sûr en concurrence).
 * - règle absolue pour les sous-classes : **jamais `this.x = …` par requête**
 *   (data race silencieuse). Une sous-classe qui a besoin d'état per-request
 *   sur `this` doit rétrograder : `static scope = "request"`.
 *
 * Sécurité : aucun critère de requête n'est passé AUTOMATIQUEMENT au service
 * (pas de `find(this.queryGet)` implicite) — exposer un filtrage est une
 * décision EXPLICITE de la sous-classe (deny-by-default ; le scope de
 * sécurité des données se branche au niveau service/criteria, P6).
 *
 * @example
 * ```ts
 * \@controller("/api/books")
 * class BookController extends ResourceController<Book> {
 *   constructor(context: Context) {
 *     super("BookController", context, bookService);
 *   }
 *   \@route("books-list", { path: "", requirements: { methods: ["GET", "WEBSOCKET"] } })
 *   list() {
 *     return this.listResource();
 *   }
 *   \@route("books-get", { path: "/{id}", requirements: { methods: ["GET", "WEBSOCKET"] } })
 *   detail(\@Param("id") id: string) {
 *     return this.getResource(id);
 *   }
 * }
 * ```
 */
class ResourceController<T = unknown> extends Controller {
  /**
   * Singleton PAR DÉFAUT : la classe est conçue stateless — premier client
   * du scope V4.3. Une sous-classe peut rétrograder (`static scope =
   * "request"`) si elle doit porter de l'état per-request sur `this`.
   */
  static override scope: ControllerScope = "singleton";

  /**
   * Service de ressource — état de BOOT (posé 1× ici, jamais réassigné).
   * `protected` : les actions de la sous-classe y accèdent, les portes non.
   */
  protected resource: IResourceService<T> | null = null;

  constructor(
    name: string,
    context: ContextType,
    resource?: IResourceService<T>,
  ) {
    super(name, context);
    if (resource) {
      this.resource = resource;
    }
  }

  /**
   * Service de ressource garanti — 500 explicite si la sous-classe ne l'a
   * pas fourni (erreur de câblage, pas une erreur client).
   */
  protected requireResource(): IResourceService<T> {
    if (!this.resource) {
      throw new HttpError(
        `${this.name}: no resource service wired (pass it to super(name, context, resource))`,
        500,
        this.context,
      );
    }
    return this.resource;
  }

  /**
   * Liste la ressource. `criteria` est EXPLICITE (jamais dérivé de la query
   * string automatiquement — deny-by-default).
   */
  protected listResource(
    criteria?: Record<string, unknown>,
    options?: IResourceReadOptions,
  ): Promise<T[]> {
    return Promise.resolve(this.requireResource().find(criteria, options));
  }

  /**
   * Liste la ressource en rendant une **page** (`{ items, hasNext, total? }`)
   * plutôt qu'un tableau nu.
   *
   * Pourquoi une page et pas un tableau : un tableau ne dit pas s'il en reste.
   * Le client qui reçoit 25 lignes ne peut pas distinguer « c'est tout » de
   * « demande la suite » — il redemande indéfiniment, ou s'arrête trop tôt.
   *
   * **Mode offset imposé** (`assertPageQuery`) : un client qui enverrait un
   * `cursor` recevrait sinon la page 1 à chaque appel, en boucle et sans erreur.
   *
   * Si le service n'expose pas `findPage`, la page est reconstituée à partir de
   * `find` en chargeant `limit + 1` lignes (même technique que `paginate`) : le
   * `hasNext` reste exact, seul `total` manque — et son absence est lisible dans
   * la réponse, le contrat `IPage` le donnant pour optionnel.
   *
   * @param page - bornes, tri et critères de la page demandée.
   * @returns la page (`items` borné à `limit`).
   * @throws PaginationModeError si la requête mélange offset et curseur.
   */
  protected async listPageResource(
    page: IResourcePageQuery,
  ): Promise<IPage<T>> {
    assertPageQuery(page, "offset");
    const resource = this.requireResource();
    if (typeof resource.findPage === "function") {
      return resource.findPage(page);
    }
    const limit = Math.max(1, Math.floor(page.limit));
    const offset = Math.max(0, Math.floor(page.offset ?? 0));
    const rows = await Promise.resolve(
      resource.find(page.criteria, {
        limit: limit + 1,
        offset,
        order: page.order,
      }),
    );
    const hasNext = rows.length > limit;
    return {
      items: hasNext ? rows.slice(0, limit) : rows,
      limit,
      offset,
      hasNext,
    };
  }

  /**
   * Lit une entité par id — `null` si absente (la porte décide du 404).
   *
   * `options.relations` charge les associations dans la foulée. La porte doit
   * n'y laisser passer que des relations qu'elle a DÉCLARÉES : un `include`
   * libre laisse le client nommer n'importe quelle association, donc lire des
   * données qu'aucune route ne lui ouvre.
   */
  protected getResource(
    id: string,
    options?: IResourceReadOptions,
  ): Promise<T | null> {
    return Promise.resolve(this.requireResource().findById(id, options));
  }

  /** Crée une entité — 501 si la ressource est read-only. */
  protected createResource(data: Partial<T>): Promise<T> {
    const resource = this.requireResource();
    if (typeof resource.create !== "function") {
      throw new HttpError(
        `${this.name}: resource is read-only (no create)`,
        501,
        this.context,
      );
    }
    return Promise.resolve(resource.create(data));
  }

  /** Met à jour une entité ciblée par critères — 501 si non supporté. */
  protected updateResource(
    criteria: Record<string, unknown>,
    data: Partial<T>,
  ): Promise<T | null> {
    const resource = this.requireResource();
    if (typeof resource.updateOne !== "function") {
      throw new HttpError(
        `${this.name}: resource is read-only (no updateOne)`,
        501,
        this.context,
      );
    }
    return Promise.resolve(resource.updateOne(criteria, data));
  }

  /** Supprime par critères (nombre d'entités touchées) — 501 si non supporté. */
  protected removeResource(criteria: Record<string, unknown>): Promise<number> {
    const resource = this.requireResource();
    if (typeof resource.delete !== "function") {
      throw new HttpError(
        `${this.name}: resource is read-only (no delete)`,
        501,
        this.context,
      );
    }
    return Promise.resolve(resource.delete(criteria));
  }
}

export default ResourceController;
