// Config monocart-coverage-reports — couverture @nodefony/http.
// Lancé via `npm run coverage` (= mcr wrappe la suite UNIT `npm run test`,
// exécutée in-process → mesurable).
//
// ⚠️ Les tests d'INTÉGRATION (`test:integration`) tapent un serveur Nodefony
// dans un **process séparé** : leur exécution du code http N'EST PAS captée par
// le wrapping du process mocha. Seule la suite unit est couverte. La suite de
// charge/mémoire (.mocharc.load.json) reste à part (cf CLAUDE.md).
const inModule = (url) =>
  typeof url === "string" &&
  url.includes("/@nodefony/http/") &&
  !url.includes("/node_modules/") &&
  !url.includes("/dist/");

export default {
  name: "@nodefony/http",
  reports: ["console-summary", "v8", "lcov"],
  outputDir: ".coverage",
  entryFilter: (entry) => inModule(entry && entry.url ? entry.url : String(entry)),
  sourceFilter: (sourcePath) =>
    typeof sourcePath === "string" &&
    sourcePath.endsWith(".ts") &&
    sourcePath.includes("/@nodefony/http/") &&
    !sourcePath.includes("/node_modules/") &&
    !sourcePath.includes("/tests/") &&
    !sourcePath.includes("/dist/"),
};
