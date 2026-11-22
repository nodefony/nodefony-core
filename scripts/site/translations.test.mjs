import { describe, expect, it } from "vitest";
import { readSeoHead, siteDefects } from "./lib/seo-check.mjs";
import { ogLocale, seoHead } from "./lib/seo-head.mjs";
import {
  sourceFingerprint,
  staleTranslations,
  translationGroups,
} from "./lib/translations.mjs";

const SITE = "https://x.test";
const fr = {
  repoRel: "docs/cbor.md",
  url: `${SITE}/docs/cbor/`,
  meta: { lang: "fr" },
};
const en = (meta = {}) => ({
  repoRel: "docs/en/cbor.md",
  url: `${SITE}/docs/en/cbor/`,
  meta: { lang: "en", translationOf: "../cbor.md", ...meta },
});

describe("translations — qui traduit quoi", () => {
  it("l'empreinte ignore le frontmatter et les blancs de fin de ligne", () => {
    const a = "---\nupdated: 2026-01-01\n---\n# T\n\nCorps.  \n";
    const b = "---\nupdated: 2027-05-05\n---\n# T\n\nCorps.\n";
    expect(sourceFingerprint(a)).toBe(sourceFingerprint(b));
    expect(sourceFingerprint(a)).not.toBe(sourceFingerprint("# T\n\nAutre.\n"));
  });

  it("groupe la source et sa traduction ; x-default = la version anglaise", () => {
    const groups = translationGroups([fr, en()]);
    const alt = groups.get(fr.url);
    expect(groups.get(en().url)).toEqual(alt);
    expect(alt).toEqual([
      { lang: "fr", url: fr.url, isDefault: false },
      { lang: "en", url: en().url, isDefault: true },
    ]);
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

describe("seoHead — multilingue", () => {
  const head = (url, alternates) =>
    seoHead({
      title: "T",
      description: "D",
      url,
      lang: url.includes("/en/") ? "en" : "fr",
      alternates,
      jsonLd: { "@type": "WebPage" },
    });

  it("déduit la locale Open Graph de la langue", () => {
    expect(ogLocale("fr")).toBe("fr_FR");
    expect(ogLocale("en")).toBe("en_US");
    expect(ogLocale("fr-CA")).toBe("fr_CA");
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

  it("sans traduction, aucune balise hreflang", () => {
    expect(head(fr.url, [])).not.toContain("hreflang");
  });
});

describe("check-site-seo — réciprocité hreflang", () => {
  const page = (url, title, alternates) =>
    `<html><head><title>${title}</title>${seoHead({
      title,
      description: `D ${title}`,
      url,
      alternates,
      jsonLd: { "@type": "WebPage" },
    })}</head></html>`;
  const alt = translationGroups([fr, en()]).get(fr.url);

  it("une paire réciproque passe", () => {
    expect(
      siteDefects([
        { path: "fr.html", html: page(fr.url, "FR", alt) },
        { path: "en.html", html: page(en().url, "EN", alt) },
      ]),
    ).toEqual([]);
  });

  it("une version qui ne répond pas est signalée", () => {
    const d = siteDefects([
      { path: "fr.html", html: page(fr.url, "FR", alt) },
      { path: "en.html", html: page(en().url, "EN", []) },
    ]);
    expect(d.map((x) => x.defect).join()).toMatch(/non réciproque/);
  });

  it("une version annoncée absente du site est signalée", () => {
    const d = siteDefects([{ path: "fr.html", html: page(fr.url, "FR", alt) }]);
    expect(d.map((x) => x.defect).join()).toMatch(/absente du site/);
    expect(readSeoHead(page(fr.url, "FR", alt)).hreflang.get("x-default")).toBe(
      en().url,
    );
  });
});
