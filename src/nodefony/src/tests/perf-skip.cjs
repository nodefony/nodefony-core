// Root hook Mocha : en CI, SKIP les tests de perf à seuil temporel absolu
// (titre du genre "... < 200ms"). Sur des runners partagés (GitHub Actions) le
// temps CPU n'est pas déterministe → ces seuils flakent et rougissent la CI
// (ex. observé : "10k no-DI took 302.9ms" > 200ms). Les perfs se mesurent en
// local / bench dédié, pas comme gate CI. En local (CI non défini) ils tournent.
const PERF_TITLE = /<\s*\d[\d\s]*ms/i;

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
