/**
 * Éprouve le plan `llms.txt` du site et le résumé de page qu'il cite.
 *
 * Ce que ces tests gardent : le plan est la première chose qu'un agent lit sur
 * le framework. Il a déjà menti trois fois sans qu'aucun contrôle ne le voie —
 * préversion `alpha` annoncée après la 10.0.0, 288 pages listées (60 Ko qu'un
 * lecteur tronque), résumés commencés au milieu d'une phrase.
 */
import { describe, expect, it } from "vitest";
import {
  ENTRY_POINTS,
  isPlanned,
  llmsPlan,
  releaseStatus,
} from "./lib/llms-plan.mjs";
import { SUMMARY_MAX, clipSummary, pageSummary } from "./lib/page-summary.mjs";

const BASE = "https://nodefony.net";

/** Une page rendue, telle que `build-site-plan.mjs` la lit dans l'artefact. */
function page(urlPath, title = urlPath || "accueil") {
  const parts = urlPath.split("/").filter(Boolean);
  return {
    urlPath,
    segment: parts[0] ?? "",
    depth: parts.length,
    title,
    description: `Résumé de ${title}`,
    canonical: `${BASE}/${urlPath}`,
    markdown: urlPath !== "",
  };
}

/** Un site minimal qui porte tout ce que le plan cite. */
function site(extra = []) {
  return [
    ...ENTRY_POINTS.map((p) => page(p)),
    page("docs/guides/"),
    page("docs/guides/compatibilite/", "Compatibilité"),
    page("docs/modules/http/", "@nodefony/http"),
    page("docs/modules/http/pipeline/", "Pipeline HTTP"),
    page("docs/api/http/Classe/", "Classe"),
    page("performance/latest/", "Mesures"),
    page("performance/10.0.0/", "Mesures 10.0.0"),
    ...extra,
  ];
}

const FACTS = {
  deps: [
    "nodefony",
    "@nodefony/http",
    "@nodefony/framework",
    "@nodefony/ai",
    "zod",
  ],
  packageCount: 14,
  version: "10.0.1",
};

describe("llms.txt — l'état se calcule depuis la version publiée", () => {
  it("une version stable : `latest`, aucune préversion annoncée", () => {
    const plan = llmsPlan(site(), BASE, FACTS);
    expect(plan).toContain("Version 10.0.1 is the current stable release");
    expect(plan).toContain("`npm create nodefony my-app`");
    expect(plan).not.toMatch(/@alpha|@beta|pre-release/);
  });

  it("une préversion : son canal, dans la commande et dans la phrase", () => {
    const status = releaseStatus("10.1.0-beta.2");
    expect(status.createCommand).toBe("npm create nodefony@beta my-app");
    expect(status.sentence).toContain("pre-release");
    expect(status.sentence).toContain("`beta`");
  });

  it("une version invalide fait échouer le plan, plutôt que de mentir", () => {
    expect(() => releaseStatus("pas-une-version")).toThrow(/version invalide/);
  });
});

describe("llms.txt — en anglais, et la langue de la doc dite", () => {
  it("annonce que la documentation est en français", () => {
    const plan = llmsPlan(site(), BASE, FACTS);
    expect(plan).toContain("**The documentation is written in French**");
    expect(plan).toContain("five dependencies");
    expect(plan).toContain("## Start here");
  });
});

describe("llms.txt — un INDEX court, pas le catalogue", () => {
  it("garde rubriques, guides et hubs ; écarte les pages profondes et les archives versionnées", () => {
    const plan = llmsPlan(site(), BASE, FACTS);
    expect(plan).toContain("docs/modules/http/index.md");
    expect(plan).toContain("docs/guides/compatibilite/index.md");
    expect(plan).toContain(`${BASE}/performance/latest/`);
    expect(plan).not.toContain("docs/modules/http/pipeline/");
    expect(plan).not.toContain("docs/api/http/Classe/");
    expect(plan).not.toContain("performance/10.0.0/");
  });

  it("trois cents pages de référence n'allongent pas le plan", () => {
    const deep = Array.from({ length: 300 }, (_, i) =>
      page(`docs/api/core/Symbole${i}/`, `Symbole${i}`),
    );
    const sans = llmsPlan(site(), BASE, FACTS);
    const avec = llmsPlan(site(deep), BASE, FACTS);
    expect(avec).toBe(sans);
  });

  it("la règle de profondeur", () => {
    expect(isPlanned(page("docs/modules/http/"))).toBe(true);
    expect(isPlanned(page("docs/modules/http/pipeline/"))).toBe(false);
    expect(isPlanned(page("qualite/latest/"))).toBe(true);
    expect(isPlanned(page("qualite/10.0.0/"))).toBe(false);
    expect(isPlanned(page("assets/"))).toBe(false);
  });
});

