import { describe, expect, it } from "vitest";
import { stripLeadingTitle } from "./lib/markdown-source.mjs";
import { readSeoHead, siteDefects } from "./lib/seo-check.mjs";
import { ogLocale, seoHead, siteImage } from "./lib/seo-head.mjs";
import {
  pageLanguage,
  sourceFingerprint,
  staleTranslations,
  translationGroups,
  translationPath,
} from "./lib/translations.mjs";

const SITE = "https://x.test";
const fr = {
  repoRel: "docs/cbor.md",
  url: `${SITE}/docs/cbor/`,
  meta: { lang: "fr" },
};
// L'adresse d'une traduction suit la convention : `/<langue>` + celle de la source.
const en = (meta = {}) => ({
  repoRel: "docs/traductions/en/cbor.md",
  url: `${SITE}/en/docs/cbor/`,
  meta: { lang: "en", translationOf: "../../cbor.md", ...meta },
});

describe("translations — qui traduit quoi", () => {
  it("l'empreinte ignore le frontmatter et les blancs de fin de ligne", () => {
    const a = "---\nupdated: 2026-01-01\n---\n# T\n\nCorps.  \n";
    const b = "---\nupdated: 2027-05-05\n---\n# T\n\nCorps.\n";
    expect(sourceFingerprint(a)).toBe(sourceFingerprint(b));
    expect(sourceFingerprint(a)).not.toBe(sourceFingerprint("# T\n\nAutre.\n"));
  });

  it("groupe la source et sa traduction ; x-default = la version anglaise", () => {
    const groups = translationGroups([fr, en()], { siteUrl: SITE });
    const alt = groups.get(fr.url);
    expect(groups.get(en().url)).toEqual(alt);
    expect(alt).toEqual([
      { lang: "fr", url: fr.url, isDefault: false },
      { lang: "en", url: en().url, isDefault: true },
    ]);
  });

  it("sans version anglaise, x-default est la SOURCE", () => {
    const de = {
      repoRel: "docs/de/cbor.md",
      url: `${SITE}/de/docs/cbor/`,
      meta: { lang: "de", translationOf: "../cbor.md" },
    };
    const alt = translationGroups([fr, de]).get(fr.url);
    expect(alt.find((a) => a.isDefault)?.lang).toBe("fr");
  });

  it("une page sans traduction n'a aucun groupe", () => {
    expect(translationGroups([fr]).size).toBe(0);
  });

  it("refuse une source absente et deux versions de même langue", () => {
    expect(() => translationGroups([en()])).toThrow(/absente du site/);
    expect(() => translationGroups([fr, en({ lang: "fr" })])).toThrow(
      /deux versions/,
    );
  });

  it("refuse une traduction d'une traduction (fr ← en ← de)", () => {
    const de = {
      repoRel: "docs/traductions/de/cbor.md",
      url: `${SITE}/de/docs/cbor/`,
      meta: { lang: "de", translationOf: "../en/cbor.md" },
    };
    expect(() => translationGroups([fr, en(), de])).toThrow(
      /elle-même une traduction/,
    );
  });

  it("l'adresse d'une traduction est celle de sa source préfixée par la langue", () => {
    expect(translationPath("/docs/cbor/", "en")).toBe("/en/docs/cbor/");
    const ailleurs = { ...en(), url: `${SITE}/docs/traductions/en/cbor/` };
    expect(() => translationGroups([fr, ailleurs], { siteUrl: SITE })).toThrow(
      /attendu https:\/\/x\.test\/en\/docs\/cbor\//,
    );
  });

  it("refuse un code de langue hors BCP 47 simple", () => {
    expect(pageLanguage({})).toBe("fr");
    expect(pageLanguage({ lang: "fr-CA" })).toBe("fr-CA");
    for (const bad of ["french", "en_UK", "EN"])
      expect(() => pageLanguage({ lang: bad })).toThrow(/BCP 47/);
  });

  it("une traduction en retard sur sa source est refusée, avec l'empreinte attendue", () => {
    const source = "# T\n\nCorps.\n";
    const ok = en({ sourceHash: sourceFingerprint(source) });
    expect(staleTranslations([fr, ok], () => source)).toEqual([]);
    const late = staleTranslations([fr, ok], () => "# T\n\nCorps MODIFIÉ.\n");
    expect(late).toHaveLength(1);
    expect(late[0]).toContain(
      `sourceHash: ${sourceFingerprint("# T\n\nCorps MODIFIÉ.\n")}`,
    );
  });
});

