// Root hook Mocha : SKIP les tests de perf par DÉFAUT — ils sont OPT-IN (`RUN_PERF=1`).
// Pourquoi : un micro-bench à seuil temporel ne mesure rien de fiable DANS la suite
// (CPU non déterministe : CI sur runners partagés ; en local l'event-loop est chargé
// par les ~1300 tests précédents → machine chaude + GC → faux échec, ex. observé :
// "extend 50k deep took 536ms" > 500ms isolé ~162ms ; "200k merges" > timeout 2000ms).
// La perf se mesure ISOLÉE / bench dédié (skill `nodefony-load-test`), JAMAIS comme gate
// de suite. Cf doc Node « Don't Block the Event Loop » (mesure = event-loop latency + p99
// sous charge, pas un microbench en fin de suite).
// On skippe :
//   1. les titres à seuil absolu ("... < 200ms"),
//   2. TOUT test sous un describe `performance` (même convention que le script
//      `coverage` qui fait `--grep performance --invert`).
// → `npm test` est DÉTERMINISTE (0 faux failing) ; `RUN_PERF=1 npm test` exécute les perfs.
const PERF_TITLE = /<\s*\d[\d\s]*ms|\bperformance\b/i;

exports.mochaHooks = {
  beforeEach() {
    // Skip si CI OU si l'opt-in RUN_PERF n'est pas demandé (défaut local = skip).
    if (
      (process.env.CI || !process.env.RUN_PERF) &&
      this.currentTest &&
      PERF_TITLE.test(this.currentTest.fullTitle())
    ) {
      this.skip();
    }
  },
};
