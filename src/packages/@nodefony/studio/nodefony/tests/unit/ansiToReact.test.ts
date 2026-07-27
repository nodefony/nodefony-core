/**
 * Unit — coloration des séquences ANSI (`frontend/src/utils/ansiToReact.tsx`).
 *
 * Ce que ces cas gardent fermé : l'expression régulière qui découpe les
 * séquences reçoit des LIGNES DE JOURNAL — servies par le plan d'administration
 * du syslog et poussées sur le canal temps réel. Elles portent donc ce qu'une
 * requête a pu y déposer (agent utilisateur, chemin, identifiant). Une forme à
 * quantificateurs imbriqués y était exponentielle dès que le `m` final manquait :
 * 26 chiffres coûtaient 410 ms, avec un doublement tous les deux caractères.
 * Le coût se paie dans le NAVIGATEUR de l'administrateur, pas sur le serveur —
 * ce qui le rend d'autant plus discret.
 */
import { describe, it } from "vitest";
import { expect } from "chai";
import { performance } from "node:perf_hooks";

import { ansiToReact } from "../../../frontend/src/utils/ansiToReact";

describe("ansiToReact", () => {
  it("rend la chaîne telle quelle quand elle ne porte aucune séquence", () => {
    expect(ansiToReact("rien à colorer")).to.equal("rien à colorer");
    expect(ansiToReact("")).to.equal("");
  });

  it("découpe une ligne colorée en plusieurs nœuds", () => {
    const out = ansiToReact("avant \x1b[31mrouge\x1b[0m après");
    expect(Array.isArray(out)).to.equal(true);
    expect((out as unknown[]).length).to.be.greaterThan(1);
  });

  it("reconnaît les formes réelles, y compris la couleur étendue", () => {
    for (const seq of [
      "\x1b[0m",
      "\x1b[1m",
      "\x1b[31m",
      "\x1b[1;31m",
      "\x1b[38;5;208m",
      "\x1b[m",
    ]) {
      const out = ansiToReact(`x${seq}y`);
      expect(Array.isArray(out)).to.equal(
        true,
        `séquence non reconnue : ${JSON.stringify(seq)}`,
      );
    }
  });

  // LE cas. Des chiffres après `\x1b[`, et pas de `m` : la reconnaissance
  // échoue, et c'est l'échec qui coûtait cher. 40 chiffres sont hors de portée
  // de la forme exponentielle — elle n'en revenait pas.
  it("ne s'effondre pas sur une séquence inachevée", () => {
    const hostile = `journal ordinaire \x1b[${"1".repeat(40)} suite`;
    const t0 = performance.now();
    const out = ansiToReact(hostile);
    const ms = performance.now() - t0;
    // Aucune séquence COMPLÈTE : rien n'est consommé, le texte ressort entier
    // dans l'unique nœud de queue — mais il ressort, et il ressort tout de suite.
    expect(Array.isArray(out)).to.equal(true);
    expect((out as unknown[]).length).to.equal(1);
    expect(ms).to.be.lessThan(50, `${ms.toFixed(1)} ms`);
  });
});
