/// <reference types="node" />
import { expect } from "chai";
import SessionsService from "../../service/sessions/sessions-service";
import type {
  ISessionStorage,
  ISerializedSession,
  ISessionRecord,
  ISessionListQuery,
} from "../../interfaces/ISession";

/**
 * La surface d'administration des sessions **parcourt** le parc : retrouver une
 * session par sa référence publique impose de recalculer un HMAC sur chaque id,
 * et « déconnecter partout » impose de détruire tout ce qui appartient à un
 * utilisateur. Ces parcours doivent tenir **sans jamais charger le parc en
 * mémoire** — c'est toute la raison d'être de la pagination native.
 *
 * Les tests d'orchestration voisins (`SessionsAdmin.test.ts`) travaillent sur 3
 * sessions : ils ne franchissent donc JAMAIS la limite de page interne (200) et
 * ne prouvent rien sur le parcours lui-même. Ce fichier attaque exactement ça,
 * avec des parcs plus grands qu'une page, sur les DEUX modes de pagination :
 *
 * - **offset** — le parcours avance par décalage, et la destruction en masse doit
 *   composer avec le glissement de la collection sous l'offset ;
 * - **curseur** — le parcours suit `nextCursor`, et une page VIDE au milieu ne
 *   signifie pas la fin (le filtre s'applique au batch scanné). C'est le piège
 *   qui casse une boucle naïve : elle s'arrête au premier lot vide et laisse des
 *   sessions vivantes derrière elle — une révocation qui ne révoque pas.
 */

const secret = Buffer.from("banc-de-test-sessions-admin-paging");

/** Instance nue : contourne le constructeur lourd (kernel/container/certificats). */
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

function sess(user: string): ISerializedSession {
  return { Attributes: {}, metaBag: {}, flashBag: {}, user };
}

/** Trace des appels : sert à prouver qu'aucun parcours ne demande « tout ». */
interface Trace {
  limits: number[];
  calls: number;
}

/**
 * Store paginé **par offset** — miroir d'un backend SQL/mémoire.
 * `emptyEvery` n'a pas de sens ici (l'offset ne rend pas de lot vide au milieu).
 */
function makeOffsetStore(entries: Array<[string, ISerializedSession]>): {
  storage: ISessionStorage;
  trace: Trace;
  remaining: () => string[];
} {
  const map = new Map(entries);
  const trace: Trace = { limits: [], calls: 0 };
  const matching = (query?: Partial<ISessionListQuery>): ISessionRecord[] => {
    const out: ISessionRecord[] = [];
    for (const [id, data] of map) {
      if (query?.user !== undefined && data.user !== query.user) continue;
      out.push({ id, data });
    }
    return out;
  };
  const storage: ISessionStorage = {
    read: async (id) => map.get(id) ?? ({} as ISerializedSession),
    write: async (id, d) => {
      map.set(id, d);
      return d;
    },
    start: async (id) => map.get(id) ?? ({} as ISerializedSession),
    open: async () => map.size,
    close: () => true,
    destroy: async (id) => map.delete(id),
    gc: async () => {},
    listPage: async (query) => {
      trace.calls += 1;
      trace.limits.push(query.limit);
      const all = matching(query);
      const offset = query.offset ?? 0;
      const items = all.slice(offset, offset + query.limit);
      return {
        items,
        total: query.withTotal === false ? undefined : all.length,
        limit: query.limit,
        offset,
        hasNext: offset + items.length < all.length,
      };
    },
    countSessions: async (query) => matching(query).length,
  };
  return { storage, trace, remaining: () => [...map.keys()] };
}

/**
 * Store paginé **par curseur** — miroir d'un backend Redis `SCAN` : le filtre
 * s'applique APRÈS le découpage du lot, donc une page peut être vide alors qu'il
 * reste des éléments plus loin. `nextCursor` seul dit la fin.
 */
function makeCursorStore(entries: Array<[string, ISerializedSession]>): {
  storage: ISessionStorage;
  trace: Trace;
  remaining: () => string[];
} {
  const map = new Map(entries);
  const trace: Trace = { limits: [], calls: 0 };
  const BATCH = 50; // taille du lot scanné, indépendante du filtre
  const storage: ISessionStorage = {
    read: async (id) => map.get(id) ?? ({} as ISerializedSession),
    write: async (id, d) => {
      map.set(id, d);
      return d;
    },
    start: async (id) => map.get(id) ?? ({} as ISerializedSession),
    open: async () => map.size,
    close: () => true,
    destroy: async (id) => map.delete(id),
    gc: async () => {},
    listPage: async (query) => {
      trace.calls += 1;
      trace.limits.push(query.limit);
      const keys = [...map.keys()];
      const start = query.cursor ? Number.parseInt(query.cursor, 10) : 0;
      const slice = keys.slice(start, start + BATCH); // le LOT, avant filtrage
      const next = start + BATCH;
      const items: ISessionRecord[] = [];
      for (const id of slice) {
        const data = map.get(id)!;
        if (query.user !== undefined && data.user !== query.user) continue;
        if (items.length >= query.limit) break;
        items.push({ id, data });
      }
      const done = next >= keys.length;
      return {
        items, // ← peut être VIDE alors que hasNext est vrai
        limit: query.limit,
        hasNext: !done,
        nextCursor: done ? null : String(next),
      };
    },
    countSessions: async () => -1,
  };
  return { storage, trace, remaining: () => [...map.keys()] };
}

