/*
 *   NODEFONY FRAMEWORK UNIT TEST
 *   countFacets — compter plusieurs facettes d'une collection, sans en dériver
 */

import { expect } from "chai";
import { countFacets, UNKNOWN_COUNT } from "../runtime/pageFacets";
import type { IFacetSpec } from "../runtime/pageFacets";

/** Contrat de liste fictif, réduit aux filtres qui nous intéressent. */
interface IThingQuery {
  limit: number;
  offset?: number;
  authenticated?: boolean;
  kind?: string;
}

const FACETS = {
  total: {},
  authenticated: { authenticated: true },
  anonymous: { authenticated: false },
} as const satisfies IFacetSpec<IThingQuery>;

describe("countFacets — une question par facette", () => {
  it("chaque facette est posée telle quelle au compteur", async () => {
    const asked: Array<Record<string, unknown>> = [];
    const counts = await countFacets(FACETS, (facet) => {
      asked.push(facet);
      return asked.length; // 1, 2, 3 dans l'ordre de déclaration
    });

    expect(asked).to.deep.equal([
      {},
      { authenticated: true },
      { authenticated: false },
    ]);
    expect(counts).to.deep.equal({ total: 1, authenticated: 2, anonymous: 3 });
  });

  it("aucune facette n'est DÉDUITE d'une autre", async () => {
    // Le compteur ment délibérément : anonymous n'est PAS total - authenticated.
    // Si `countFacets` dérivait, il rendrait 3 ; il doit rendre ce qu'on lui dit.
    const counts = await countFacets(FACETS, (facet) => {
      if (Object.keys(facet).length === 0) return 10;
      return (facet as { authenticated: boolean }).authenticated ? 7 : 99;
    });
    expect(counts.anonymous).to.equal(99);
  });

  it("accepte un compteur synchrone comme asynchrone", async () => {
    const sync = await countFacets(FACETS, () => 4);
    const async = await countFacets(FACETS, () => Promise.resolve(4));
    expect(sync).to.deep.equal(async);
  });
});

describe("countFacets — l'inconnu n'est pas zéro", () => {
  it("le -1 d'un backend qui ne sait pas compter devient null", async () => {
    const counts = await countFacets(FACETS, () => UNKNOWN_COUNT);
    expect(counts).to.deep.equal({
      total: null,
      authenticated: null,
      anonymous: null,
    });
  });

  it("zéro reste zéro — il n'est jamais confondu avec l'inconnu", async () => {
    const counts = await countFacets(FACETS, () => 0);
    expect(counts.total).to.equal(0);
    expect(counts.total).to.not.equal(null);
  });

  it("l'inconnu est PAR FACETTE, pas global", async () => {
    const counts = await countFacets(FACETS, (facet) =>
      Object.keys(facet).length === 0 ? 42 : UNKNOWN_COUNT,
    );
    expect(counts).to.deep.equal({
      total: 42,
      authenticated: null,
      anonymous: null,
    });
  });

  it("toute valeur non finie ou négative est un inconnu, pas un nombre", async () => {
    const counts = await countFacets(FACETS, () => Number.NaN);
    expect(counts.total).to.equal(null);
  });
});

describe("countFacets — table vide", () => {
  it("aucune facette déclarée → aucun compteur, et le store n'est pas sollicité", async () => {
    let calls = 0;
    const counts = await countFacets({}, () => {
      calls++;
      return 1;
    });
    expect(counts).to.deep.equal({});
    expect(calls).to.equal(0);
  });
});
