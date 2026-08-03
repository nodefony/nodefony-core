/*
 *   NODEFONY FRAMEWORK UNIT TEST
 *   parsePageQuery — LE traducteur d'une requête de page (contrat IPageQuery)
 */

import { expect } from "chai";
import { parsePageQuery, PageQueryError } from "../runtime/pageQuery";

describe("parsePageQuery — bornes de limit", () => {
  it("absent → défaut 50", () => {
    expect(parsePageQuery({}).limit).to.equal(50);
  });

  it("defaultLimit de l'appelant respecté", () => {
    expect(parsePageQuery({}, { defaultLimit: 25 }).limit).to.equal(25);
  });

  it("un defaultLimit au-dessus du cap est ramené au cap", () => {
    expect(
      parsePageQuery({}, { defaultLimit: 500, maxLimit: 100 }).limit,
    ).to.equal(100);
  });

  it("au-delà du cap dur → ramené à maxLimit (jamais refusé)", () => {
    expect(parsePageQuery({ limit: "9999" }).limit).to.equal(200);
    expect(parsePageQuery({ limit: "9999" }, { maxLimit: 20 }).limit).to.equal(
      20,
    );
  });

  it("zéro ou négatif → plancher 1", () => {
    expect(parsePageQuery({ limit: "0" }).limit).to.equal(1);
    expect(parsePageQuery({ limit: "-5" }).limit).to.equal(1);
  });

  it("non numérique ou vide → défaut (jamais NaN)", () => {
    expect(parsePageQuery({ limit: "abc" }).limit).to.equal(50);
    expect(parsePageQuery({ limit: "" }).limit).to.equal(50);
    // La divergence exacte qui existait entre les copies : isNaN vs isFinite.
    expect(Number.isFinite(parsePageQuery({ limit: "abc" }).limit)).to.equal(
      true,
    );
  });

  it("clé répétée → 400, jamais la première valeur en silence", () => {
    // `?limit=10&limit=99` : le client a demandé deux fenêtres. En rendre une
    // sans le dire, c'est répondre à une question qui n'a pas été posée.
    expect(() => parsePageQuery({ limit: ["10", "99"] })).to.throw(
      PageQueryError,
      /2 values/,
    );
  });

  it("tableau d'UNE valeur → lu normalement (le transport, pas l'intention)", () => {
    expect(parsePageQuery({ limit: ["10"] }).limit).to.equal(10);
  });
});

describe("parsePageQuery — offset et cursor", () => {
  it("offset valide posé, absent sinon", () => {
    expect(parsePageQuery({ offset: "40" }).offset).to.equal(40);
    expect(parsePageQuery({}).offset).to.equal(undefined);
  });

  it("offset négatif ou invalide → absent (pas 0 implicite négatif)", () => {
    expect(parsePageQuery({ offset: "-1" }).offset).to.equal(undefined);
    expect(parsePageQuery({ offset: "x" }).offset).to.equal(undefined);
  });

  it("cursor non vide posé, vide ignoré", () => {
    expect(parsePageQuery({ cursor: "abc" }).cursor).to.equal("abc");
    expect(parsePageQuery({ cursor: "" }).cursor).to.equal(undefined);
  });

  it("n'arbitre PAS entre offset et cursor — c'est le rôle du store", () => {
    const q = parsePageQuery({ offset: "10", cursor: "abc" });
    expect(q.offset).to.equal(10);
    expect(q.cursor).to.equal("abc");
  });
});

