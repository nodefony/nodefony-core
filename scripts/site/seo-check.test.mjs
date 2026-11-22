import { describe, expect, it } from "vitest";
import {
  hreflangDefects,
  pageDefects,
  readSeoHead,
  siteDefects,
} from "./lib/seo-check.mjs";

/** Une description de longueur valide, distincte selon `x`. */
const desc = (x) =>
  `Description ${x} de la page, assez longue pour un moteur de recherche.`;

/** Une page complète ; `drop` retire une ligne d'en-tête par son motif. */
function page({
  title = "T",
  description = desc("D"),
  url = "https://x.test/a/",
  drop = [],
  lang = "fr",
  extraHead = "",
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
  return `<!doctype html><html lang="${lang}"><head>${lines.join("\n")}${extraHead}</head><body><title>svg</title></body></html>`;
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
            description: desc("a"),
            url: "https://x.test/a/",
          }),
        },
        {
          path: "b/index.html",
          html: page({
            title: "B",
            description: desc("b"),
            url: "https://x.test/b/",
          }),
        },
      ]),
    ).toEqual([]);
  });
});

describe("balises en double (faux verts)", () => {
  it.each([
    ["description", '<meta name="description" content="Autre">'],
    ["canonical", '<link rel="canonical" href="https://x.test/z/">'],
    ["og:url", '<meta property="og:url" content="https://x.test/z/">'],
    ["og:title", '<meta property="og:title" content="Autre">'],
  ])("refuse deux %s", (key, tag) => {
    expect(pageDefects(readSeoHead(page({ extraHead: tag })))).toContain(
      `balise en double : ${key}`,
    );
  });
});

describe("langue, description, JSON-LD", () => {
  it("exige <html lang> au format simple", () => {
    expect(pageDefects(readSeoHead(page({ lang: "" })))).toContain(
      "sans <html lang>",
    );
    expect(pageDefects(readSeoHead(page({ lang: "french" }))).join()).toMatch(
      /n'est pas un code de langue/,
    );
    expect(pageDefects(readSeoHead(page({ lang: "pt-BR" })))).toEqual([]);
  });

  it("borne la description à 50-160 caractères", () => {
    for (const d of ["Courte", "x".repeat(161)])
      expect(pageDefects(readSeoHead(page({ description: d }))).join()).toMatch(
        /meta description de \d+ caractères/,
      );
  });

  it("le url / mainEntityOfPage du JSON-LD égale la canonique", () => {
    const ld = (extra) => page().replace('"headline"', `${extra},"headline"`);
    expect(
      pageDefects(readSeoHead(ld('"url":"https://x.test/ailleurs/"'))).join(),
    ).toMatch(/ld\+json url .* ≠ canonique/);
    expect(
      pageDefects(
        readSeoHead(ld('"mainEntityOfPage":"https://x.test/ailleurs/"')),
      ).join(),
    ).toMatch(/mainEntityOfPage/);
    expect(pageDefects(readSeoHead(ld('"url":"https://x.test/a/"')))).toEqual(
      [],
    );
  });
});

describe("canonique crédible (siteUrl)", () => {
  const site = "https://x.test";
  const at = (path, url, extra = {}) => ({
    path,
    html: page({ title: path, description: desc(path), url, ...extra }),
  });

  it("une page qui se désigne elle-même passe, 404.html compris", () => {
    expect(
      siteDefects(
        [
          at("a/index.html", "https://x.test/a/"),
          at("404.html", "https://x.test/404.html"),
        ],
        { siteUrl: site },
      ),
    ).toEqual([]);
  });

  it("toutes les pages sur la même canonique ne masquent plus les doublons", () => {
    const d = siteDefects(
      [
        at("a/index.html", "https://x.test/"),
        at("b/index.html", "https://x.test/"),
      ],
      { siteUrl: site },
    );
    expect(d.map((x) => x.defect).join("\n")).toMatch(
      /vers une page absente|auto-canonique/,
    );
    expect(d.length).toBeGreaterThan(0);
  });

  it("une copie latest/ vers une page auto-canonique passe", () => {
    expect(
      siteDefects(
        [
          at("p/1.0.0/index.html", "https://x.test/p/1.0.0/"),
          at("p/latest/index.html", "https://x.test/p/1.0.0/"),
        ],
        { siteUrl: site },
      ),
    ).toEqual([]);
  });

  it("une canonique vers une page absente est un défaut", () => {
    const d = siteDefects([at("a/index.html", "https://x.test/zzz/")], {
      siteUrl: site,
    });
    expect(d[0].defect).toMatch(/absente du site/);
  });
});

describe("--noindex", () => {
  it("exige noindex sur chaque page quand l'option est posée", () => {
    const ok = page({ extraHead: '<meta name="robots" content="noindex">' });
    expect(
      siteDefects([{ path: "a/index.html", html: ok }], { noindex: true }),
    ).toEqual([]);
    const d = siteDefects([{ path: "a/index.html", html: page() }], {
      noindex: true,
    });
    expect(d[0].defect).toMatch(/noindex absente/);
    expect(siteDefects([{ path: "a/index.html", html: page() }])).toEqual([]);
  });
});

describe("hreflang — codes et cibles", () => {
  const mk = (path, canonical, langs, robots) => ({
    path,
    head: {
      canonical,
      robots: robots ?? null,
      hreflang: new Map(langs),
    },
  });
  it("refuse french et en_UK, accepte x-default", () => {
    const set = [
      ["french", "https://x.test/a/"],
      ["en_UK", "https://x.test/b/"],
      ["x-default", "https://x.test/a/"],
    ];
    const d = hreflangDefects([
      mk("a/index.html", "https://x.test/a/", set),
      mk("b/index.html", "https://x.test/b/", set),
    ]).map((x) => x.defect);
    expect(d.filter((x) => x.includes("n'est pas un code"))).toHaveLength(4);
    expect(d.join()).not.toContain("x-default »");
  });

  it("refuse une cible noindex", () => {
    const set = [
      ["fr", "https://x.test/a/"],
      ["en", "https://x.test/b/"],
    ];
    const d = hreflangDefects([
      mk("a/index.html", "https://x.test/a/", set),
      mk("b/index.html", "https://x.test/b/", set, "noindex"),
    ]).map((x) => x.defect);
    expect(d.join()).toMatch(/est noindex/);
  });
});
