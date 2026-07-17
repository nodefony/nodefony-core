import assert from "node:assert/strict";
import { AbstractCrudService, paginate } from "../../index";
import type { Criteria, IRepository, RepositoryReadOptions } from "../../index";

interface Row {
  id: number;
  name: string;
}

/** Trace des appels observés sur le repo — prouve CE qui est demandé au backend. */
interface Calls {
  find: RepositoryReadOptions[];
  findCriteria: (Criteria<Row> | undefined)[];
  count: number;
}

/**
 * Repo mock qui HONORE `offset`/`limit`/`order` (comme un backend natif SQL/Mongo),
 * et espionne ce qui lui est demandé. paginate n'utilise que `find` + `count` (cf
 * sa signature) → cast honnête assumé : les autres méthodes de IRepository ne sont
 * jamais touchées ici, un accès accidentel jetterait plutôt que de renvoyer un NaN.
 */
function spyRepo(rows: Row[]): { repo: IRepository<Row>; calls: Calls } {
  const calls: Calls = { find: [], findCriteria: [], count: 0 };
  const filter = (c?: Criteria<Row>) =>
    !c
      ? rows
      : rows.filter((r) =>
          Object.entries(c).every(
            ([k, v]) => (r as unknown as Record<string, unknown>)[k] === v,
          ),
        );
  const repo = {
    find(criteria?: Criteria<Row>, o?: RepositoryReadOptions) {
      calls.find.push(o ?? {});
      calls.findCriteria.push(criteria);
      let out = filter(criteria);
      if (o?.order?.length) {
        const [field, dir] = o.order[0];
        out = [...out].sort((a, b) => {
          const av = (a as unknown as Record<string, number>)[field];
          const bv = (b as unknown as Record<string, number>)[field];
          return (av < bv ? -1 : av > bv ? 1 : 0) * (dir === "DESC" ? -1 : 1);
        });
      }
      const start = o?.offset ?? 0;
      const end = o?.limit !== undefined ? start + o.limit : undefined;
      return Promise.resolve(out.slice(start, end));
    },
    count(criteria?: Criteria<Row>) {
      calls.count += 1;
      return Promise.resolve(filter(criteria).length);
    },
  } as unknown as IRepository<Row>;
  return { repo, calls };
}

const make = (n: number): Row[] =>
  Array.from({ length: n }, (_, i) => ({ id: i, name: `r${i}` }));

describe("paginate (contrat de page portable)", () => {
  it("page pleine : items=limit, hasNext=true, total exact", async () => {
    const { repo } = spyRepo(make(10));
    const page = await paginate(repo, { limit: 3, offset: 0 });
    assert.equal(page.items.length, 3);
    assert.deepEqual(
      page.items.map((r) => r.id),
      [0, 1, 2],
    );
    assert.equal(page.hasNext, true);
    assert.equal(page.total, 10);
    assert.equal(page.limit, 3);
    assert.equal(page.offset, 0);
  });

  it("NE CHARGE QUE limit+1 (jamais toute la collection) — le cœur du fix", async () => {
    const { repo, calls } = spyRepo(make(10_000));
    await paginate(repo, { limit: 20, offset: 0 });
    // Une seule lecture, plafonnée à limit+1 — pas 10 000 lignes matérialisées.
    assert.equal(calls.find.length, 1);
    assert.equal(calls.find[0].limit, 21);
  });

  it("dernière page : hasNext=false", async () => {
    const { repo } = spyRepo(make(10));
    const page = await paginate(repo, { limit: 3, offset: 9 });
    assert.deepEqual(
      page.items.map((r) => r.id),
      [9],
    );
    assert.equal(page.hasNext, false);
    assert.equal(page.total, 10);
  });

  it("frontière exacte (offset+limit == total) : hasNext=false, pas de fuite du +1", async () => {
    const { repo } = spyRepo(make(6));
    const page = await paginate(repo, { limit: 3, offset: 3 });
    assert.deepEqual(
      page.items.map((r) => r.id),
      [3, 4, 5],
    );
    assert.equal(page.items.length, 3); // le 7ᵉ (limit+1) n'existe pas → pas de débordement
    assert.equal(page.hasNext, false);
  });

  it("withTotal:false → total undefined ET count JAMAIS appelé (mode Slice)", async () => {
    const { repo, calls } = spyRepo(make(10));
    const page = await paginate(repo, { limit: 3, withTotal: false });
    assert.equal(page.total, undefined);
    assert.equal(page.hasNext, true); // dérivé du limit+1, sans compter
    assert.equal(calls.count, 0);
  });

  it("withTotal (défaut true) → count appelé une fois", async () => {
    const { repo, calls } = spyRepo(make(10));
    await paginate(repo, { limit: 3 });
    assert.equal(calls.count, 1);
  });

  it("normalise les bornes : limit<1 → 1, offset<0 → 0", async () => {
    const { repo, calls } = spyRepo(make(5));
    const page = await paginate(repo, { limit: 0, offset: -4 });
    assert.equal(page.limit, 1);
    assert.equal(page.offset, 0);
    assert.equal(calls.find[0].limit, 2); // 1 + 1
    assert.equal(calls.find[0].offset, 0);
  });

  it("transmet order et criteria au backend (pas de tri/filtre en mémoire après coup)", async () => {
    const { repo, calls } = spyRepo(make(10));
    const page = await paginate(repo, {
      limit: 2,
      order: [["id", "DESC"]],
      criteria: { name: "r7" } as Criteria<Row>,
    });
    assert.deepEqual(calls.find[0].order, [["id", "DESC"]]);
    assert.deepEqual(calls.findCriteria[0], { name: "r7" });
    // count est filtré par le même criteria (total de la collection FILTRÉE).
    assert.equal(page.total, 1);
  });

  it("collection vide : items=[], hasNext=false, total=0", async () => {
    const { repo } = spyRepo([]);
    const page = await paginate(repo, { limit: 10 });
    assert.deepEqual(page.items, []);
    assert.equal(page.hasNext, false);
    assert.equal(page.total, 0);
  });
});

describe("AbstractCrudService.findPage (délégation à paginate)", () => {
  class RowService extends AbstractCrudService<Row> {
    constructor(repo: IRepository<Row>) {
      super("rows", repo);
    }
  }

  it("délègue au repository et renvoie une Page", async () => {
    const { repo, calls } = spyRepo(make(10));
    const svc = new RowService(repo);
    const page = await svc.findPage({ limit: 4, offset: 4 });
    assert.deepEqual(
      page.items.map((r) => r.id),
      [4, 5, 6, 7],
    );
    assert.equal(page.hasNext, true);
    assert.equal(page.total, 10);
    assert.equal(calls.find[0].limit, 5); // limit+1 remonté jusqu'au repo
  });
});