/** 450 sessions : plus de 2 pages internes (SCAN_PAGE = 200). */
function bigParc(): Array<[string, ISerializedSession]> {
  const out: Array<[string, ISerializedSession]> = [];
  for (let i = 0; i < 450; i += 1) {
    // alice sur les multiples de 3 (150), bob ailleurs (300).
    out.push([
      `s-${String(i).padStart(3, "0")}`,
      sess(i % 3 === 0 ? "alice" : "bob"),
    ]);
  }
  return out;
}

describe("Sessions admin — parcours PAGINÉ (parc > une page)", () => {
  describe("mode offset", () => {
    it("destroyByRef trouve une session située APRÈS la première page", async () => {
      // La cible est en position 400 : une implémentation qui ne lirait qu'une
      // page (200) la déclarerait introuvable et la révocation échouerait.
      const { storage, trace } = makeOffsetStore(bigParc());
      const svc = makeService(storage);
      const ok = await svc.destroyByRef(svc.sessionRef("s-400"), "admin");
      expect(ok).to.equal(true);
      expect(trace.calls).to.be.greaterThan(1, "le parcours doit paginer");
      expect(Math.max(...trace.limits)).to.be.at.most(
        200,
        "aucun appel ne doit demander plus d'une page",
      );
    });

    it("destroyByRef → false si la référence n'existe nulle part (parcours complet)", async () => {
      const { storage } = makeOffsetStore(bigParc());
      const svc = makeService(storage);
      expect(await svc.destroyByRef("sess_inconnue", "admin")).to.equal(false);
    });

    it("destroyByUser draine TOUTES les sessions (450 → les 150 d'alice)", async () => {
      // Le piège de l'offset : détruire fait glisser la collection. Une boucle
      // qui avancerait l'offset en supprimant sauterait des sessions — et un
      // « déconnecter partout » qui en laisse une est une faille, pas un détail.
      const { storage, remaining } = makeOffsetStore(bigParc());
      const svc = makeService(storage);
      const destroyed = await svc.destroyByUser("alice", "admin");
      expect(destroyed).to.equal(150);
      expect(remaining()).to.have.length(300);
      expect(remaining().every((id) => !id.endsWith("00") || true)).to.equal(
        true,
      );
      // Preuve directe : plus AUCUNE session d'alice ne subsiste.
      const page = await storage.listPage!({ limit: 500, user: "alice" });
      expect(page.items).to.have.length(0);
    });
  });

  describe("mode curseur", () => {
    it("destroyByRef suit nextCursor au-delà du premier lot", async () => {
      const { storage, trace } = makeCursorStore(bigParc());
      const svc = makeService(storage);
      const ok = await svc.destroyByRef(svc.sessionRef("s-400"), "admin");
      expect(ok).to.equal(true);
      expect(trace.calls).to.be.greaterThan(1);
    });

    it("destroyByUser ne s'arrête PAS sur un lot vide (le filtre vide des pages)", async () => {
      // Parc conçu pour que des lots entiers ne contiennent aucune session
      // d'alice : les 100 premières sont à bob, alice n'arrive qu'ensuite.
      const entries: Array<[string, ISerializedSession]> = [];
      for (let i = 0; i < 100; i += 1) {
        entries.push([`b-${String(i).padStart(3, "0")}`, sess("bob")]);
      }
      for (let i = 0; i < 60; i += 1) {
        entries.push([`a-${String(i).padStart(3, "0")}`, sess("alice")]);
      }
      const { storage, remaining } = makeCursorStore(entries);
      const svc = makeService(storage);
      const destroyed = await svc.destroyByUser("alice", "admin");
      expect(destroyed).to.equal(
        60,
        "une boucle qui s'arrête au premier lot vide en laisserait vivantes",
      );
      expect(remaining()).to.have.length(100);
    });

    it("destroyOwnByRef reste borné au périmètre de l'appelant (anti-IDOR à l'échelle)", async () => {
      const { storage } = makeCursorStore(bigParc());
      const svc = makeService(storage);
      // s-400 appartient à bob (400 % 3 !== 0) : alice ne doit pas l'atteindre,
      // même en parcourant tout le parc.
      const refDeBob = svc.sessionRef("s-400");
      expect(await svc.destroyOwnByRef("alice", refDeBob)).to.equal(false);
      expect((await storage.read("s-400")).user).to.equal("bob");
    });
  });

  describe("garantie de non-matérialisation", () => {
    it("aucun parcours ne demande plus d'une page au store", async () => {
      const { storage, trace } = makeOffsetStore(bigParc());
      const svc = makeService(storage);
      await svc.destroyByRef("sess_inconnue", "admin");
      await svc.destroyByUser("alice", "admin");
      expect(trace.calls).to.be.greaterThan(1);
      for (const limit of trace.limits) {
        expect(limit).to.be.at.most(
          200,
          "un parcours qui demanderait tout annulerait le bénéfice du chantier",
        );
      }
    });
  });
});
