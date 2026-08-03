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
  /** Critère reçu par le COUNT — il doit décrire la MÊME page que le FIND. */
  countCriteria: (Criteria<Row> | undefined)[];
}

/**
 * Repo mock qui HONORE `offset`/`limit`/`order` (comme un backend natif SQL/Mongo),
 * et espionne ce qui lui est demandé. paginate n'utilise que `find` + `count` (cf
 * sa signature) → cast honnête assumé : les autres méthodes de IRepository ne sont
 * jamais touchées ici, un accès accidentel jetterait plutôt que de renvoyer un NaN.
 */
function spyRepo(rows: Row[]): { repo: IRepository<Row>; calls: Calls } {
  const calls: Calls = {
    find: [],
    findCriteria: [],
    count: 0,
    countCriteria: [],
  };
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
      calls.countCriteria.push(criteria);
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

describe("paginate — la RECHERCHE `?q=` est une capacité déclarée", () => {
  it("un `q` sans champ cherchable est REFUSÉ, jamais ignoré", async () => {
    // Le défaut permissif rendait la collection ENTIÈRE à qui croyait lire un
    // résultat de recherche : `q` traversait le type sans être lu une fois.
    const { repo, calls } = spyRepo([
      { id: 1, name: "alpha" },
      { id: 2, name: "beta" },
    ]);
    await assert.rejects(
      () => paginate(repo, { limit: 10, q: "alp" }),
      (e: Error & { code?: number }) => e.code === 400,
    );
    // Et le refus tombe AVANT toute requête : rien n'est demandé au backend.
    assert.equal(calls.find.length, 0);
    assert.equal(calls.count, 0);
  });

  it("un `q` vide ne déclenche rien — personne n'a rien demandé", async () => {
    const { repo, calls } = spyRepo([{ id: 1, name: "alpha" }]);
    const page = await paginate(repo, { limit: 10, q: "   " });
    assert.equal(page.items.length, 1);
    assert.deepEqual(calls.findCriteria[0], undefined);
  });

  it("déclaré, `q` devient un LIKE ancré à gauche — et le TOTAL décrit la MÊME page", async () => {
    const { repo, calls } = spyRepo([{ id: 1, name: "alpha" }]);
    await paginate(repo, { limit: 10, q: "alp" }, { searchable: ["name"] });
    assert.deepEqual(calls.findCriteria[0], { name: { $like: "alp%" } });
    // Le critère du COUNT est le MÊME objet de critères que celui du FIND :
    // deux compositions divergentes rendraient un total qui ne décrit pas la page.
    assert.deepEqual(calls.countCriteria[0], calls.findCriteria[0]);
  });

  it("le terme est ÉCHAPPÉ — un `%` saisi se cherche lui-même", async () => {
    // Ce test verrouillait l'inverse, et le disait : le terme partait TEL QUEL
    // parce que la traduction de `$like` n'émettait aucune clause `ESCAPE`, si
    // bien qu'un terme échappé était cherché littéralement (antislash compris)
    // et ne rendait plus rien. La clause est désormais émise — les deux gestes
    // étaient indissociables, et c'est le second qui débloque celui-ci.
    const { repo, calls } = spyRepo([{ id: 1, name: "a_b" }]);
    await paginate(repo, { limit: 10, q: "100%_x" }, { searchable: ["name"] });
    assert.deepEqual(calls.findCriteria[0], {
      name: { $like: "100\\%\\_x%" },
    });
  });

  it("plusieurs champs cherchables deviennent un `$or`", async () => {
    const { repo, calls } = spyRepo([{ id: 1, name: "alpha" }]);
    await paginate(
      repo,
      { limit: 10, q: "al" },
      { searchable: ["name", "id"] },
    );
    assert.deepEqual(calls.findCriteria[0], {
      $or: [{ name: { $like: "al%" } }, { id: { $like: "al%" } }],
    });
  });

  it("les filtres déjà posés sont CONSERVÉS, pas écrasés par la recherche", async () => {
    const { repo, calls } = spyRepo([{ id: 1, name: "alpha" }]);
    await paginate(
      repo,
      { limit: 10, q: "al", criteria: { id: 1 } as Criteria<Row> },
      { searchable: ["name"] },
    );
    assert.deepEqual(calls.findCriteria[0], {
      id: 1,
      name: { $like: "al%" },
    });
  });

  it("un critère qui porte DÉJÀ un `$or` fait REFUSER la recherche", async () => {
    // La grammaire n'a pas de `$and` : deux `$or` au même niveau ne peuvent pas
    // exprimer « (a ou b) ET (s1 ou s2) ». Le second écraserait le premier et
    // rendrait des lignes que personne n'a demandées — refuser est la seule
    // issue honnête.
    const { repo } = spyRepo([{ id: 1, name: "alpha" }]);
    await assert.rejects(
      () =>
        paginate(
          repo,
          {
            limit: 10,
            q: "al",
            criteria: { $or: [{ id: 1 }, { id: 2 }] } as Criteria<Row>,
          },
          { searchable: ["name"] },
        ),
      (e: Error & { code?: number }) => e.code === 400,
    );
  });
});
