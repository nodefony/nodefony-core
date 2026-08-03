/**
 * Unit — le traducteur de page du UI kit
 * (`frontend/src/components/ui/pageQuery.ts`).
 *
 * C'est le SEUL endroit du front qui écrit une query string de pagination : ce
 * qu'il émet doit être exactement ce que le cœur sait lire (`parsePageQuery` +
 * `parseFilters`), sans clé inventée. Logique pure → déterministe, aucun DOM.
 */
import { describe, it } from "vitest";
import { expect } from "chai";
import {
  toPageParams,
  withoutColumnFilters,
  fromPage,
} from "../../../frontend/src/components/ui/pageQuery";
import type {
  DataGridColumnFilter,
  DataGridServerQuery,
} from "../../../frontend/src/components/ui/DataGrid";
import { PAGE_QUERY_KEYS } from "nodefony";

/** Requête de grid par défaut — page 1, aucun tri, aucun filtre. */
const query = (
  over: Partial<DataGridServerQuery> = {},
): DataGridServerQuery => ({
  page: 1,
  pageSize: 25,
  sort: null,
  search: "",
  columnFilters: [],
  ...over,
});

/** Un filtre de colonne posé par la ligne inline du DataGrid. */
const filter = (
  key: string,
  value: string,
  op: DataGridColumnFilter["op"] = "equals",
): DataGridColumnFilter => ({ key, op, value });

describe("toPageParams — le contrat de page", () => {
  it("page/pageSize → fenêtre limit/offset", () => {
    expect(toPageParams(query({ page: 3, pageSize: 20 })).toString()).to.equal(
      "limit=20&offset=40",
    );
  });

  it("tri d'une colonne → couple order=champ:SENS", () => {
    const p = toPageParams(query({ sort: { key: "createdAt", dir: "desc" } }));
    expect(p.get("order")).to.equal("createdAt:DESC");
  });

  it("recherche → q, absente quand vide", () => {
    expect(toPageParams(query({ search: "alice" })).get("q")).to.equal("alice");
    expect(toPageParams(query()).has("q")).to.equal(false);
  });

  it("n'émet AUCUNE clé hors du contrat quand il n'y a pas de filtre", () => {
    // La garantie qui a manqué : un sac `filters` était posé d'office, donc tout
    // data plane recevait une clé que lui seul ne connaissait pas.
    for (const key of toPageParams(query({ search: "x" })).keys()) {
      expect(PAGE_QUERY_KEYS.has(key), `clé hors contrat : ${key}`).to.equal(
        true,
      );
    }
  });
});

describe("toPageParams — les filtres de colonne", () => {
  it("égalité → paramètre NOMMÉ, lisible par parseFilters", () => {
    const p = toPageParams(
      query({ columnFilters: [filter("enabled", "false")] }),
    );
    expect(p.get("enabled")).to.equal("false");
    expect(p.has("filters"), "le sac JSON ne doit plus exister").to.equal(
      false,
    );
  });

  it("la clé de colonne EST le nom du filtre (aucune traduction cachée)", () => {
    const p = toPageParams(
      query({ columnFilters: [filter("role", "ROLE_ADMIN")] }),
    );
    expect(p.get("role")).to.equal("ROLE_ADMIN");
  });

  it("plusieurs filtres → plusieurs paramètres nommés", () => {
    const p = toPageParams(
      query({
        columnFilters: [
          filter("enabled", "true"),
          filter("event", "user.created"),
        ],
      }),
    );
    expect(p.get("enabled")).to.equal("true");
    expect(p.get("event")).to.equal("user.created");
  });

  it("opérateur non transportable → REFUS, jamais une égalité déguisée", () => {
    // `?path=/api` lu comme une égalité rendrait une page vide, que l'utilisateur
    // lirait comme « aucune route ne commence par /api ».
    expect(() =>
      toPageParams(
        query({ columnFilters: [filter("path", "/api", "contains")] }),
      ),
    ).to.throw(/ne se transporte pas/);
  });

  it("chaque opérateur du grid hors égalité est refusé", () => {
    const ops: DataGridColumnFilter["op"][] = [
      "contains",
      "in",
      "startsWith",
      "endsWith",
      "isEmpty",
      "notEmpty",
      ">",
      "<",
    ];
    for (const op of ops) {
      expect(
        () => toPageParams(query({ columnFilters: [filter("x", "v", op)] })),
        `opérateur ${op}`,
      ).to.throw();
    }
  });
});

describe("withoutColumnFilters — le dialecte reste chez qui le parle", () => {
  it("vide les filtres et conserve le reste de la requête", () => {
    const q = query({
      page: 2,
      search: "x",
      columnFilters: [filter("path", "/api", "contains")],
    });
    const stripped = withoutColumnFilters(q);
    expect(stripped.columnFilters).to.deep.equal([]);
    expect(stripped.page).to.equal(2);
    expect(stripped.search).to.equal("x");
    // La requête d'origine n'est pas mutée (le grid la réutilise).
    expect(q.columnFilters).to.have.length(1);
  });

  it("laisse passer un opérateur que le contrat refuserait", () => {
    const q = query({ columnFilters: [filter("path", "/api", "contains")] });
    expect(() => toPageParams(withoutColumnFilters(q))).to.not.throw();
  });
});

describe("fromPage — total facultatif du contrat", () => {
  it("total présent → rendu tel quel", () => {
    const res = fromPage({
      items: [1, 2],
      limit: 25,
      offset: 0,
      total: 42,
      hasNext: true,
    });
    expect(res.total).to.equal(42);
  });

  it("sans total et sans suite → ce qui a été servi", () => {
    const res = fromPage({
      items: [1, 2],
      limit: 25,
      offset: 50,
      hasNext: false,
    });
    expect(res.total).to.equal(52);
  });

  it("sans total mais avec suite → une page de plus (barre navigable)", () => {
    const res = fromPage({
      items: [1, 2],
      limit: 25,
      offset: 50,
      hasNext: true,
    });
    expect(res.total).to.equal(77);
  });
});
