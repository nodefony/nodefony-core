// Root hook Mocha : en CI, SKIP les tests de perf. Sur des runners partagés
// (GitHub Actions) le temps CPU n'est pas déterministe → seuils temporels ET
// gros volumes (200k merges) flakent / timeout et rougissent la CI (ex. observé :
// "10k no-DI took 302.9ms" > 200ms ; "200k merges" > timeout 2000ms sur Node 22).
// On skippe :
//   1. les titres à seuil absolu ("... < 200ms"),
//   2. TOUT test sous un describe `performance` (même convention que le script
//      `coverage` qui fait `--grep performance --invert`).
// Les perfs se mesurent en local / bench dédié, pas comme gate CI. En local
// (CI non défini) ils tournent normalement.
const PERF_TITLE = /<\s*\d[\d\s]*ms|\bperformance\b/i;

exports.mochaHooks = {
  beforeEach() {
    if (
      process.env.CI &&
      this.currentTest &&
      PERF_TITLE.test(this.currentTest.fullTitle())
    ) {
      this.skip();
    }
  },
};
