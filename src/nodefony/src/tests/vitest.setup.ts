// Setup vitest du workspace core — porte ce que `.mocharc.cjs` faisait via mocha :
//   1. reflect-metadata (decorators DI : @injectable / @inject).
//   2. perf-skip OPT-IN : port fidèle du root hook `perf-skip.cjs`.
//   3. filet anti-fuite : les listeners `process` d'un test meurent avec lui.
import "reflect-metadata";
import { afterEach, beforeEach } from "vitest";

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

// ── Listeners `process` : ce qu'un test attache, le test le remporte ───────────
// Un `Cli` complet écoute sept événements de `process`. En production il y en a
// UN par process ; une suite en instancie des dizaines, et au 11ᵉ listener Node
// émet `MaxListenersExceededWarning` — dont la charge est l'objet `process`
// ENTIER, soit ~500 lignes par avertissement. Un seul job de CI en a produit
// 216 000, tronquées par GitHub : l'échec réel devenait illisible.
//
// Le filet est posé ici plutôt que dans chaque fabrique de test : une fabrique
// oubliée, ou écrite demain, réintroduirait le bruit sans que rien ne le dise.
// Il ne masque pas les fuites du PRODUIT — celles-là sont prouvées par le test
// dédié de `Cli.test.ts`, qui compte les listeners rendus.
const WATCHED_EVENTS = [
  "SIGINT",
  "SIGTERM",
  "SIGHUP",
  "SIGQUIT",
  "warning",
  "rejectionHandled",
  "unhandledRejection",
] as const;

let inherited: Map<string, Set<unknown>> | null = null;

beforeEach(() => {
  inherited = new Map(
    WATCHED_EVENTS.map((event) => [event, new Set(process.listeners(event))]),
  );
});

afterEach(() => {
  if (!inherited) {
    return;
  }
  for (const event of WATCHED_EVENTS) {
    const before = inherited.get(event);
    for (const listener of process.listeners(event)) {
      if (!before?.has(listener)) {
        process.removeListener(event, listener as () => void);
      }
    }
  }
  inherited = null;
});
