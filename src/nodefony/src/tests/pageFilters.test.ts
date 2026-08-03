/*
 *   NODEFONY FRAMEWORK UNIT TEST
 *   parseFilters — LE lecteur de filtres d'un point d'entrée paginé
 */

import { expect } from "chai";
import { parseFilters } from "../runtime/pageFilters";
import type { IFilterSpec } from "../runtime/pageFilters";
import { PageQueryError, PAGE_QUERY_KEYS } from "../runtime/pageQuery";

/** Spec de référence : les trois natures + une énumération. */
const SPEC = {
  actor: "string",
  revoked: "boolean",
  since: "int",
  category: ["auth", "authz", "token"],
} as const satisfies IFilterSpec;

describe("parseFilters — natures", () => {
  it("chaîne rendue telle quelle", () => {
    expect(parseFilters({ actor: "alice" }, SPEC)).to.deep.equal({
      actor: "alice",
    });
  });

  it("booléen : true/false → vrai booléen, jamais une chaîne", () => {
    expect(parseFilters({ revoked: "true" }, SPEC).revoked).to.equal(true);
    expect(parseFilters({ revoked: "false" }, SPEC).revoked).to.equal(false);
  });

  it("entier rendu en nombre", () => {
    expect(parseFilters({ since: "1750000000000" }, SPEC).since).to.equal(
      1750000000000,
    );
    expect(parseFilters({ since: "-3" }, SPEC).since).to.equal(-3);
  });

  it("énumération : une valeur de la liste passe", () => {
    expect(parseFilters({ category: "authz" }, SPEC).category).to.equal(
      "authz",
    );
  });

  it("absent ou vide → filtre NON posé (pas de undefined dans la sortie)", () => {
    const out = parseFilters({ actor: "", revoked: undefined }, SPEC);
    expect(out).to.deep.equal({});
    expect(Object.hasOwn(out, "actor")).to.equal(false);
  });

  it("tableau d'UNE valeur → lu normalement (le transport, pas l'intention)", () => {
    expect(parseFilters({ actor: ["a"] }, SPEC).actor).to.equal("a");
  });
});

describe("parseFilters — REFUSE au lieu d'accepter puis jeter", () => {
  it("booléen mal formé → 400, jamais un filtre absent", () => {
    // Le cœur du chantier : `?revoked=oui` posait le filtre à `undefined`, donc
    // la page rendait TOUT — et le client lisait ça comme « aucune clé révoquée ».
    expect(() => parseFilters({ revoked: "oui" }, SPEC)).to.throw(
      PageQueryError,
      /expected true or false/,
    );
  });

  it("clé répétée → 400 : une page filtrée sur `a` ne répond pas à « a ou b »", () => {
    // Le polymorphisme du transport (`string | string[]`) autorise la répétition ;
    // aucune nature de filtre n'exprime l'appartenance à un ensemble. Prendre la
    // première valeur rendait donc une page que le client lit comme le résultat
    // de SES deux valeurs.
    expect(() => parseFilters({ actor: ["a", "b"] }, SPEC)).to.throw(
      PageQueryError,
      /2 values/,
    );
  });

  it("entier mal formé → 400", () => {
    expect(() => parseFilters({ since: "hier" }, SPEC)).to.throw(
      PageQueryError,
    );
  });

  it("entier à MOITIÉ numérique → 400 (parseInt en rendrait 12)", () => {
    expect(() => parseFilters({ since: "12abc" }, SPEC)).to.throw(
      PageQueryError,
      /expected an integer/,
    );
  });

  it("valeur hors énumération → 400 qui NOMME les valeurs acceptées", () => {
    expect(() => parseFilters({ category: "zzz" }, SPEC)).to.throw(
      PageQueryError,
      /auth, authz, token/,
    );
  });

  it("paramètre reconnu par PERSONNE → 400 (la faute de frappe rendait tout)", () => {
    expect(() => parseFilters({ revokd: "true" }, SPEC)).to.throw(
      PageQueryError,
      /Unknown parameter "revokd"/,
    );
  });

  it("le refus de l'inconnu NOMME les filtres acceptés", () => {
    expect(() => parseFilters({ nope: "1" }, SPEC)).to.throw(
      /actor, revoked, since, category/,
    );
  });

  it("spec vide : tout filtre est inconnu, et le message le dit", () => {
    expect(() => parseFilters({ actor: "alice" }, {})).to.throw(
      /has no filters/,
    );
    expect(parseFilters({ limit: "10" }, {})).to.deep.equal({});
  });

  it("le code du refus est 400 (traduit en statut par le data plane)", () => {
    try {
      parseFilters({ revoked: "oui" }, SPEC);
      expect.fail("aurait dû refuser");
    } catch (e) {
      expect((e as PageQueryError).code).to.equal(400);
    }
  });
});

