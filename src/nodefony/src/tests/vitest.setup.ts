// Setup vitest du workspace core — porte ce que `.mocharc.cjs` faisait via mocha :
//   1. reflect-metadata (decorators DI : @injectable / @inject).
//   2. compat mocha : `before`/`after` → `beforeAll`/`afterAll` (vitest ne fournit
//      que beforeAll/afterAll ; les tests core utilisent les hooks mocha before/after).
//   3. perf-skip OPT-IN : port fidèle du root hook `perf-skip.cjs`.
import "reflect-metadata";
import { beforeAll, afterAll, beforeEach } from "vitest";

const g = globalThis as Record<string, unknown>;
g.before ??= beforeAll;
g.after ??= afterAll;

// ── Perf-skip (port de src/tests/perf-skip.cjs) ────────────────────────────────
// Les tests de perf (titre à seuil "< Nms" OU sous un describe `performance`) sont
// OPT-IN : skippés par défaut et en CI (microbench non déterministe en fin de suite,
// cf TSDoc de l'original), exécutés seulement avec RUN_PERF=1. Même regex.
const PERF_TITLE = /<\s*\d[\d\s]*ms|\bperformance\b/i;

interface TaskLike {
  name?: string;
  suite?: TaskLike;
}

// Nom complet "describe > … > it" en remontant la chaîne des suites du task vitest
// (équivalent de `this.currentTest.fullTitle()` mocha).
const fullName = (task: TaskLike | undefined): string => {
  const parts: string[] = [];
  let t: TaskLike | undefined = task;
  while (t) {
    if (t.name) parts.unshift(t.name);
    t = t.suite;
  }
  return parts.join(" ");
};

beforeEach((ctx) => {
  if (
    (process.env.CI || !process.env.RUN_PERF) &&
    PERF_TITLE.test(fullName(ctx.task as unknown as TaskLike))
  ) {
    ctx.skip();
  }
});