describe("seoHead — multilingue et échappement", () => {
  const head = (url, alternates, extra = {}) =>
    seoHead({
      title: "T",
      description: "D",
      url,
      lang: url.includes("/en/") ? "en" : "fr",
      alternates,
      jsonLd: { "@type": "WebPage" },
      ...extra,
    });

  it("déduit la locale Open Graph d'une TABLE, et refuse une langue inconnue", () => {
    expect(ogLocale("fr")).toBe("fr_FR");
    expect(ogLocale("en")).toBe("en_US");
    expect(ogLocale("fr-CA")).toBe("fr_CA");
    expect(ogLocale("ja")).toBe("ja_JP");
    expect(ogLocale("zh-Hans")).toBe("zh_CN");
    expect(() => ogLocale("xx")).toThrow(/OG_LOCALES/);
  });

  it("émet hreflang pour chaque version, x-default et og:locale:alternate", () => {
    const alt = translationGroups([fr, en()]).get(fr.url);
    const h = head(fr.url, alt);
    expect(h).toContain(`hreflang="fr" href="${fr.url}"`);
    expect(h).toContain(`hreflang="en" href="${en().url}"`);
    expect(h).toContain(`hreflang="x-default" href="${en().url}"`);
    expect(h).toContain(`og:locale:alternate" content="en_US"`);
  });

  it("refuse une liste de versions qui omet la page elle-même", () => {
    expect(() => head(fr.url, [{ lang: "en", url: en().url }])).toThrow(
      /elle-même/,
    );
  });

  it("sans traduction, aucune balise hreflang ; noindex sur demande", () => {
    expect(head(fr.url, [])).not.toContain("hreflang");
    expect(head(fr.url, [])).not.toContain("noindex");
    expect(head(fr.url, [], { noindex: true })).toContain(
      '<meta name="robots" content="noindex">',
    );
  });

  it("échappe les attributs et ne laisse pas un titre fermer le bloc JSON-LD", () => {
    const h = seoHead({
      title: 'Un "titre" </script><script>alert(1)</script>',
      description: "a & b < c",
      url: fr.url,
      jsonLd: { "@type": "WebPage", name: "</script><b>" },
    });
    expect(h).toContain('content="Un &quot;titre&quot; &lt;/script&gt;');
    expect(h).toContain('content="a &amp; b &lt; c"');
    expect(h.match(/<\/script>/g)).toHaveLength(1); // la seule fermeture : celle du bloc
    // Découpé par position, sans motif de balise : le bloc est celui que seoHead
    // écrit, et un motif de balise ne serait jamais complet.
    const open = '<script type="application/ld+json">';
    const from = h.indexOf(open) + open.length;
    expect(JSON.parse(h.slice(from, h.indexOf("</script>", from))).name).toBe(
      "</script><b>",
    );
  });
});

describe("check-site-seo — réciprocité hreflang", () => {
  const page = (url, title, alternates) =>
    `<html lang="${url.includes("/en/") ? "en" : "fr"}"><head><title>${title}</title>${seoHead(
      {
        title,
        description: `Une description de page assez longue pour le contrôle : ${title}.`,
        url,
        lang: url.includes("/en/") ? "en" : "fr",
        alternates,
        jsonLd: { "@type": "WebPage", url },
        image: siteImage(SITE),
      },
    )}</head></html>`;
  const alt = translationGroups([fr, en()]).get(fr.url);
  const FR = "docs/cbor/index.html";
  const EN = "en/docs/cbor/index.html";

  it("une paire réciproque passe", () => {
    expect(
      siteDefects(
        [
          { path: FR, html: page(fr.url, "FR", alt) },
          { path: EN, html: page(en().url, "EN", alt) },
        ],
        { siteUrl: SITE },
      ),
    ).toEqual([]);
  });

  it("une version qui ne répond pas est signalée", () => {
    const d = siteDefects(
      [
        { path: FR, html: page(fr.url, "FR", alt) },
        { path: EN, html: page(en().url, "EN", []) },
      ],
      { siteUrl: SITE },
    );
    expect(d.map((x) => x.defect).join()).toMatch(/non réciproque/);
  });

  it("une version annoncée absente du site est signalée", () => {
    const d = siteDefects([{ path: FR, html: page(fr.url, "FR", alt) }], {
      siteUrl: SITE,
    });
    expect(d.map((x) => x.defect).join()).toMatch(/absente du site/);
    expect(readSeoHead(page(fr.url, "FR", alt)).hreflang.get("x-default")).toBe(
      en().url,
    );
  });
});

