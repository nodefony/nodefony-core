/**
 * Suite de la dérivation d'ordre d'un sous-ticket.
 *
 * `Ordre` encode les DÉPENDANCES : ce qui doit passer avant quoi. Un item qui n'en
 * a pas tombe en fin de tri et n'est jamais proposé — l'oubli est silencieux, comme
 * l'était l'absence d'inscription au tableau.
 *
 * Ce que cette suite garde, c'est que la dérivation range un enfant DERRIÈRE ses
 * frères déjà inscrits, et qu'elle REFUSE les deux cas où un ordre dérivé serait
 * faux : un parent sans ordre, et une grappe qui déborde sur le cran suivant. Les
 * deux ont été vus en vrai sur la grappe #54, rangée à « numéro d'issue − 4 » —
 * le socle après ce qui en dépend, et un ticket d'un autre jalon en tête.
 */
import { describe, expect, it } from "vitest";
import { deriveOrdre } from "./ticket-open.mjs";

describe("ordre dérivé d'un sous-ticket", () => {
  it("le premier enfant prend le premier dixième du parent", () => {
    expect(deriveOrdre(50, 0)).to.equal(50.1);
  });

  it("chaque enfant suivant se range DERRIÈRE ses frères", () => {
    expect(deriveOrdre(50, 1)).to.equal(50.2);
    expect(deriveOrdre(50, 2)).to.equal(50.3);
  });

  // PIÈGE : `1.1 + 0.1` vaut 1.2000000000000002 en binaire — un cas parmi 1 608 sur
  // la plage d'ordres du tableau. Sans arrondi, l'ordre POSÉ n'est pas celui qu'on
  // lit, et la valeur remonte telle quelle dans l'empreinte commitée.
  // Les deux cas propres sont là pour que l'arrondi ne DÉPLACE rien par ailleurs.
  it("arrondit au dixième — un parent décimal ne dérive pas de flottant sale", () => {
    expect(deriveOrdre(1.1, 0)).to.equal(1.2);
    expect(deriveOrdre(8.1, 5)).to.equal(8.7);
    expect(deriveOrdre(1.5, 0)).to.equal(1.6);
  });

  // PIÈGE : c'est le cas VÉCU. Toute la grappe #83 est sortie sans ordre parce que
  // le parent n'en avait pas ; sept tickets sont tombés en fin de tri d'un coup.
  it("REFUSE de dériver d'un parent sans ordre", () => {
    expect(() => deriveOrdre(undefined, 0)).to.throw(/pas d'ordre/);
    expect(() => deriveOrdre(Number.NaN, 0)).to.throw(/pas d'ordre/);
  });

  // PIÈGE : au dixième enfant, 50 + 1.0 = 51 — soit l'ordre du ticket SUIVANT.
  // La grappe avalerait son voisin sans qu'aucune erreur ne soit levée.
  it("REFUSE une grappe qui mordrait sur le cran suivant", () => {
    expect(deriveOrdre(50, 8)).to.equal(50.9);
    expect(() => deriveOrdre(50, 9)).to.throw(/neuf sous-tickets/);
  });
});

/**
 * Aucun script de pilotage ne décide sur `gh project item-list`.
 *
 * Ce contrôle existe parce que la règle était écrite — dans le SKILL.md, noir sur
 * blanc — et que le script la violait quand même. `item-list` omet des lignes sans
 * le dire ; sur un tableau de plus de cent items, le parent d'une grappe en
 * tombait, et `ticket-open.mjs` annonçait « le parent n'a pas d'ordre » avant de
 * poser toute la grappe en fin de tri. Rien n'avait l'air cassé.
 *
 * Une règle en prose n'est appliquée que si un automate la relit — c'est ce que
 * dit le skill lui-même à propos du tableau de bord ; il fallait que ça vaille
 * aussi pour ses propres outils.
 */
describe("les scripts de pilotage ne lisent pas le tableau par `item-list`", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const url = await import("node:url");
  const ici = path.dirname(url.fileURLToPath(import.meta.url));

  /** Retire commentaires de ligne et de bloc — une MENTION n'est pas un appel. */
  const sansCommentaires = (source) =>
    source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  // Le dossier est BALAYÉ plutôt qu'énuméré : un script neuf entre sous la garde
  // sans que personne y pense, et aucun nom n'est écrit ici — une liste nominale
  // ferait lire à l'inventaire des scripts du dépôt que ceux-ci sont « lancés »,
  // alors que ce test ne fait que les OUVRIR.
  const scripts = fs
    .readdirSync(ici)
    .filter((f) => f.endsWith(".mjs") && !f.endsWith(".test.mjs"));

  it("le balayage trouve bien des scripts (sinon la garde ne garde rien)", () => {
    expect(scripts.length).to.be.greaterThan(3);
  });

  for (const nom of scripts) {
    it(`${nom} n'appelle pas \`gh project item-list\``, () => {
      const code = sansCommentaires(
        fs.readFileSync(path.join(ici, nom), "utf8"),
      );
      expect(code).not.to.match(/["']item-list["']/);
    });
  }
});
