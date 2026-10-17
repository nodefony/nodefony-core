/**
 * Les diagrammes de séquence du site tiennent leurs libellés — sur le CORPUS réel.
 *
 * Un écart fixe entre lignes de vie faisait déborder les libellés longs sur les
 * colonnes voisines, chevaucher les boucles, et couper une note plus large que la
 * dernière colonne (vu sur la page publiée du cycle de boot). Ces invariants se
 * jugent sur le placement (`placerSequence`), pour chaque bloc ```mermaid du dépôt.
 */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  largeurLignes,
  lireMermaid,
  placerSequence,
  sequence,
} from "../../.claude/skills/nodefony-html-report/lib/schemas.mjs";
import { REPO_ROOT } from "../lib/repo-root.mjs";

const fichiers = execFileSync("git", ["ls-files", "*.md"], {
  cwd: REPO_ROOT,
  encoding: "utf8",
})
  .trim()
  .split("\n");

const corpus = [];
for (const f of fichiers) {
  const src = readFileSync(`${REPO_ROOT}/${f}`, "utf8");
  for (const m of src.matchAll(/```mermaid\n([\s\S]*?)```/g))
    if (m[1].trimStart().startsWith("sequenceDiagram"))
      corpus.push({ f, source: m[1] });
}

const PASTILLE = 20;

describe("diagrammes de séquence du corpus", () => {
  it("le corpus en contient (sinon le test ne juge rien)", () => {
    expect(corpus.length).toBeGreaterThan(20);
  });

  it.each(corpus.map((c, i) => [`${c.f} #${i}`, c]))(
    "%s : libellés entre leurs lignes de vie, notes dans le cadre, lignes sans chevauchement",
    (_, { source }) => {
      const modele = lireMermaid(source);
      const g = placerSequence(modele, 46);
      const avance = modele.autonumber ? PASTILLE : 0;
      const fin = g.x0 + g.largeur;
      let bas = -Infinity;
      for (const m of g.messages) {
        const w = largeurLignes(m.lignes) + avance;
        if (m.x1 === m.x2) {
          const suivante = g.colonnes.find((c) => c > m.x1) ?? fin;
          expect(m.x1 + 34 + w).toBeLessThanOrEqual(suivante);
        } else {
          expect(w).toBeLessThanOrEqual(Math.abs(m.x2 - m.x1) - 20);
        }
        expect(m.haut).toBeGreaterThanOrEqual(bas);
        bas = m.bas;
      }
      // Aucun libellé abrégé : chaque mot de la source est rendu.
      const mots = (t) => t.split(/<br\s*\/?>|\s+/i).filter(Boolean).length;
      for (const x of [...g.messages, ...g.notes])
        expect(mots(x.lignes.join(" "))).toBe(mots(x.texte));
      for (const n of g.notes) {
        expect(n.x).toBeGreaterThanOrEqual(g.x0);
        expect(n.x + n.largeur).toBeLessThanOrEqual(fin);
      }
    },
  );
});

describe("lecture des diagrammes de séquence", () => {
  it("autonumber numérote les messages de 1 à N, et la pastille est dessinée", () => {
    const src =
      "sequenceDiagram\n  autonumber\n  A->>B: un\n  B->>A: deux\n  A->>A: trois";
    const g = placerSequence(lireMermaid(src), 46);
    expect(g.messages.map((m) => m.numero)).toEqual([1, 2, 3]);
    expect(sequence({ source: src }).match(/<circle/g)).toHaveLength(3);
  });

  it("un `rect … end` imbriqué ne referme pas le cadre `alt` qui le contient", () => {
    const src = [
      "sequenceDiagram",
      "  alt connu",
      "    rect rgb(240,240,240)",
      "      A->>B: dedans",
      "    end",
      "  else inconnu",
      "    A->>B: refus",
      "  end",
    ].join("\n");
    const g = placerSequence(lireMermaid(src), 46);
    const alt = g.cadres.find((c) => c.cadre === "alt");
    expect(g.cadres.map((c) => c.cadre).sort()).toEqual(["alt", "rect"]);
    expect(alt.sinons).toHaveLength(1);
    expect(alt.y1).toBeGreaterThan(alt.sinons[0].y);
  });

  it("un message long passe à la ligne sans perdre un mot", () => {
    const long =
      "le noyau résout la configuration, charge chaque module du manifeste dans l'ordre déclaré, puis valide les surcharges";
    const g = placerSequence(
      lireMermaid(`sequenceDiagram\n  A->>B: ${long}`),
      46,
    );
    expect(g.messages[0].lignes.length).toBeGreaterThan(3);
    expect(g.messages[0].lignes.join(" ")).toBe(long);
  });

  it("une flèche d'activation (`->>+B`) ne crée pas de participant « +B »", () => {
    const m = lireMermaid("sequenceDiagram\n  A->>+B: ouvre\n  B-->>-A: rend");
    expect(m.participants.map((p) => p.id)).toEqual(["A", "B"]);
  });
});
