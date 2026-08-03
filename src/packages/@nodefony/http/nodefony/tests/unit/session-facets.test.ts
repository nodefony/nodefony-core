/// <reference types="node" />
/*
 *   NODEFONY — les COMPTEURS de la console portent sur la collection ENTIÈRE
 *
 *   Ces cartes étaient calculées dans le navigateur, sur la page chargée : avec
 *   une fenêtre de 25 lignes elles décrivaient l'échantillon visible en ayant
 *   l'air de décrire le parc. Ce banc verrouille les deux propriétés qui
 *   corrigent ça — le compte ignore la fenêtre, et l'inconnu n'est pas zéro.
 */

import { expect } from "chai";
import { facetDimensions } from "nodefony";
import type { Module, IAdminEndpoint, IAdminRequest } from "nodefony";
import {
  SESSION_FACETS,
  SESSION_FILTERS,
} from "../../src/session/storage/sessionFilters.js";
import { createHttpAdminApi } from "../../service/HttpAdminApi.js";
import SessionsService from "../../service/sessions/sessions-service.js";
import MemorySessionStorage from "../../src/session/storage/MemorySessionStorage.js";
import RevocationGuardStorage from "../../src/session/storage/RevocationGuardStorage.js";
import type {
  ISerializedSession,
  ISessionListQuery,
  ISessionStorage,
} from "../../interfaces/ISession.js";

const secret = Buffer.from("0123456789abcdef0123456789abcdef");

/** Service isolé de son constructeur lourd (kernel/certificats). */
function makeService(storage: ISessionStorage): SessionsService {
  const svc = Object.create(SessionsService.prototype) as Record<
    string,
    unknown
  >;
  svc.secret = secret;
  svc.storage = storage;
  svc.log = () => {};
  svc.get = () => null;
  return svc as unknown as SessionsService;
}

/** Session sérialisée — `user: ""` est la forme anonyme du store mémoire. */
const sess = (user = ""): ISerializedSession =>
  ({ Attributes: {}, metaBag: {}, flashBag: {}, user }) as ISerializedSession;

/** Store mémoire isolé de son manager (options de timeout seules). */
function makeStorage(): MemorySessionStorage {
  const manager = {
    options: { idleTimeoutS: 3600, absoluteTimeoutS: 0, store: "memory" },
    log: () => undefined,
  };
  return new MemorySessionStorage(
    manager as unknown as ConstructorParameters<typeof MemorySessionStorage>[0],
  );
}

/**
 * Parc de référence : 5 sessions, 3 authentifiées mais seulement **2**
 * utilisateurs distincts (alice en a deux — deux navigateurs).
 */
async function seed(): Promise<MemorySessionStorage> {
  const storage = makeStorage();
  await storage.write("s1", sess("alice"));
  await storage.write("s2", sess("alice"));
  await storage.write("s3", sess("bob"));
  await storage.write("s4", sess());
  await storage.write("s5", sess());
  return storage;
}

describe("MemorySessionStorage — countDistinctUsers", () => {
  it("compte les PERSONNES, pas les sessions", async () => {
    const storage = await seed();
    expect(await storage.countSessions()).to.equal(5);
    expect(await storage.countDistinctUsers()).to.equal(2); // alice ×2 = 1
  });

  it("les sessions anonymes ne forment pas un utilisateur", async () => {
    const storage = makeStorage();
    await storage.write("a", sess());
    await storage.write("b", sess());
    expect(await storage.countSessions()).to.equal(2);
    expect(await storage.countDistinctUsers()).to.equal(0);
  });

  it("honore le filtre reçu", async () => {
    const storage = await seed();
    expect(await storage.countDistinctUsers({ user: "alice" })).to.equal(1);
    expect(await storage.countDistinctUsers({ authenticated: false })).to.equal(
      0,
    );
  });
});

