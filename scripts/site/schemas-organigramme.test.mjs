/**
 * Le tracé des organigrammes du site — jugé sur le CORPUS réel.
 *
 * Un point de sortie calculé sur l'axe entre deux centres faisait partir des
 * traits par le côté d'une boîte, tous les coudes d'un intervalle suivaient la
 * même ligne, une arête qui sautait un rang traversait les boîtes du rang
 * intermédiaire, et le sens `BT` de la source était ignoré (carte des modules de
 * la vue d'ensemble). Ces invariants se jugent sur le placement
 * (`placerOrganigramme`), pour chaque bloc ```mermaid du dépôt.
 */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  lireMermaid,
  placerEnCouches,
  placerOrganigramme,
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
  for (const m of src.matchAll(/```mermaid\n([\s\S]*?)```/g)) {
    const modele = lireMermaid(m[1]);
    if (modele.type === "flux" && modele.aretes.length)
      corpus.push({ f, modele });
  }
}

/** Le point est-il à l'INTÉRIEUR de la boîte (bord exclu, marge de 2 px) ? */
const dedans = (b, forme, x, y) => {
  const dx = Math.abs(x - b.x);
  const dy = Math.abs(y - b.y);
  if (forme === "losange") return dx / (b.w / 2) + dy / (b.h / 2) < 0.92;
  return dx < b.w / 2 - 2 && dy < b.h / 2 - 2;
};
/** Le point est-il SUR le bord de la boîte ? */
const surBord = (b, x, y) => {
  const dx = Math.abs(x - b.x);
  const dy = Math.abs(y - b.y);
  return (
    dx <= b.w / 2 + 0.6 &&
    dy <= b.h / 2 + 0.6 &&
    (Math.abs(dx - b.w / 2) < 0.6 || Math.abs(dy - b.h / 2) < 0.6)
  );
};
const segments = (pts) => pts.slice(1).map((p, i) => [pts[i], p]);
/** Longueur commune de deux segments colinéaires (0 s'ils ne le sont pas). */
const recouvrement = ([a, b], [c, d]) => {
  const vertical = (p, q) => Math.abs(p[0] - q[0]) < 0.5;
  const horizontal = (p, q) => Math.abs(p[1] - q[1]) < 0.5;
  if (vertical(a, b) && vertical(c, d) && Math.abs(a[0] - c[0]) < 3) {
    const lo = Math.max(Math.min(a[1], b[1]), Math.min(c[1], d[1]));
    const hi = Math.min(Math.max(a[1], b[1]), Math.max(c[1], d[1]));
    return hi - lo;
  }
  if (horizontal(a, b) && horizontal(c, d) && Math.abs(a[1] - c[1]) < 3) {
    const lo = Math.max(Math.min(a[0], b[0]), Math.min(c[0], d[0]));
    const hi = Math.min(Math.max(a[0], b[0]), Math.max(c[0], d[0]));
    return hi - lo;
  }
  return 0;
};

describe("organigrammes du corpus", () => {
  it("le corpus en contient (sinon le test ne juge rien)", () => {
    expect(corpus.length).toBeGreaterThan(50);
  });

  it.each(corpus.map((c, i) => [`${c.f} #${i}`, c]))(
    "%s : bords, aucune boîte traversée, aucun trait superposé, sens de la source",
    (_, { modele }) => {
      const g = placerOrganigramme(modele, 0);
      const boite = new Map(g.noeuds.map((b) => [b.id, b]));
      const forme = new Map(modele.noeuds.map((n) => [n.id, n.forme]));
      const rang = placerEnCouches(modele);
      const echecs = [];

      for (const a of g.aretes) {
        const nom = `${a.de} → ${a.vers}`;
        const debut = a.points[0];
        const fin = a.points.at(-1);
        if (!surBord(boite.get(a.de), ...debut))
          echecs.push(`${nom} : départ hors du bord`);
        if (!surBord(boite.get(a.vers), ...fin))
          echecs.push(`${nom} : arrivée hors du bord`);
        for (const [p, q] of segments(a.points)) {
          if (Math.abs(p[0] - q[0]) > 0.5 && Math.abs(p[1] - q[1]) > 0.5)
            echecs.push(`${nom} : segment en diagonale`);
          const n = Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1]) / 2);
          for (let k = 0; k <= n; k++) {
            const x = p[0] + ((q[0] - p[0]) * k) / Math.max(1, n);
            const y = p[1] + ((q[1] - p[1]) * k) / Math.max(1, n);
            for (const b of g.noeuds)
              if (dedans(b, forme.get(b.id), x, y)) {
                echecs.push(`${nom} : traverse ${b.id}`);
                k = n + 1;
                break;
              }
          }
          for (const [x, y] of [p, q])
            if (x < 0 || y < 0 || x > g.largeur || y > g.hauteur)
              echecs.push(`${nom} : hors du cadre`);
        }
        // Le sens : une arête qui descend les rangs va dans la direction déclarée.
        const ra = rang.get(a.de).rang;
        const rb = rang.get(a.vers).rang;
        if (rb > ra) {
          const s = boite.get(a.de);
          const v = boite.get(a.vers);
          const ok = {
            TD: v.y > s.y,
            TB: v.y > s.y,
            BT: v.y < s.y,
            LR: v.x > s.x,
            RL: v.x < s.x,
          }[modele.dir];
          if (ok === false)
            echecs.push(`${nom} : contre le sens ${modele.dir}`);
        }
      }

      // Deux arêtes distinctes ne partagent aucun tronçon — sauf à la pointe
      // d'un losange, qui n'a qu'un point par face.
      g.aretes.forEach((a, i) =>
        g.aretes.slice(i + 1).forEach((b) => {
          if (a.de === b.de && a.vers === b.vers) return;
          const pointe = [a.de, a.vers].some(
            (id) => [b.de, b.vers].includes(id) && forme.get(id) === "losange",
          );
          if (pointe) return;
          for (const s1 of segments(a.points))
            for (const s2 of segments(b.points))
              if (recouvrement(s1, s2) > 4)
                echecs.push(
                  `${a.de}→${a.vers} et ${b.de}→${b.vers} superposés`,
                );
        }),
      );
      expect([...new Set(echecs)]).toEqual([]);
    },
  );
});
