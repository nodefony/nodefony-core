// Le menu des sites voisins (performance, qualité) : des liens RELATIFS justes
// depuis chaque profondeur, et la bonne entrée allumée.
import { describe, expect, it } from "vitest";
import { relativeUrl, siteNav } from "./lib/site-nav.mjs";

describe("site-nav — liens relatifs", () => {
  it("remonte autant de dossiers que la page en a, puis descend vers la cible", () => {
    expect(relativeUrl("/performance/analyses/", "/docs/")).toBe("../../docs/");
    expect(relativeUrl("/performance/10.0.0/methode/", "/qualite/")).toBe(
      "../../../qualite/",
    );
  });

  it("garde le préfixe commun et rend « ./ » pour la page elle-même", () => {
    expect(relativeUrl("/performance/", "/performance/latest/")).toBe(
      "latest/",
    );
    expect(relativeUrl("/performance/", "/performance/")).toBe("./");
    expect(relativeUrl("/qualite/10.0.0/", "/")).toBe("../../");
  });
});

describe("site-nav — le menu", () => {
  it("allume l'entrée dont l'URL est le plus long préfixe de la page", () => {
    const html = siteNav("/performance/analyses/");
    expect(html).toContain(
      '<a href="./" aria-current="page">Où part le temps</a>',
    );
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
  });

  it("une page de version allume sa section, et mène à la doc et à la qualité", () => {
    const html = siteNav("/performance/10.0.0/methode/");
    expect(html).toContain(
      '<a href="../../" aria-current="page">📊 Performance</a>',
    );
    expect(html).toContain('href="../../../docs/"');
    expect(html).toContain('href="../../../qualite/"');
    expect(html).toContain('class="nav-up" href="../../../"');
  });
});