describe("SessionsService — countSessionFacets", () => {
  it("les compteurs portent sur TOUT le parc, jamais sur une page", async () => {
    const svc = makeService(await seed());
    const counts = await svc.countSessionFacets();
    expect(counts).to.deep.equal({
      total: 5,
      authenticated: 3,
      anonymous: 2,
      users: 2,
    });

    // La preuve : une page de 2 lignes ne change RIEN aux compteurs.
    const page = await svc.listSessionsPage({ limit: 2 });
    expect(page.items).to.have.length(2);
    expect((await svc.countSessionFacets()).total).to.equal(5);
  });

  it("le filtre s'applique aux compteurs, la fenêtre non", async () => {
    const svc = makeService(await seed());
    const counts = await svc.countSessionFacets({ user: "alice" });
    expect(counts.total).to.equal(2);
    expect(counts.authenticated).to.equal(2);
    expect(counts.anonymous).to.equal(0);
    expect(counts.users).to.equal(1);
  });

  it("anonymous n'est pas déduit — il est COMPTÉ", async () => {
    const svc = makeService(await seed());
    const { total, authenticated, anonymous } = await svc.countSessionFacets();
    expect(anonymous).to.equal(2);
    // La soustraction tombe juste ici, mais ce n'est pas ce qu'on calcule :
    // deux facettes peuvent se recouvrir sur d'autres ressources.
    expect(total! - authenticated!).to.equal(anonymous);
  });
});

describe("SessionsService — un backend qui ne sait pas compter", () => {
  /** Miroir d'un store en curseur (Redis) : énumère, mais ne compte pas. */
  const cursorLike: ISessionStorage = {
    read: () => Promise.resolve(null),
    write: () => Promise.resolve(),
    destroy: () => Promise.resolve(),
    gc: () => Promise.resolve(0),
    listPage: () =>
      Promise.resolve({
        items: [],
        limit: 10,
        hasNext: false,
        nextCursor: null,
      }),
    countSessions: () => Promise.resolve(-1),
    countDistinctUsers: () => Promise.resolve(-1),
  } as unknown as ISessionStorage;

  it("l'inconnu remonte en null — jamais en zéro", async () => {
    const svc = makeService(cursorLike);
    const counts = await svc.countSessionFacets();
    expect(counts).to.deep.equal({
      total: null,
      authenticated: null,
      anonymous: null,
      users: null,
    });
  });

  it("un store sans countDistinctUsers rend null, sans casser les autres", async () => {
    const partial = {
      ...cursorLike,
      countSessions: (q?: Partial<ISessionListQuery>) =>
        Promise.resolve(q?.authenticated === true ? 3 : 7),
      countDistinctUsers: undefined,
    } as unknown as ISessionStorage;
    const counts = await makeService(partial).countSessionFacets();
    expect(counts.total).to.equal(7);
    expect(counts.authenticated).to.equal(3);
    expect(counts.users).to.equal(null);
  });
});

