import { expect } from "chai";

import {
  aggregateOutdated,
  classifySeverity,
  formatDependents,
  formatHeadline,
  toTableRows,
  type NpmOutdatedReport,
} from "../cli/outdated";

// ─────────────────────────────────────────────────────────────────────────────
// Décor — extraits RÉELS de `npm outdated --json` sur ce dépôt, forme conservée :
// une entrée est soit un objet, soit un TABLEAU quand plusieurs espaces de
// travail réclament le même paquet. C'est cette forme-là qui produisait la
// duplication à l'affichage.
// ─────────────────────────────────────────────────────────────────────────────

const REPORT: NpmOutdatedReport = {
  // Un seul dépendant, saut mineur, plage épinglée (wanted === current).
  "@mantine/core": {
    current: "9.4.2",
    wanted: "9.4.2",
    latest: "9.5.0",
    dependent: "@nodefony/studio",
    location: "/repo/node_modules/@mantine/core",
  },
  // Vingt-deux dépendants pour UN paquet — dont un doublon à écraser.
  "@mantine/spotlight": [
    {
      current: "9.4.2",
      wanted: "9.4.2",
      latest: "9.5.0",
      dependent: "@nodefony/http",
      location: "/repo/node_modules/@mantine/spotlight",
    },
    {
      current: "9.4.2",
      wanted: "9.4.2",
      latest: "9.5.0",
      dependent: "@nodefony/security",
      location: "/repo/node_modules/@mantine/spotlight",
    },
    {
      current: "9.4.2",
      wanted: "9.4.2",
      latest: "9.5.0",
      dependent: "@nodefony/http",
      location: "/repo/node_modules/@mantine/spotlight",
    },
  ],
  // Saut MAJEUR, plage épinglée.
  typescript: {
    current: "6.0.3",
    wanted: "6.0.3",
    latest: "7.0.2",
    dependent: "nodefony-core",
    location: "/repo/node_modules/typescript",
  },
  // Le piège : notre propre espace de travail, en AVANCE sur le registre public.
  nodefony: [
    {
      current: "10.0.0",
      wanted: "7.0.2",
      latest: "7.0.2",
      dependent: "@nodefony/http",
      location: "/repo/node_modules/nodefony",
    },
    {
      current: "10.0.0",
      wanted: "7.0.2",
      latest: "7.0.2",
      dependent: "@nodefony/framework",
      location: "/repo/node_modules/nodefony",
    },
  ],
};

