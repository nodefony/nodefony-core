/**
 * La recherche du portail et celle du site public sont la MÊME fonction.
 *
 * Le site n'a pas de serveur : son générateur sérialise `searchDocs`
 * (`searchDocs.toString()`) et l'injecte dans chaque page, où elle s'exécute
 * dans le navigateur du lecteur. Cette astuce ne tient qu'à une condition — la
 * fonction ne doit RIEN référencer hors de son propre corps. Un import, une
 * constante de module, une aide déclarée à côté : le site continue de se
 * construire, la page se charge sans erreur visible au build, et la recherche
 * meurt chez le lecteur avec un « ... is not defined ».
 *
 * D'où ce banc : il n'exerce pas la fonction importée, il exerce la fonction
 * RECONSTRUITE depuis son texte, comme le navigateur le fait. C'est le seul
 * moyen que la contrainte se fasse entendre au moment où on l'enfreint.
 */
import { describe, it, expect } from "vitest";
import {
  searchDocs,
  extractSearchText,
  splitSearchTerms,
  ROOT_GROUPS,
  ROOT_PAGES,
  type SearchableDoc,
} from "../../../index";

/**
 * La fonction telle que le navigateur la reçoit : reconstruite depuis son texte.
 *
 * `new Function` est interdit par le linter, et c'est une bonne règle — sauf ici,
 * où c'est précisément le geste à reproduire : le site public n'a pas d'autre
 * moyen d'exécuter la fonction du module, et un banc qui ne le referait pas ne
 * prouverait rien de ce qu'il prétend prouver.
 */
// eslint-disable-next-line no-new-func
const serialisee = new Function(
  `return (${searchDocs.toString()});`,
)() as typeof searchDocs;

const corpus: SearchableDoc[] = [
  {
    slug: "http~session",
    title: "Sessions — l'état serveur",
    navTitle: "Sessions",
    sectionLabel: "@nodefony/http",
    body: [
      "# Sessions — l'état serveur",
      "",
      "## Le modèle mental",
      "",
      "Une session recolle les requêtes d'un même visiteur, côté serveur.",
      "",
      "## Stockage Redis",
      "",
      "Le magasin Redis partage la session entre plusieurs exemplaires.",
    ].join("\n"),
  },
  {
    slug: "redis~configuration",
    title: "Configuration Redis",
    navTitle: "Configuration",
    sectionLabel: "@nodefony/redis",
    body: "Déclarer l'accès Redis, une seule question à trancher pour commencer.",
  },
  {
    slug: "guides~routage",
    title: "Routage",
    navTitle: "Routage",
    sectionLabel: "Guides",
    body: "Rien à voir avec le sujet cherché ici, mais une page bien réelle.",
  },
];

describe("searchDocs — le classement", () => {
  it("ne retient que les pages portant TOUS les termes", () => {
    const r = searchDocs(corpus, "session redis");
    expect(r.hits.map((h) => h.slug)).toEqual(["http~session"]);
    expect(r.scanned).toBe(3);
    expect(r.matched).toBe(1);
  });

  it("place devant la page dont le TITRE porte le terme", () => {
    const r = searchDocs(corpus, "redis");
    expect(r.hits[0]?.slug).toBe("redis~configuration");
    // Le titre pèse 100, une occurrence de corps 1 : l'écart doit rester net.
    expect(r.hits[0]!.score).toBeGreaterThan(r.hits[1]!.score);
  });

  it("ignore les accents et la casse", () => {
    const r = searchDocs(
      [{ ...corpus[0]!, body: "La sécurité du dépôt, vue de près." }],
      "SECURITE",
    );
    expect(r.matched).toBe(1);
  });

  it("écarte un terme d'un seul caractère plutôt que de tout rendre", () => {
    expect(splitSearchTerms("a redis")).toEqual(["redis"]);
    expect(searchDocs(corpus, "a").hits).toHaveLength(0);
  });

  it("situe l'extrait sous son titre de section, et n'y remet pas le titre H1", () => {
    const r = searchDocs(corpus, "session");
    const ex = r.hits[0]!.excerpts;
    expect(ex.length).toBeGreaterThan(0);
    // Le titre de niveau 1 est déjà affiché au-dessus du résultat.
    expect(ex.some((e) => e.text.startsWith("Sessions —"))).toBe(false);
    expect(ex[0]?.section).toBe("Le modèle mental");
  });

  it("borne le nombre de pages rendues sans mentir sur le total", () => {
    const gros: SearchableDoc[] = Array.from({ length: 30 }, (_, i) => ({
      slug: `p${i}`,
      title: `Page ${i}`,
      navTitle: `Page ${i}`,
      sectionLabel: "Guides",
      body: "le mot cherche apparaît ici",
    }));
    const r = searchDocs(gros, "cherche", 5);
    expect(r.hits).toHaveLength(5);
    expect(r.matched).toBe(30);
  });
});

describe("searchDocs — parité portail ↔ site public", () => {
  it("s'exécute à l'identique une fois SÉRIALISÉE (ce que fait le site)", () => {
    for (const q of ["session redis", "redis", "routage", "introuvable"]) {
      expect(serialisee(corpus, q)).toEqual(searchDocs(corpus, q));
    }
  });

  it("ne capture RIEN de son module — sinon le site casse chez le lecteur", () => {
    const texte = searchDocs.toString();
    // Une aide du module appelée depuis le corps ne voyagerait pas avec lui.
    expect(texte).not.toMatch(/\bfoldText\s*\(/);
    expect(texte).not.toMatch(/\bextractSearchText\s*\(/);
    expect(texte).not.toMatch(/\bsplitSearchTerms\s*\(/);
    expect(texte).not.toMatch(/\brequire\s*\(|\bimport\s*\(/);
  });
});

describe("extractSearchText — ce qui entre dans l'index", () => {
  it("retire le code, les images et le fil d'Ariane, garde la prose", () => {
    const sorti = extractSearchText(
      [
        "📍 [Documentation](../index.md) › Sessions",
        "![capture](img.png)",
        "Une phrase qui compte.",
        "```ts",
        "const compteurQuiNeDoitPasRemonter = 1;",
        "```",
        "| Colonne | Autre |",
        "| ------- | ----- |",
        "| valeur  | ici   |",
      ].join("\n"),
    );
    expect(sorti).toContain("Une phrase qui compte.");
    expect(sorti).not.toContain("compteurQuiNeDoitPasRemonter");
    expect(sorti).not.toContain("📍");
    expect(sorti).not.toContain("![capture]");
    // La rangée de séparation ne porte aucun mot ; les valeurs, si.
    expect(sorti).not.toMatch(/\|\s*-+\s*\|/);
    expect(sorti).toContain("valeur");
  });
});

describe("le périmètre publié — une seule définition", () => {
  it("est exporté par le module, pour que le site l'importe au lieu de le copier", () => {
    expect(ROOT_GROUPS.map((g) => g.group)).toEqual([
      "tutoriels",
      "guides",
      "architecture",
    ]);
    expect(ROOT_PAGES).toEqual(["index", "demarrer", "lexique"]);
  });
});