describe("GET sessions/stats — le data plane", () => {
  /** Module minimal : seul `get("sessions")` est sollicité par le handler. */
  const moduleWith = (svc: unknown): Module =>
    ({
      get: (name: string) => (name === "sessions" ? svc : undefined),
    }) as unknown as Module;

  const req = (query: Record<string, string> = {}): IAdminRequest =>
    ({
      params: {},
      query,
      body: null,
      user: { username: "admin1" },
      roles: ["ROLE_NODEFONY_ADMIN"],
    }) as unknown as IAdminRequest;

  const endpointOf = (module: Module, path: string): IAdminEndpoint => {
    const found = createHttpAdminApi(module)
      .adminEndpoints()
      .find((e) => e.path === path);
    if (!found) throw new Error(`endpoint ${path} introuvable`);
    return found;
  };

  /** Service admin minimal, adossé au parc de référence. */
  async function adminService(): Promise<SessionsService> {
    const svc = makeService(await seed()) as unknown as Record<string, unknown>;
    svc.supportsEnumeration = () => true;
    return svc as unknown as SessionsService;
  }

  it("rend les compteurs du parc entier", async () => {
    const ep = endpointOf(moduleWith(await adminService()), "sessions/stats");
    expect(await ep.handler(req())).to.deep.equal({
      total: 5,
      authenticated: 3,
      anonymous: 2,
      users: 2,
    });
  });

  it("accepte les MÊMES filtres que sessions/list", async () => {
    const ep = endpointOf(moduleWith(await adminService()), "sessions/stats");
    const counts = (await ep.handler(req({ user: "alice" }))) as {
      total: number;
    };
    expect(counts.total).to.equal(2);
  });

  it("REFUSE un paramètre que personne ne lit", async () => {
    const ep = endpointOf(moduleWith(await adminService()), "sessions/stats");
    let thrown: unknown = null;
    try {
      await ep.handler(req({ usr: "alice" }));
    } catch (e) {
      thrown = e;
    }
    expect(thrown, "un filtre mal orthographié doit être refusé").to.not.equal(
      null,
    );
  });

  it("la fenêtre est admise et SANS effet — les compteurs ignorent limit", async () => {
    const ep = endpointOf(moduleWith(await adminService()), "sessions/stats");
    const counts = (await ep.handler(req({ limit: "2" }))) as { total: number };
    expect(counts.total).to.equal(5);
  });

  it("503 si le service de session est absent", async () => {
    const ep = endpointOf(moduleWith(undefined), "sessions/stats");
    expect(await ep.handler(req())).to.deep.include({ status: 503 });
  });

  it("501 si le backend ne sait pas s'énumérer — jamais des zéros trompeurs", async () => {
    const svc = makeService(await seed()) as unknown as Record<string, unknown>;
    svc.supportsEnumeration = () => false;
    const ep = endpointOf(moduleWith(svc), "sessions/stats");
    expect(await ep.handler(req())).to.deep.include({ status: 501 });
  });

  it("publie son vocabulaire de filtre — le même que la liste", async () => {
    const module = moduleWith(await adminService());
    expect(endpointOf(module, "sessions/stats").page?.filters).to.deep.equal(
      endpointOf(module, "sessions/list").page?.filters,
    );
  });
});

describe("RevocationGuardStorage — la capacité ne se perd pas dans le décorateur", () => {
  it("relaie countDistinctUsers du store décoré", async () => {
    const guarded = new RevocationGuardStorage(await seed());
    expect(typeof guarded.countDistinctUsers).to.equal("function");
    expect(await guarded.countDistinctUsers!()).to.equal(2);
  });

  it("ne l'invente pas quand le store décoré ne l'a pas", () => {
    const bare = {
      read: () => Promise.resolve(null),
      write: () => Promise.resolve(),
      destroy: () => Promise.resolve(),
      gc: () => Promise.resolve(0),
    } as unknown as ISessionStorage;
    expect(new RevocationGuardStorage(bare).countDistinctUsers).to.equal(
      undefined,
    );
  });
});

describe("aucune dimension de facette n'est filtrable sur les compteurs", () => {
  it("`authenticated` est décomposé en facettes, donc absent du vocabulaire", () => {
    // Filtrer la dimension que les cartes décomposent rendrait une réponse qui
    // se contredit : le total suivrait le filtre, chaque facette l'écraserait
    // par le sien (« 5 sessions au total, dont 40 anonymes »). Ici le trou ne
    // peut pas s'ouvrir — `SESSION_FILTERS` ne porte que `user`.
    expect(facetDimensions(SESSION_FACETS)).to.deep.equal(["authenticated"]);
    for (const dim of facetDimensions(SESSION_FACETS)) {
      expect(Object.hasOwn(SESSION_FILTERS, dim), dim).to.equal(false);
    }
    expect(Object.hasOwn(SESSION_FILTERS, "user")).to.equal(true);
  });
});
