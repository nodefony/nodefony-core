/**
 * Suite du gate des promesses d'ADR — écrite pour le faire ÉCHOUER.
 *
 * Les décors sont des ADR miniatures : la formule « Rupture si différé » les fait
 * entrer dans le périmètre, comme les vrais. Les corps d'issue sont injectés —
 * aucun appel réseau.
 */
import { describe, expect, it } from "vitest";

import {
  bodyCites,
  findDelegations,
  findUncarriedPromises,
  findUnknownDelegations,
  splitSections,
} from "./check-adr-deferrals.mjs";

const adr = (body) => `# ADR-0099 — Décor\n\n## Décision\n\n${body}`;

describe("findUncarriedPromises", () => {
  it("refuse une promesse sans ticket dans une section NON", () => {
    const md = adr(
      "### 7. La reprise\n\nDemain (10.2) : `subscribe { since? }`.\n\n" +
        "- **Rupture si différé : NON**, paramètre optionnel.\n",
    );
    const found = findUncarriedPromises("0099", md);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ adr: "0099", section: "§7" });
  });

  it("accepte la promesse qui cite son ticket", () => {
    const md = adr(
      "### 7. La reprise\n\nDemain (10.2, #715) : `subscribe { since? }`.\n\n" +
        "- **Rupture si différé : NON**, paramètre optionnel.\n",
    );
    expect(findUncarriedPromises("0099", md)).toEqual([]);
  });

  it("accepte la promesse qui écrit « aucun travail prévu »", () => {
    const md = adr(
      "### S2. Pas d'identifiant\n\n" +
        "- **Rupture si différé : NON.** Un type reste possible plus tard ; aucun travail prévu.\n",
    );
    expect(findUncarriedPromises("0099", md)).toEqual([]);
  });

  it("juge le PARAGRAPHE : un ticket cité ailleurs dans la section ne solde rien", () => {
    // Vécu sur l'ADR-0022 §7 : la section cite #622 et #629 pour autre chose.
    const md = adr(
      "### 7. La reprise\n\nDemain (10.2) : un curseur.\n\n" +
        "- C'est la condition, prouvée par #629.\n" +
        "- **Rupture si différé : NON**, additif.\n",
    );
    expect(findUncarriedPromises("0099", md)).toHaveLength(1);
  });

  it("laisse les sections OUI et la version figée 10.0", () => {
    const md = adr(
      "### S1. La charge\n\nUne enveloppe pourra venir en 10.3.\n\n" +
        "- **Rupture si différé : OUI.**\n\n" +
        "### S2. Autre\n\nUn serveur 10.0 ignore le champ.\n\n" +
        "- **Rupture si différé : NON.**\n",
    );
    expect(findUncarriedPromises("0099", md)).toEqual([]);
  });

  it("ignore les blocs de code et les ADR hors périmètre", () => {
    const fenced = adr(
      "### 3. Code\n\n```ts\n// pourra servir en 10.4\n```\n\n- **Rupture si différé : NON.**\n",
    );
    expect(findUncarriedPromises("0099", fenced)).toEqual([]);
    expect(
      findUncarriedPromises("0001", "# ADR\n\nCela pourra venir en 10.2.\n"),
    ).toEqual([]);
  });
});

describe("splitSections", () => {
  it("nomme les sections numérotées, lettrées et bis", () => {
    const ids = splitSections(
      adr(
        "### 4. Iso\n\nx\n\n### S10 bis. Contrat\n\ny\n\n### W3. Émission\n\nz\n",
      ),
    ).map((s) => s.id);
    expect(ids).toEqual(["(préambule)", "Décision", "4", "S10 bis", "W3"]);
  });
});

describe("gestes confiés à un ticket", () => {
  const md = adr(
    "### 2. L'enveloppe\n\nRepris de #630 : sans sous-protocole, le format reste.\n\n" +
      "- **Rupture si différé : NON.**\n\n" +
      "### 4. L'isomorphisme\n\n| Trou | État | Geste |\n| --- | --- | --- |\n" +
      "| (i) binaire | **fermé** (#630) : vu | #618 : routage dans le pair partagé |\n\n" +
      "- à prouver dans #623 : un éjecté n'est pas servi.\n",
  );

  it("relève le geste en tête de cellule ou après « dans », pas l'origine ni l'état", () => {
    const found = findDelegations("0022", md).map(
      (d) => `${d.section} #${d.issue}`,
    );
    expect(found).toEqual(["§4 #618", "§4 #623"]);
  });

  it("refuse le geste que le corps du ticket ne cite pas", () => {
    // Vécu sur #618 : le corps ne renvoyait qu'aux §2 et §3, le geste du §4 a été posé à l'envers.
    const bodies = new Map([
      [618, "Voir ADR-0022 §2 et §3."],
      [623, "Applique ADR-0022 §6."],
    ]);
    const unknown = findUnknownDelegations(findDelegations("0022", md), bodies);
    expect(unknown.map((d) => `${d.adr} ${d.section} → #${d.issue}`)).toEqual([
      "0022 §4 → #618",
      "0022 §4 → #623",
    ]);
  });

  it("accepte le geste que le corps cite, lien Markdown compris", () => {
    const bodies = new Map([
      [618, "Le geste de l'ADR-0022 §4, ligne (i)."],
      [
        623,
        "[ADR-0022](../docs/adr/0022-socket-temps-reel.md) §4 : l'éjection.",
      ],
    ]);
    expect(findUnknownDelegations(findDelegations("0022", md), bodies)).toEqual(
      [],
    );
  });

  it("compte une issue absente comme ne citant rien", () => {
    expect(
      findUnknownDelegations(findDelegations("0022", md), new Map()),
    ).toHaveLength(2);
  });

  it("distingue §4 de §40 et lit les sections lettrées", () => {
    expect(bodyCites("ADR-0022 §40", "0022", "4")).toBe(false);
    expect(bodyCites("ADR-0021 S3 et S10 bis", "0021", "S10 bis")).toBe(true);
    expect(bodyCites("ADR-0021 §S3", "0021", "S3")).toBe(true);
  });
});
