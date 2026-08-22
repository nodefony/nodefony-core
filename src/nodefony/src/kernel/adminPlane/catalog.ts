import type { AdminHttpMethod, IAdminEndpoint } from "../../types/IAdminApi";
import type { IAdminBrokerLike } from "../inspect/adminSubjects";
import type { IAdminCaller } from "./adminCaller";
import { isAdminGranted, resolveAdminRole } from "./adminRbac";

/**
 * Un endpoint du plan d'administration, tel qu'une porte sans session peut le
 * proposer — de quoi l'APPELER, rien de plus.
 *
 * Ce que porte `params` mérite son existence : les chemins du plan portent des
 * variables (`module/{name}/docs/{slug}`) et un appelant qui les devine se
 * trompe une fois sur deux. Les nommer ici coûte une expression régulière et
 * supprime un aller-retour.
 */
export interface IAdminCatalogEntry {
  /** Producteur (`kernel`, `security`, `orm`…) — premier segment de la route. */
  namespace: string;
  /** Chemin déclaré par le producteur, variables comprises. */
  path: string;
  /** Méthode — toujours `"GET"` dans ce catalogue, cf {@link adminReadCatalog}. */
  method: AdminHttpMethod;
  /** Ce que l'endpoint rend, en une ligne, telle que son auteur l'a écrite. */
  summary: string;
  /** Noms des variables du chemin, dans l'ordre où elles apparaissent. */
  params: readonly string[];
  /**
   * Ce que l'endpoint sait faire d'une liste, quand il en rend une.
   *
   * Publié parce que le défaut du plan est le REFUS : un tri ou un filtre non
   * déclaré rend `400`, jamais une liste approximative. Sans cette
   * publication, un appelant tente `?sort=createdAt`, se fait refuser, et
   * conclut que l'endpoint est cassé — alors qu'il ne l'a simplement jamais
   * annoncé. Évalué à la lecture : c'est le store branché au démarrage qui
   * répond, pas une constante de compilation.
   */
  page?: {
    /** Champs sur lesquels `?sort=` est accepté. */
    sortable: readonly string[];
    /** Noms de filtre acceptés, tels que le vocabulaire de l'endpoint les nomme. */
    filters: readonly string[];
    /** L'endpoint honore-t-il `?q=` ? */
    search: boolean;
  };
}

/** Restriction de lecture du catalogue — sans effet sur ce qui est APPELABLE. */
export interface IAdminCatalogQuery {
  /** Ne garder qu'un producteur. */
  namespace?: string;
  /** Termes cherchés dans le chemin et le résumé ; espaces = termes CUMULATIFS. */
  q?: string;
}

/**
 * Ce que le catalogue montre, ET ce qu'il a écarté.
 *
 * Les compteurs ne sont pas décoratifs : sans eux, une liste de 61 entrées se
 * lit comme « voilà tout le plan d'administration », et un appelant conclut
 * qu'une capacité n'existe pas alors qu'elle est seulement hors de portée de
 * CETTE porte. Un écart se DIT, il ne se devine pas.
 */
export interface IAdminCatalogView {
  /** Les endpoints appelables, groupés par personne — l'ordre de déclaration. */
  entries: IAdminCatalogEntry[];
  /** Combien d'endpoints le plan déclare en tout. */
  total: number;
  /** Écartés parce que ce sont des mutations (POST/PATCH/PUT/DELETE). */
  mutations: number;
  /** Écartés parce qu'ils sont scopés à une session (`public: true`). */
  selfService: number;
  /** Écartés faute du rôle exigé par l'endpoint. */
  denied: number;
  /** Écartés par la restriction de lecture demandée ({@link IAdminCatalogQuery}). */
  filtered: number;
}

/** Variables d'un chemin de route (`module/{name}/docs/{slug}` → name, slug). */
const PATH_VARIABLE = /\{([^}]+)\}/gu;

/**
 * Noms des variables portées par un chemin de route.
 *
 * @param path - chemin déclaré par le producteur.
 * @returns les noms, dans l'ordre d'apparition.
 */
function pathParams(path: string): string[] {
  const found: string[] = [];
  for (const match of path.matchAll(PATH_VARIABLE)) {
    if (match[1]) found.push(match[1]);
  }
  return found;
}

/**
 * Projette les capacités de page déclarées, en les ÉVALUANT.
 *
 * `sortable` et `search` sont des fonctions parce que la réponse dépend du
 * store effectivement branché — un backend en curseur ne balaie pas, un
 * annuaire en mémoire ne connaît pas `createdAt`. Les appeler ici est donc la
 * seule façon de publier une capacité vraie ; recopier une liste constante
 * annoncerait un tri que le premier appel refuserait.
 *
 * @param page - la déclaration du producteur.
 * @returns la capacité, telle qu'elle vaut maintenant.
 */
function readPageCapabilities(
  page: NonNullable<IAdminEndpoint["page"]>,
): NonNullable<IAdminCatalogEntry["page"]> {
  return {
    sortable: page.sortable?.() ?? [],
    filters: Object.keys(page.filters ?? {}),
    search: page.search?.() ?? false,
  };
}

/**
 * L'entrée répond-elle à tous les termes cherchés ?
 *
 * Cumulatifs, et non alternatifs : chercher « module docs » veut dire « les
 * deux », sinon la restriction rendrait plus de lignes que l'absence de
 * restriction.
 */