describe("cli/outdated — agrégation du rapport npm", () => {
  describe("classifySeverity", () => {
    it("classe le saut de rang majeur", () => {
      expect(classifySeverity("6.0.3", "7.0.2")).to.equal("major");
    });

    it("classe le saut mineur", () => {
      expect(classifySeverity("9.4.2", "9.5.0")).to.equal("minor");
    });

    it("classe le correctif", () => {
      expect(classifySeverity("9.4.2", "9.4.9")).to.equal("patch");
    });

    it("nomme « absent » un paquet qui n'est pas installé", () => {
      expect(classifySeverity(null, "1.2.3")).to.equal("missing");
    });
  });

  describe("aggregateOutdated", () => {
    it("rend UNE ligne par paquet, quel que soit le nombre de dépendants", () => {
      const summary = aggregateOutdated(REPORT);
      const names = summary.packages.map((p) => p.name);
      expect(names).to.have.lengthOf(3);
      expect(new Set(names).size).to.equal(3);
    });

    it("déduplique et trie les dépendants", () => {
      const summary = aggregateOutdated(REPORT);
      const spotlight = summary.packages.find(
        (p) => p.name === "@mantine/spotlight",
      );
      // Trois entrées brutes, mais « @nodefony/http » y figure deux fois.
      expect(spotlight?.dependents).to.deep.equal([
        "@nodefony/http",
        "@nodefony/security",
      ]);
    });

    it("écarte le paquet dont la version installée DÉPASSE celle du registre", () => {
      const summary = aggregateOutdated(REPORT);
      expect(summary.packages.map((p) => p.name)).to.not.include("nodefony");
      expect(summary.ahead.map((p) => p.name)).to.deep.equal(["nodefony"]);
      expect(summary.counts.ahead).to.equal(1);
    });

    it("signale une plage épinglée — un `npm update` ne ferait rien", () => {
      const summary = aggregateOutdated(REPORT);
      const ts = summary.packages.find((p) => p.name === "typescript");
      expect(ts?.pinned).to.equal(true);
      expect(ts?.severity).to.equal("major");
    });

    it("ne dit PAS épinglée une plage qui autorise déjà la montée", () => {
      const summary = aggregateOutdated({
        vitest: {
          current: "4.0.1",
          wanted: "4.0.9",
          latest: "4.1.0",
          dependent: "nodefony-core",
        },
      });
      expect(summary.packages[0]?.pinned).to.equal(false);
    });

    it("trie du saut le plus grave au plus bénin, puis par nom", () => {
      const summary = aggregateOutdated(REPORT);
      expect(summary.packages.map((p) => p.name)).to.deep.equal([
        "typescript",
        "@mantine/core",
        "@mantine/spotlight",
      ]);
    });

    it("compte les entrées BRUTES — c'est ce que l'agrégation a évité d'afficher", () => {
      const summary = aggregateOutdated(REPORT);
      // 1 (@mantine/core) + 3 (spotlight) + 1 (typescript) + 2 (nodefony)
      expect(summary.counts.rawEntries).to.equal(7);
      expect(summary.counts.major).to.equal(1);
      expect(summary.counts.minor).to.equal(2);
    });

    it("accepte un rapport vide", () => {
      const summary = aggregateOutdated({});
      expect(summary.packages).to.deep.equal([]);
      expect(summary.counts.rawEntries).to.equal(0);
      expect(formatHeadline(summary)).to.contain("à jour");
    });

    it("traite un paquet absent de node_modules", () => {
      const summary = aggregateOutdated({
        chalk: { wanted: "5.3.0", latest: "5.3.0", dependent: "nodefony-core" },
      });
      expect(summary.packages[0]?.current).to.equal(null);
      expect(summary.packages[0]?.severity).to.equal("missing");
      expect(summary.packages[0]?.pinned).to.equal(false);
    });
  });

  describe("rendu", () => {
    it("compte les dépendants au-delà de trois, les nomme en deçà", () => {
      expect(formatDependents(["a", "b", "c"], false)).to.equal("a, b, c");
      expect(formatDependents(["a", "b", "c", "d"], false)).to.equal(
        "4 paquets",
      );
      expect(formatDependents(["a", "b", "c", "d"], true)).to.equal(
        "a, b, c, d",
      );
      expect(formatDependents([], false)).to.equal("—");
    });

    it("marque la plage épinglée dans la colonne « Souhaité »", () => {
      const summary = aggregateOutdated(REPORT);
      const rows = toTableRows(summary);
      const ts = rows.find((r) => r[0] === "typescript");
      expect(ts?.[1]).to.equal("MAJEUR");
      expect(ts?.[3]).to.equal("6.0.3 (épinglé)");
    });

    // Ce que npm affiche, et pourquoi ce n'est pas le même nombre : sans cette
    // phrase, on compare 8 lignes à 25 et on conclut à une divergence.
    it("explique l'écart avec le nombre de lignes de npm", () => {
      const headline = formatHeadline(aggregateOutdated(REPORT));
      expect(headline).to.contain("3 paquets en retard");
      expect(headline).to.contain("npm en affiche 7 lignes");
      expect(headline).to.contain("CHAQUE dépendant");
    });

    it("ne parle pas de npm quand il n'y a rien à expliquer", () => {
      // Un paquet, un dépendant : le brut et l'agrégé coïncident.
      const headline = formatHeadline(
        aggregateOutdated({
          vitest: {
            current: "4.0.1",
            wanted: "4.0.9",
            latest: "4.1.0",
            dependent: "nodefony-core",
          },
        }),
      );
      expect(headline).to.not.contain("npm en affiche");
    });
  });
});
