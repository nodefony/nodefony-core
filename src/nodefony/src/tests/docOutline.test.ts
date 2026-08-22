/// <reference types="node" />
import { describe, it, expect } from "vitest";
import {
  outlineMarkdown,
  extractMarkdownSection,
} from "../kernel/inspect/docOutline";

/**
 * Ce que cette suite prouve : qu'une page de documentation peut être RENDUE par
 * morceaux sans mentir sur sa structure. Les pages du framework pèsent 50 à
 * 80 ko — sans découpe fidèle, la seule alternative est une troncature qui
 * s'arrête au milieu d'une phrase.
 */

/** Une page qui porte tous les pièges d'un vrai document du dépôt. */
const PAGE = [
  "# Firewall",
  "",
  "Intro.",
  "",
  "## Configuration",
  "",
  "Du texte.",
  "",
  "```bash",
  "# Ceci est un commentaire shell, PAS un titre",
  "## Ni celui-ci",
  "```",
  "",
  "### Zones",
  "",
  "Détail des zones.",
  "",
  "## 🔐 Sécurité avancée",
  "",
  "Le passage utile.",
].join("\n");

describe("outlineMarkdown", () => {
  it("relève les titres réels et IGNORE ceux des blocs de code", () => {
    const outline = outlineMarkdown(PAGE);
    expect(outline.map((s) => s.title)).to.deep.equal([
      "Firewall",
      "Configuration",
      "Zones",
      "🔐 Sécurité avancée",
    ]);
  });

  it("donne le niveau et la ligne de chaque titre", () => {
    const outline = outlineMarkdown(PAGE);
    expect(outline[2]).to.include({ level: 3, title: "Zones" });
    expect(PAGE.split("\n")[outline[2].line - 1]).to.equal("### Zones");
  });

  it("pèse une section jusqu'au prochain titre de niveau ≤, sous-sections comprises", () => {
    const outline = outlineMarkdown(PAGE);
    const config = outline.find((s) => s.title === "Configuration");
    const zones = outline.find((s) => s.title === "Zones");
    // `Configuration` englobe `Zones` : elle pèse donc strictement plus.
    expect(config?.chars).to.be.greaterThan(zones?.chars ?? Infinity);
    // Et le document entier tient sous le titre de niveau 1.
    expect(outline[0].chars).to.equal(PAGE.length);
  });

  it("rend une liste vide sur un document sans titre", () => {
    expect(outlineMarkdown("juste du texte\net une ligne")).to.deep.equal([]);
  });
});

describe("extractMarkdownSection", () => {
  it("extrait la section demandée, sous-sections comprises", () => {
    const section = extractMarkdownSection(PAGE, "Configuration");
    expect(section?.title).to.equal("Configuration");
    expect(section?.markdown).to.contain("### Zones");
    // Elle s'arrête au titre suivant de même niveau.
    expect(section?.markdown).to.not.contain("Le passage utile");
  });

  it("reconnaît un titre sans accent, sans casse et sans emoji", () => {
    // Un agent recopie rarement « 🔐 Sécurité avancée » à l'identique.
    const section = extractMarkdownSection(PAGE, "securite avancee");
    expect(section?.title).to.equal("🔐 Sécurité avancée");
    expect(section?.markdown).to.contain("Le passage utile");
  });

  it("accepte un titre PARTIEL faute d'égalité", () => {
    expect(extractMarkdownSection(PAGE, "zones")?.title).to.equal("Zones");
  });

  it("rend null quand rien ne correspond — jamais une section au hasard", () => {
    expect(extractMarkdownSection(PAGE, "webhooks")).to.equal(null);
    expect(extractMarkdownSection(PAGE, "")).to.equal(null);
  });

  it("ne se laisse pas découper par un titre de bloc de code", () => {
    const section = extractMarkdownSection(PAGE, "Configuration");
    // Le `## Ni celui-ci` du bloc bash ne clôt pas la section.
    expect(section?.markdown).to.contain("```bash");
    expect(section?.markdown).to.contain("### Zones");
  });
});