function matches(entry: IAdminCatalogEntry, terms: readonly string[]): boolean {
  if (terms.length === 0) return true;
  const haystack = `${entry.path} ${entry.summary}`.toLowerCase();
  return terms.every((term) => haystack.includes(term));
}

/**
 * Les endpoints du plan d'administration qu'une porte **sans session** peut
 * servir à cet appelant — la règle unique dont dépendent `nodefony_admin_list`
 * ET `nodefony_admin_call`.
 *
 * ⭐ **Ce qui est listé est appelable, et rien d'autre ne l'est.** C'est le même
 * patron que le filtrage des outils MCP à la collecte : un seul point de
 * décision sert la liste et l'exécution, donc il ne peut pas exister d'entrée
 * appelable qu'on n'aurait pas annoncée, ni d'entrée annoncée qui refuserait
 * ensuite. Deux points de décision, c'est celui qu'on relit le moins qui
 * devient le plus permissif.
 *
 * Trois exclusions, toutes comptées et donc dicibles :
 *
 * 1. **Les mutations.** L'idempotence des mutations du plan est une porte du
 *    transport HTTP (`AdminApiController.idempotencyGate`, qui a besoin du
 *    conteneur) ; l'exécuter d'ici sans elle ferait de cette porte une
 *    quatrième voie qui perd ce que les autres gardent — précisément ce que
 *    l'unification de l'exécution vient de supprimer. Elles se compteront tant
 *    qu'elles ne s'appelleront pas.
 * 2. **Les endpoints `public: true`.** Ce ne sont pas des endpoints libres :
 *    ce sont des self-service scopés à `request.user` (`me`, `me/password`,
 *    `sessions/mine`) ou des sondes d'infrastructure. Une porte sans session
 *    n'a pas d'utilisateur ; les servir rendrait « les données de personne » au
 *    mieux, celles d'autrui au pire.
 * 3. **Ce que le rôle de l'appelant n'ouvre pas** — la même décision que
 *    l'exécution ({@link isAdminGranted}), prise sur le même rôle résolu
 *    ({@link resolveAdminRole}), pour que la liste ne promette jamais ce que
 *    l'appel refuserait.
 *
 * @param broker - le service `adminBroker` du conteneur, ou `undefined`.
 * @param caller - qui demande, avec ses rôles RÉELS.
 * @param query - restriction de lecture facultative.
 * @returns les entrées appelables, et le compte de ce qui ne l'est pas.
 */
export function adminReadCatalog(
  broker: IAdminBrokerLike | undefined,
  caller: IAdminCaller,
  query?: IAdminCatalogQuery,
): IAdminCatalogView {
  const terms =
    query?.q
      ?.toLowerCase()
      .split(/\s+/u)
      .filter((term) => term !== "") ?? [];
  const view: IAdminCatalogView = {
    entries: [],
    total: 0,
    mutations: 0,
    selfService: 0,
    denied: 0,
    filtered: 0,
  };

  for (const api of broker?.list() ?? []) {
    const namespace = api.adminNamespace;
    let endpoints: readonly IAdminEndpoint[];
    try {
      endpoints = api.adminEndpoints();
    } catch {
      // Un producteur qui échoue à se décrire ne doit pas priver l'appelant du
      // catalogue de tous les autres — même règle que la collecte des outils.
      continue;
    }
    for (const endpoint of endpoints) {
      view.total += 1;
      if ((endpoint.method ?? "GET") !== "GET") {
        view.mutations += 1;
        continue;
      }
      if (endpoint.public) {
        view.selfService += 1;
        continue;
      }
      if (!isAdminGranted(caller.roles, resolveAdminRole(endpoint))) {
        view.denied += 1;
        continue;
      }
      if (query?.namespace && query.namespace !== namespace) {
        view.filtered += 1;
        continue;
      }
      const entry: IAdminCatalogEntry = {
        namespace,
        path: endpoint.path,
        method: "GET",
        summary: endpoint.summary ?? "",
        params: pathParams(endpoint.path),
        ...(endpoint.page ? { page: readPageCapabilities(endpoint.page) } : {}),
      };
      if (!matches(entry, terms)) {
        view.filtered += 1;
        continue;
      }
      view.entries.push(entry);
    }
  }
  return view;
}

/**
 * Retrouve une entrée APPELABLE par son couple producteur/chemin.
 *
 * Passe par {@link adminReadCatalog} plutôt que de reparcourir le registre :
 * c'est ce qui garantit que l'appel et la liste tranchent la même chose. Une
 * seconde traversée « équivalente » serait exactement la divergence que ce
 * module supprime.
 *
 * @param broker - le service `adminBroker` du conteneur, ou `undefined`.
 * @param caller - qui demande, avec ses rôles RÉELS.
 * @param namespace - producteur visé.
 * @param path - chemin visé, tel que le catalogue le nomme (variables comprises).
 * @returns l'entrée, ou `null` si elle n'est pas appelable par cet appelant.
 */
export function findAdminReadEntry(
  broker: IAdminBrokerLike | undefined,
  caller: IAdminCaller,
  namespace: string,
  path: string,
): IAdminCatalogEntry | null {
  const { entries } = adminReadCatalog(broker, caller, { namespace });
  return entries.find((entry) => entry.path === path) ?? null;
}
