// Config monocart-coverage-reports — couverture @nodefony/framework.
// Lancé via `npm run coverage` (= mcr wrappe la suite UNIT `npm run test`,
// exécutée in-process → mesurable).
//
// ⚠️ Les tests d'INTÉGRATION (`test:integration`) tapent un serveur Nodefony
// dans un **process séparé** : leur exécution du code framework N'EST PAS
// captée par le wrapping du process mocha. Seule la suite unit est couverte.
// (Même outil que le core — c8 KO en ESM/Node récent, cf CLAUDE.md.)
const inModule = (url) =>
  typeof url === "string" &&
  url.includes("/@nodefony/framework/") &&
  !url.includes("/node_modules/") &&
  !url.includes("/dist/");

export default {
  name: "@nodefony/framework",
  reports: ["console-summary", "v8", "lcov"],
  outputDir: ".coverage",
  entryFilter: (entry) => inModule(entry && entry.url ? entry.url : String(entry)),
  sourceFilter: (sourcePath) =>
    typeof sourcePath === "string" &&
    sourcePath.endsWith(".ts") &&
    sourcePath.includes("/@nodefony/framework/") &&
    !sourcePath.includes("/node_modules/") &&
    !sourcePath.includes("/tests/") &&
    !sourcePath.includes("/dist/"),
};
