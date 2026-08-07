/**
 * Sentinelle ANTI-CYCLE du graphe d'imports du frontend Studio.
 *
 * Le défaut que ce test ferme : `auth/dashboards.ts` → `auth/roles.ts` →
 * `stores/` → `stores/AuthStore.ts` → `auth/dashboards.ts`. Un cycle d'imports
 * ESM ne casse pas au premier chargement — l'ordre d'évaluation traverse la
 * boucle dans un sens qui marche, par chance. Il tombe quand l'ordre change :
 * au rechargement à chaud, en `ReferenceError: Cannot access 'ROLE_SUPERVISOR'
 * before initialization`, parce que le corps de `DASHBOARDS` lit une constante
 * dont le module n'est pas encore initialisé. Rien ne le signalait : ni le
 * compilateur, ni les tests, ni le chargement initial de la page.
 *
 * Pourquoi une analyse STATIQUE plutôt qu'une observation : un cycle est une
 * propriété du graphe, pas d'une exécution. L'automate est exhaustif là où un
 * chargement de page ne prouve que le chemin qu'il a pris ce jour-là — et il
 * couvre les cycles qui ne sont pas encore devenus des pannes.
 *
 * Ce que le test NE compte PAS : les imports `import type`, effacés à la
 * compilation — ils ne créent aucune arête à l'exécution, et les interdire
 * ferait un gate qui crie sans qu'il y ait de défaut.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(here, "..", "..", "..", "frontend", "src");

/** Extensions tentées pour résoudre un specifier sans extension, dans l'ordre. */
const EXTS = [".ts", ".tsx", ".js", ".jsx"];

const listFiles = (dir: string): string[] => {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...listFiles(full));
    else if (EXTS.includes(path.extname(full))) out.push(full);
  }
  return out;
};

/** Résout un specifier relatif vers un fichier réel, ou `null` s'il sort du périmètre. */
const resolve = (fromFile: string, spec: string): string | null => {
  const base = path.resolve(path.dirname(fromFile), spec);
  if (existsSync(base) && statSync(base).isFile()) return base;
  for (const ext of EXTS) {
    if (existsSync(base + ext)) return base + ext;
  }
  for (const ext of EXTS) {
    const idx = path.join(base, `index${ext}`);
    if (existsSync(idx)) return idx;
  }
  return null;
};

/**
 * Arêtes d'un fichier — imports RELATIFS de valeur uniquement.
 *
 * `import type …` et `export type …` sont ignorés (effacés au build) ; les
 * specifiers de paquet (`react`, `nodefony/roles`) aussi, puisqu'ils ne peuvent
 * pas refermer un cycle interne.
 */
const edgesOf = (file: string): string[] => {
  const src = readFileSync(file, "utf8");
  const out = new Set<string>();
  // `import … from "x"`, `export … from "x"` — la marque `type` juste après le
  // mot-clé signe un import effacé.
  const re =
    /\b(import|export)\s+(type\s+)?([^;'"]*?)\bfrom\s*["']([^"']+)["']/g;
  for (const m of src.matchAll(re)) {
    const [, , typeKeyword, clause, spec] = m;
    if (typeKeyword) continue;
    if (!spec.startsWith(".")) continue;
    // `import { type A, type B } from "x"` : tous les specifiers sont des types
    // → aucune arête d'exécution. Un seul specifier de valeur suffit à en créer une.
    const named = clause.match(/\{([^}]*)\}/);
    if (named) {
      const parts = named[1]
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const hasValue = parts.some((p) => !p.startsWith("type "));
      const bareDefault = clause.replace(/\{[^}]*\}/, "").replace(/[,\s]/g, "");
      if (!hasValue && !bareDefault) continue;
    }
    const target = resolve(file, spec);
    if (target) out.add(target);
  }
  return [...out];
};

/** Cycles du graphe, chacun rendu comme la suite de fichiers qui le referme. */
const findCycles = (graph: Map<string, string[]>): string[][] => {
  const cycles: string[][] = [];
  const state = new Map<string, 0 | 1 | 2>(); // 0 neuf · 1 en cours · 2 clos
  const stack: string[] = [];

  const walk = (node: string): void => {
    state.set(node, 1);
    stack.push(node);
    for (const next of graph.get(node) ?? []) {
      const st = state.get(next) ?? 0;
      if (st === 1) {
        cycles.push([...stack.slice(stack.indexOf(next)), next]);
      } else if (st === 0) {
        walk(next);
      }
    }
    stack.pop();
    state.set(node, 2);
  };

  for (const node of graph.keys()) if ((state.get(node) ?? 0) === 0) walk(node);
  return cycles;
};

describe("frontend Studio — graphe d'imports sans cycle", () => {
  it("aucun cycle d'imports de VALEUR", () => {
    expect(existsSync(SRC), `sources introuvables : ${SRC}`).toBe(true);

    const files = listFiles(SRC);
    // Un `src` vide rendrait ce test vert sans avoir rien analysé.
    expect(files.length, "aucun fichier source analysé").toBeGreaterThan(20);

    const graph = new Map<string, string[]>();
    for (const f of files) graph.set(f, edgesOf(f));

    const cycles = findCycles(graph);
    const rendered = cycles.map((c) =>
      c.map((f) => path.relative(SRC, f)).join(" → "),
    );

    expect(
      rendered,
      rendered.length
        ? `cycle(s) d'imports — invisibles au premier chargement, fatals au ` +
            `rechargement à chaud (TDZ) :\n  ${rendered.join("\n  ")}`
        : "",
    ).toEqual([]);
  });
});
