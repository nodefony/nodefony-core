/// <reference types="node" />
/**
 * Unit — les CAPACITÉS de page publiées par le catalogue admin.
 *
 * Une console d'administration doit savoir quoi proposer au tri et au filtre.
 * Sans publication elle le code en dur, et se trompe forcément : le tri n'est
 * pas une propriété de la ressource mais du **store branché** (Redis n'en offre
 * aucun, une base SQL en offre quatre). Ce banc éprouve que le catalogue publie
 * la donnée, et surtout qu'il l'ÉVALUE à la lecture plutôt que de la figer.
 */
import { expect } from "chai";
import { createFrameworkAdminApi } from "../../src/FrameworkAdminApi.js";
import type {
  IAdminApi,
  IAdminEndpoint,
  IAdminRequest,
  IFilterSpec,
} from "nodefony";
import type { IAdminBroker, IAdminRoute } from "../../interfaces/IAdminBroker";

const FILTERS = {
  enabled: "boolean",
  kind: ["pat", "refresh"],
} as const satisfies IFilterSpec;

/** Requête admin minimale — le catalogue n'en lit rien. */
const request = {
  params: {},
  query: {},
  body: null,
  roles: [],
} as unknown as IAdminRequest;

/**
 * Broker de test : rend les routes qu'on lui donne, sans Router ni kernel.
 *
 * @param endpoints - endpoints à exposer sous le namespace `demo`.
 * @returns un broker minimal, suffisant pour lire le catalogue.
 */
function brokerWith(endpoints: IAdminEndpoint[]): IAdminBroker {
  const api: IAdminApi = {
    adminNamespace: "demo",
    adminDescriptor: () => ({ label: "Démo" }),
    adminEndpoints: () => endpoints,
  };
  const routes: IAdminRoute[] = endpoints.map((endpoint, i) => ({
    name: `admin.demo.GET.${i}`,
    namespace: "demo",
    path: `/nodefony/demo/api/${endpoint.path}`,
    method: endpoint.method ?? "GET",
    role: "ROLE_NODEFONY_ADMIN",
    endpoint,
  }));
  return {
    list: () => [api],
    routes: () => routes,
  } as unknown as IAdminBroker;
}

/** Lit le catalogue et rend la ligne d'un endpoint donné. */
async function catalogEntry(
  broker: IAdminBroker,
  path: string,
): Promise<Record<string, unknown> | undefined> {
  const api = createFrameworkAdminApi(broker);
  const endpoint = api
    .adminEndpoints()
    .find((e) => e.path === "admin") as IAdminEndpoint;
  const body = (await endpoint.handler(request)) as {
    producers: { endpoints: Record<string, unknown>[] }[];
  };
  return body.producers
    .flatMap((p) => p.endpoints)
    .find((e) => e.path === `/nodefony/demo/api/${path}`);
}

describe("catalogue admin — capacités de page", () => {
  it("publie le tri et les filtres d'un endpoint qui les déclare", async () => {
    const entry = await catalogEntry(
      brokerWith([
        {
          path: "things",
          summary: "démo",
          page: { sortable: () => ["createdAt", "id"], filters: FILTERS },
          handler: () => ({}),
        },
      ]),
      "things",
    );
    expect(entry?.page).to.deep.equal({
      sortable: ["createdAt", "id"],
      filters: { enabled: "boolean", kind: ["pat", "refresh"] },
    });
  });

  it("n'invente RIEN pour un endpoint qui ne déclare pas de page", async () => {
    // Absent plutôt que vide : une console doit pouvoir distinguer « cet
    // endpoint n'est pas paginé » de « il l'est, mais ne trie rien ».
    const entry = await catalogEntry(
      brokerWith([{ path: "info", handler: () => ({}) }]),
      "info",
    );
    expect(entry).to.not.have.property("page");
  });

  it("un tri VIDE est publié — c'est une réponse, pas une absence", async () => {
    // Le cas du store Redis : il énumère mais ne trie pas. La console doit
    // l'apprendre, sinon elle affiche des en-têtes qui répondront 400.
    const entry = await catalogEntry(
      brokerWith([
        {
          path: "sessions",
          page: { sortable: () => [], filters: {} },
          handler: () => ({}),
        },
      ]),
      "sessions",
    );
    expect(entry?.page).to.deep.equal({ sortable: [], filters: {} });
  });

  it("`sortable` est ÉVALUÉ à chaque lecture, jamais figé au démarrage", async () => {
    // Ce qui rend la publication juste : le store peut n'être branché qu'après
    // le montage des routes, et un service peut devenir indisponible. Une
    // capacité capturée une fois mentirait dans les deux cas.
    let backend: string[] = [];
    const broker = brokerWith([
      {
        path: "things",
        page: { sortable: () => backend, filters: {} },
        handler: () => ({}),
      },
    ]);
    expect((await catalogEntry(broker, "things"))?.page).to.deep.equal({
      sortable: [],
      filters: {},
    });
    backend = ["name"];
    expect((await catalogEntry(broker, "things"))?.page).to.deep.equal({
      sortable: ["name"],
      filters: {},
    });
  });

  it("la spec de filtre traverse en JSON, telle qu'elle est déclarée", async () => {
    // C'est la propriété qui la rend publiable : une DONNÉE, pas des fonctions
    // de lecture. Une énumération arrive au front comme sa liste de valeurs,
    // donc utilisable directement comme domaine d'un menu déroulant.
    const entry = await catalogEntry(
      brokerWith([
        {
          path: "things",
          page: { filters: FILTERS },
          handler: () => ({}),
        },
      ]),
      "things",
    );
    const page = entry?.page as { filters: Record<string, unknown> };
    expect(JSON.parse(JSON.stringify(page.filters))).to.deep.equal({
      enabled: "boolean",
      kind: ["pat", "refresh"],
    });
  });
});