describe("llms.txt — une promesse de lien se tient", () => {
  it("une page d'entrée absente fait échouer le plan", () => {
    const pages = site().filter((p) => p.urlPath !== "docs/demarrer/");
    expect(() => llmsPlan(pages, BASE, FACTS)).toThrow(/page d'entrée absente/);
  });

  it("la page de compatibilité citée absente fait échouer le plan", () => {
    const pages = site().filter(
      (p) => p.urlPath !== "docs/guides/compatibilite/",
    );
    expect(() => llmsPlan(pages, BASE, FACTS)).toThrow(/citée par le plan/);
  });
});

describe("résumé d'une page", () => {
  it("commence au début du paragraphe, même quand il ouvre sur du gras", () => {
    const body =
      "Nodefony › Guides\n\n**Générer** un module, un contrôleur, un frontend ou une\n" +
      "entité sans écrire le squelette à la main.\n";
    expect(pageSummary(body, undefined, "t")).toBe(
      "Générer un module, un contrôleur, un frontend ou une entité sans écrire le squelette à la main.",
    );
  });

  it("ne publie jamais un commentaire HTML comme résumé", () => {
    const body =
      "<!-- GÉNÉRÉ par scripts/generate/env-snapshot.ts (npm run env:snapshot). -->\n\n" +
      "Toutes les variables que le framework lit, et ce qui se passe sans elles.\n";
    expect(pageSummary(body, undefined, "t")).toBe(
      "Toutes les variables que le framework lit, et ce qui se passe sans elles.",
    );
  });

  it("coupe un résumé trop long en fin de phrase, sinon au mot — jamais en plein mot", () => {
    const phrase =
      "Une première phrase qui pose le sujet de la page et dit à quoi elle sert vraiment.";
    const long = `${phrase} Une seconde phrase qui déborde largement de la place laissée par un moteur de recherche.`;
    expect(clipSummary(long)).toBe(phrase);
    const sansPoint = "mot ".repeat(60).trim();
    const coupe = clipSummary(sansPoint);
    expect(coupe.length).toBeLessThanOrEqual(SUMMARY_MAX);
    expect(coupe).toMatch(/ mot…$/);
    expect(clipSummary("Court.")).toBe("Court.");
  });

  it("un commentaire imbriqué ne laisse aucune ouverture `<!--` derrière lui", () => {
    // Un seul passage de la regex rend `<!--` à partir de `<!-<!---->-` : le
    // retrait se répète jusqu'au point fixe (alerte CodeQL
    // js/incomplete-multi-character-sanitization).
    const body =
      "Une phrase <!-<!---->- reste --> de prose assez longue pour servir de résumé.\n";
    const summary = pageSummary(body, undefined, "t");
    expect(summary).not.toContain("<!--");
    expect(summary).toBe(
      "Une phrase  de prose assez longue pour servir de résumé.",
    );
  });

  it("garde les soulignés d'un identifiant, retire ceux d'une emphase", () => {
    const body =
      "Changer `NF_DATABASE_URL` de postgres à mongodb ne doit _rien_ changer à ce que voit l'application.\n";
    expect(pageSummary(body, undefined, "t")).toBe(
      "Changer NF_DATABASE_URL de postgres à mongodb ne doit rien changer à ce que voit l'application.",
    );
  });

  it("saute titres, listes et tableaux ; la description déclarée l'emporte", () => {
    const body =
      "# Titre\n\n- un item assez long pour passer le seuil de longueur\n\n| a | b |\n\nLa vraie phrase d'introduction de cette page de test.\n";
    expect(pageSummary(body, undefined, "t")).toBe(
      "La vraie phrase d'introduction de cette page de test.",
    );
    expect(pageSummary(body, "Déclarée", "t")).toBe("Déclarée");
  });
});