describe("parsePageQuery — tri", () => {
  const sortable = ["name", "createdAt"] as const;

  it("champ:sens → couple du contrat", () => {
    expect(
      parsePageQuery({ order: "name:ASC" }, { sortable }).order,
    ).to.deep.equal([["name", "ASC"]]);
  });

  it("multi-champs, ordre significatif préservé", () => {
    expect(
      parsePageQuery({ order: "createdAt:DESC,name:ASC" }, { sortable }).order,
    ).to.deep.equal([
      ["createdAt", "DESC"],
      ["name", "ASC"],
    ]);
  });

  it("sens insensible à la casse, normalisé en majuscules", () => {
    expect(
      parsePageQuery({ order: "name:desc" }, { sortable }).order,
    ).to.deep.equal([["name", "DESC"]]);
  });

  it("sens omis → ASC", () => {
    expect(parsePageQuery({ order: "name" }, { sortable }).order).to.deep.equal(
      [["name", "ASC"]],
    );
  });

  it("champ hors allowlist → 400, jamais ignoré en silence", () => {
    expect(() =>
      parsePageQuery({ order: "password:ASC" }, { sortable }),
    ).to.throw(PageQueryError);
    try {
      parsePageQuery({ order: "password:ASC" }, { sortable });
      expect.fail("aurait dû lever");
    } catch (e) {
      expect((e as PageQueryError).code).to.equal(400);
      expect((e as Error).message).to.contain("password");
    }
  });

  it("sens inconnu → 400", () => {
    expect(() =>
      parsePageQuery({ order: "name:sideways" }, { sortable }),
    ).to.throw(PageQueryError);
  });

  it("endpoint SANS allowlist : un order reçu est refusé, pas avalé", () => {
    expect(() => parsePageQuery({ order: "name:ASC" })).to.throw(
      PageQueryError,
    );
    // …mais ne pas envoyer d'order sur un tel endpoint reste parfaitement valide.
    expect(parsePageQuery({}).order).to.equal(undefined);
  });

  it("order vide → absent (pas un tableau vide)", () => {
    expect(parsePageQuery({ order: "" }, { sortable }).order).to.equal(
      undefined,
    );
    expect(parsePageQuery({ order: " , " }, { sortable }).order).to.equal(
      undefined,
    );
  });
});

describe("parsePageQuery — withTotal et q", () => {
  it("seul `false` explicite désactive le total", () => {
    expect(parsePageQuery({ withTotal: "false" }).withTotal).to.equal(false);
    expect(parsePageQuery({ withTotal: "true" }).withTotal).to.equal(undefined);
    expect(parsePageQuery({ withTotal: "0" }).withTotal).to.equal(undefined);
    expect(parsePageQuery({}).withTotal).to.equal(undefined);
  });

  it("q trimé, vide ignoré — quand la recherche est déclarée", () => {
    const searchable = true;
    expect(parsePageQuery({ q: "  jean  " }, { searchable }).q).to.equal(
      "jean",
    );
    expect(parsePageQuery({ q: "   " }, { searchable }).q).to.equal(undefined);
    expect(parsePageQuery({}, { searchable }).q).to.equal(undefined);
  });

  it("REFUSE q quand le point d'entrée ne cherche pas", () => {
    // Symétrique du tri : sans capacité déclarée, la recherche est refusée et
    // non ignorée. Un `q` accepté puis jeté rend la collection ENTIÈRE, que le
    // client lit comme le résultat de sa recherche.
    expect(() => parsePageQuery({ q: "jean" })).to.throw(/does not support/);
    expect(() => parsePageQuery({ q: "jean" }, { searchable: false })).to.throw(
      /does not support/,
    );
  });

  it("un q VIDE ne déclenche pas le refus (rien n'a été demandé)", () => {
    // Une barre de recherche vidée par l'utilisateur envoie souvent `?q=` :
    // refuser là dessus transformerait un écran normal en erreur 400.
    expect(parsePageQuery({ q: "" }).q).to.equal(undefined);
    expect(parsePageQuery({ q: "   " }).q).to.equal(undefined);
  });
});

describe("parsePageQuery — pureté", () => {
  it("ne rend QUE les champs du contrat, jamais les filtres de l'appelant", () => {
    const q = parsePageQuery({ limit: "10", role: "admin", enabled: "true" });
    expect(Object.keys(q).sort()).to.deep.equal(["limit"]);
  });

  it("ne mute pas la source", () => {
    const source = { limit: "10", q: "  x  " };
    parsePageQuery(source, { searchable: true });
    expect(source).to.deep.equal({ limit: "10", q: "  x  " });
  });
});