describe("stripLeadingTitle — le titre de tête, même après un fil d'Ariane", () => {
  it("retire le titre en première ligne", () => {
    expect(stripLeadingTitle("# T\n\nCorps.\n")).toBe("\nCorps.\n");
  });

  it("retire le titre précédé d'un fil d'Ariane (une page sortait avec deux h1)", () => {
    expect(stripLeadingTitle("📍 [Doc](x.md) › **T**\n\n# T\n\nCorps.\n")).toBe(
      "📍 [Doc](x.md) › **T**\n\n\nCorps.\n",
    );
  });

  it("ne touche pas un `#` après une section ni dans un bloc de code", () => {
    const apres = "Intro.\n\n## S\n\n# Pas le titre\n";
    expect(stripLeadingTitle(apres)).toBe(apres);
    const code = "```sh\n# commentaire\n```\n\n## S\n";
    expect(stripLeadingTitle(code)).toBe(code);
  });
});

describe("titre d'onglet et données structurées", () => {
  it("garde le titre entier s'il tient, sinon la partie avant le tiret, sinon une coupe au mot", async () => {
    const { tabTitle, TAB_TITLE_MAX } = await import("./lib/seo-head.mjs");
    expect(tabTitle("Codec CBOR")).toBe("Codec CBOR · Nodefony");
    expect(
      tabTitle(
        "Flux d'octets — servir la sortie d'un processus, un relais ou une archive à la volée",
      ),
    ).toBe("Flux d'octets · Nodefony");
    const long = tabTitle("mot ".repeat(40).trim());
    expect([...long].length).toBeLessThanOrEqual(TAB_TITLE_MAX);
    expect(long).toMatch(/ mot… · Nodefony$/);
  });

  it("rattache l'article au site et au logiciel par @id, fil d'Ariane réel", async () => {
    const { breadcrumbList, softwareNode, techArticle, websiteNode } =
      await import("./lib/seo-head.mjs");
    const a = techArticle({
      title: "T",
      description: "D",
      url: `${SITE}/docs/x/`,
      siteUrl: SITE,
      author: "Auteur",
    });
    expect(a.isPartOf).toEqual({ "@id": `${SITE}/#website` });
    expect(a.about).toEqual({ "@id": `${SITE}/#software` });
    expect(a.author).toEqual({ "@type": "Person", name: "Auteur" });
    expect(websiteNode(SITE)["@id"]).toBe(`${SITE}/#website`);
    expect(softwareNode({ siteUrl: SITE })["@id"]).toBe(`${SITE}/#software`);
    // Le nom seul : ni le courriel ni le site de la forme courte npm.
    expect(
      softwareNode({ siteUrl: SITE, author: "Ada L <ada@x.io> (https://x.io)" })
        .author,
    ).toEqual({ "@type": "Person", name: "Ada L" });
    expect(
      softwareNode({ siteUrl: SITE, author: { name: " Ada " } }).author.name,
    ).toBe("Ada");
    expect(
      softwareNode({ siteUrl: SITE, author: "<ada@x.io>" }).author,
    ).toBeUndefined();
    expect(breadcrumbList([{ name: "Seul", url: SITE }])).toBeNull();
    const b = breadcrumbList([
      { name: "Nodefony", url: `${SITE}/` },
      { name: "T", url: `${SITE}/docs/x/` },
    ]);
    expect(b.itemListElement.map((i) => i.position)).toEqual([1, 2]);
  });
});
