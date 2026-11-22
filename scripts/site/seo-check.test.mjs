import { describe, expect, it } from "vitest";
import { pageDefects, readSeoHead, siteDefects } from "./lib/seo-check.mjs";

/** Une page complète ; `drop` retire une ligne d'en-tête par son motif. */
function page({
  title = "T",
  description = "D",
  url = "https://x.test/a/",
  drop = [],
} = {}) {
  const lines = [
    `<title>${title}</title>`,
    `<meta name="description" content="${description}">`,
    `<link rel="canonical" href="${url}">`,
    `<meta property="og:type" content="article">`,
    `<meta property="og:site_name" content="Nodefony">`,
    `<meta property="og:title" content="${title}">`,
    `<meta property="og:description" content="${description}">`,
    `<meta property="og:url" content="${url}">`,
    `<meta name="twitter:card" content="summary">`,
    `<script type="application/ld+json">{"@context":"https://schema.org","@type":"TechArticle","headline":"${title}"}</script>`,
  ].filter((l) => !drop.some((d) => l.includes(d)));
  return `<!doctype html><html><head>${lines.join("\n")}</head><body><title>svg</title></body></html>`;
}

describe("readSeoHead / pageDefects — une page", () => {
  it("une page complète n'a aucun défaut", () => {
    expect(pageDefects(readSeoHead(page()))).toEqual([]);
  });

  it("nomme chaque pièce absente", () => {
    for (const [drop, defect] of [
      ["<title>", "sans <title>"],
      ['name="description"', "sans meta description"],
      ["canonical", "sans adresse canonique"],
      ["og:title", "sans og:title"],
      ["og:url", "sans og:url"],
      ["twitter:card", "sans twitter:card"],
      ["ld+json", "sans données structurées (ld+json)"],
    ])
      expect(pageDefects(readSeoHead(page({ drop: [drop] })))).toContain(
        defect,
      );
  });

  it("ne lit que l'en-tête : un <title> de SVG dans le corps ne compte pas", () => {
    expect(readSeoHead(page({ drop: ["<title>"] })).title).toBe("");
  });

  it("refuse une canonique relative et un og:url qui la contredit", () => {
    const rel = page({ url: "/a/" });
    expect(pageDefects(readSeoHead(rel))).toContain(
      "adresse canonique non absolue : /a/",
    );
    const diverge = page().replace(
      'og:url" content="https://x.test/a/"',
      'og:url" content="https://x.test/b/"',
    );
    expect(pageDefects(readSeoHead(diverge)).join()).toMatch(
      /og:url .* ≠ canonique/,
    );
  });

  it("refuse des données structurées illisibles ou sans @type", () => {
    const bad = page().replace('{"@context"', "{oups");
    expect(pageDefects(readSeoHead(bad)).join()).toMatch(/ld\+json illisible/);
    const noType = page().replace('"@type":"TechArticle",', "");
    expect(pageDefects(readSeoHead(noType))).toContain(
      "ld+json : un nœud sans @type",
    );
  });
});

describe("siteDefects — un site", () => {
  it("refuse un titre ou une description partagés par deux pages", () => {
    const d = siteDefects([
      { path: "a/index.html", html: page({ url: "https://x.test/a/" }) },
      { path: "b/index.html", html: page({ url: "https://x.test/b/" }) },
    ]);
    expect(d.filter((x) => x.defect.startsWith("titre partagé"))).toHaveLength(
      2,
    );
    expect(
      d.filter((x) => x.defect.startsWith("description partagé")),
    ).toHaveLength(2);
  });

  it("une copie qui déclare la même canonique n'est pas un doublon", () => {
    const d = siteDefects([
      {
        path: "perf/1.0.0/index.html",
        html: page({ url: "https://x.test/perf/1.0.0/" }),
      },
      {
        path: "perf/latest/index.html",
        html: page({ url: "https://x.test/perf/1.0.0/" }),
      },
    ]);
    expect(d).toEqual([]);
  });

  it("des pages distinctes et complètes passent", () => {
    expect(
      siteDefects([
        {
          path: "a/index.html",
          html: page({
            title: "A",
            description: "Da",
            url: "https://x.test/a/",
          }),
        },
        {
          path: "b/index.html",
          html: page({
            title: "B",
            description: "Db",
            url: "https://x.test/b/",
          }),
        },
      ]),
    ).toEqual([]);
  });
});
