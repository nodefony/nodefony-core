// Charge le root hook qui skip les tests de perf (seuils temporels) en CI.
// Spec + loader tsx ici (et non en CLI) pour rester cross-platform : l'ancien
// script `tsx $(node -e ...)` utilisait une substitution bash `$(...)` qui
// casse sous cmd.exe Windows. mocha lit ce fichier dans le CWD.
module.exports = {
  require: ["./src/tests/perf-skip.cjs"],
  spec: ["src/tests/**/*.test.ts", "src/tests/*.test.ts"],
  extension: ["ts"],
  "node-option": ["import=tsx"],
};