describe("parseFilters — cohabite avec le contrat de page", () => {
  it("les clés de pagination traversent sans être prises pour des filtres", () => {
    const source = {
      limit: "20",
      offset: "40",
      cursor: "abc",
      order: "actor:ASC",
      withTotal: "false",
      q: "jean",
      tenantId: "t1",
      actor: "alice",
    };
    expect(parseFilters(source, SPEC)).to.deep.equal({ actor: "alice" });
  });

  it("TOUTE clé du contrat est admise — l'ensemble fait foi, pas une copie", () => {
    // Si le contrat gagne une clé, ce test la couvre sans être réécrit : c'est
    // ce qui empêche `parseFilters` de refuser demain un paramètre légitime.
    for (const key of PAGE_QUERY_KEYS) {
      expect(() => parseFilters({ [key]: "x" }, SPEC)).to.not.throw();
    }
  });

  it("le TYPE découle de la spec — pas de cast chez l'appelant", () => {
    // Ce test ne vaut qu'à la COMPILATION : il échoue au typecheck, pas ici.
    // Sans lui, un `parseFilters` qui rendrait `any` laisserait le typecheck
    // vert et l'appelant sans filet — c'est exactement ce que ces annotations
    // interdisent. `category` doit rendre l'UNION des valeurs de l'énumération,
    // ce qui est ce qui supprime les `as AuditCategory` des data planes.
    const out = parseFilters({ category: "auth", revoked: "true" }, SPEC);
    const actor: string | undefined = out.actor;
    const revoked: boolean | undefined = out.revoked;
    const since: number | undefined = out.since;
    const category: "auth" | "authz" | "token" | undefined = out.category;
    expect([actor, since]).to.deep.equal([undefined, undefined]);
    expect(revoked).to.equal(true);
    expect(category).to.equal("auth");
  });

  it("`accepts` laisse passer ce que l'appelant lit lui-même (projection)", () => {
    // Sans cette liste, un endpoint qui expose `?include=author` devrait
    // renoncer au refus de l'inconnu pour ne pas refuser sa propre projection.
    expect(() =>
      parseFilters({ include: "author", actor: "alice" }, SPEC, {
        accepts: ["include"],
      }),
    ).to.not.throw();
  });

  it("`accepts` ne rend PAS la clé — elle reste à l'appelant", () => {
    const out = parseFilters({ include: "author" }, SPEC, {
      accepts: ["include"],
    });
    expect(out).to.deep.equal({});
  });

  it("une clé HORS `accepts` est toujours refusée", () => {
    expect(() =>
      parseFilters({ format: "csv" }, SPEC, { accepts: ["include"] }),
    ).to.throw(/Unknown parameter "format"/);
  });

  it("les filtres lus sont des CRITÈRES de store, sans cast", () => {
    // Ce test ne vaut qu'à la COMPILATION, et il couvre le code que le devkit
    // GÉNÈRE : `criteria: parseFilters(query, FILTERS)`. Si la sortie perdait sa
    // signature d'index implicite (une interface à la place du mapped type),
    // toute application générée cesserait de compiler — et aucune assertion de
    // chaîne dans un fichier rendu ne le verrait.
    const criteria: Record<string, unknown> = parseFilters(
      { revoked: "true" },
      SPEC,
    );
    expect(criteria.revoked).to.equal(true);
  });

  it("la spec est une DONNÉE : la parcourir suffit à connaître l'endpoint", () => {
    // Publiable telle quelle (endpoint de capacités, front) — ce qui serait
    // impossible si elle portait des fonctions de lecture.
    expect(JSON.parse(JSON.stringify(SPEC))).to.deep.equal({
      actor: "string",
      revoked: "boolean",
      since: "int",
      category: ["auth", "authz", "token"],
    });
  });
});

describe("parseFilters — la nature MULTI-valeurs (`{ each }`)", () => {
  const MULTI = {
    severity: { each: ["ERROR", "WARNING", "INFO"] },
    tag: { each: "string" },
    level: { each: "int" },
    module: "string",
  } as const satisfies IFilterSpec;

  it("lit TOUTES les valeurs d'une clé répétée", () => {
    const out = parseFilters({ severity: ["ERROR", "WARNING"] }, MULTI);
    expect(out.severity).to.deep.equal(["ERROR", "WARNING"]);
  });

  it("accepte une valeur unique — même forme rendue (un tableau)", () => {
    const out = parseFilters({ severity: "ERROR" }, MULTI);
    expect(out.severity).to.deep.equal(["ERROR"]);
  });

  it("refuse dès qu'UNE valeur sort de l'énumération", () => {
    // C'était le défaut vécu : les valeurs invalides étaient FILTRÉES en
    // silence, si bien que `?flow=nimporte` rendait le journal entier.
    expect(() => parseFilters({ severity: ["ERROR", "ZZZ"] }, MULTI)).to.throw(
      /Invalid value "ZZZ" for "severity"/,
    );
  });

  it("applique la nature à CHAQUE valeur (`int`)", () => {
    expect(parseFilters({ level: ["3", "7"] }, MULTI).level).to.deep.equal([
      3, 7,
    ]);
    expect(() => parseFilters({ level: ["3", "sept"] }, MULTI)).to.throw(
      /expected an integer/,
    );
  });

  it("ignore les valeurs VIDES, et ne pose pas la clé si tout est vide", () => {
    expect(parseFilters({ tag: ["a", ""] }, MULTI).tag).to.deep.equal(["a"]);
    expect(parseFilters({ tag: ["", ""] }, MULTI)).to.deep.equal({});
  });

  it("une clé NON multi refuse toujours la répétition", () => {
    // Le défaut du contrat reste « une valeur par paramètre » : le multi
    // s'AUTORISE dans la spec, il ne s'attrape pas au hasard de la query.
    expect(() => parseFilters({ module: ["a", "b"] }, MULTI)).to.throw(
      /reads a single value per parameter/,
    );
  });

  it("reste une DONNÉE sérialisable — publiable telle quelle", () => {
    expect(JSON.parse(JSON.stringify(MULTI))).to.deep.equal({
      severity: { each: ["ERROR", "WARNING", "INFO"] },
      tag: { each: "string" },
      level: { each: "int" },
      module: "string",
    });
  });
});
