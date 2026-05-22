// Charge le root hook qui skip les tests de perf (seuils temporels) en CI.
// Le script `test` passe les globs en CLI ; mocha lit ce fichier dans le CWD.
module.exports = {
  require: ["./src/tests/perf-skip.cjs"],
};
