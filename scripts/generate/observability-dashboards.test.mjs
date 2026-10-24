/**
 * Les tableaux de bord d'exemple livrés aux applications sont GÉNÉRÉS : un
 * fichier retouché à la main, ou un générateur modifié sans régénérer, fait
 * diverger ce que le dépôt montre de ce qu'il livre.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const SCRIPT = path.join(ROOT, "scripts/generate/observability-dashboards.mjs");
const DIR = path.join(
  ROOT,
  "src/nodefony/templates/app/complete/docker/examples/dashboards",
);

describe("tableaux de bord d'exemple", () => {
  it("les fichiers livrés sont ceux que rend le générateur", () => {
    // --check sort en 1 si un exemple est périmé : execFileSync lève alors.
    expect(() =>
      execFileSync(process.execPath, [SCRIPT, "--check"], { stdio: "pipe" }),
    ).not.toThrow();
  });

  it("Grafana et OpenSearch portent les mêmes panneaux de vue d'ensemble", () => {
    const grafana = JSON.parse(
      readFileSync(path.join(DIR, "grafana-nodefony-logs.json.tpl"), "utf8"),
    );
    const stats = grafana.panels
      .filter((p) => p.type === "stat")
      .map((p) => p.title);
    const objects = readFileSync(
      path.join(DIR, "opensearch-nodefony-logs.ndjson.tpl"),
      "utf8",
    )
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    const metrics = objects
      .filter(
        (o) =>
          o.type === "visualization" &&
          JSON.parse(o.attributes.visState).type === "metric",
      )
      .map((o) => o.attributes.title);
    expect(metrics).toEqual(stats);
  });
});
