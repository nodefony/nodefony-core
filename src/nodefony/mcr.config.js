// Config monocart-coverage-reports — couverture du core @nodefony (src/nodefony).
// Lancé via `npm run coverage`.
// - entryFilter : fichiers exécutés (JS/V8) — on ne garde que le core, exclut node_modules.
// - sourceFilter : sources TS résolues via sourcemap — exclut tests + node_modules.
const inCore = (url) =>
  typeof url === "string" &&
  url.includes("/src/nodefony/") &&
  !url.includes("/node_modules/");

export default {
  name: "nodefony core",
  reports: ["console-summary", "v8", "lcov"],
  outputDir: ".coverage",
  entryFilter: (entry) => inCore(entry && entry.url ? entry.url : String(entry)),
  sourceFilter: (sourcePath) =>
    typeof sourcePath === "string" &&
    sourcePath.endsWith(".ts") &&
    !sourcePath.includes("/node_modules/") &&
    !sourcePath.includes("/tests/"),
};
