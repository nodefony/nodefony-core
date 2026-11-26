/**
 * `/status` en panneau (`service/dev/devStatusPanel.ts`, #538 D9/D10) : le
 * rapport de `nodefony status`, rendu en rubriques.
 */
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildDevStatus } from "../service/dev/devStatusReport";
import { buildStatusPanel } from "../service/dev/devStatusPanel";
import type { DevProcessInfo } from "../service/dev/devProcess";

const root = path.join(path.sep, "projet");
const procs: DevProcessInfo[] = [
  {
    pid: 10,
    ppid: 1,
    mode: "dev",
    role: "supervisor",
    label: "supervisor",
    rssKb: 2048,
    cpu: 0.5,
    uptimeSec: 65,
  },
  {
    pid: 11,
    ppid: 10,
    mode: "dev",
    role: "vite",
    label: "vite",
    detail: "react+vue",
    rssKb: 1024,
    cpu: 1,
    uptimeSec: 60,
  },
];

describe("buildStatusPanel — le rapport de status en rubriques", () => {
  it("Résumé, Process, Ports — dans cet ordre", () => {
    const panel = buildStatusPanel(
      buildDevStatus(root, 10, true, procs, [{ port: 5151, listening: true }]),
    );
    expect(panel.id).to.equal("status");
    expect(panel.pages.map((p) => p.title)).to.deep.equal([
      "Résumé",
      "Process",
      "Ports",
    ]);
    expect(panel.pages[0]?.rows).to.deep.include({
      kind: "entry",
      key: "ports",
      value: "1/1 en écoute",
    });
  });

  it("une disponibilité non sondée ne se lit jamais « prête »", () => {
    const panel = buildStatusPanel(buildDevStatus(root, null, false, [], []));
    expect(panel.pages[0]?.rows).to.deep.include({
      kind: "entry",
      key: "disponibilité",
      value: "non sondée",
    });
    expect(panel.pages[0]?.rows).to.deep.include({
      kind: "entry",
      key: "état",
      value: "aucune instance",
    });
  });

  it("process : mêmes formats que `nodefony status`, les bundles Vite suivent le rôle", () => {
    const panel = buildStatusPanel(buildDevStatus(root, 10, true, procs, []));
    const [table] = panel.pages[1]?.rows ?? [];
    expect(table).to.deep.equal({
      kind: "table",
      head: ["rôle", "pid", "ppid", "uptime", "rss", "%cpu"],
      rows: [
        ["supervisor", "10", "1", "1m05s", "2.0 MB", "0.5"],
        ["vite (react, vue)", "11", "10", "1m00s", "1.0 MB", "1.0"],
      ],
    });
  });

  it("les avertissements du rapport passent tels quels, sous leur intertitre", () => {
    // Pidfile mort : le rapport l'avertit.
    const report = buildDevStatus(root, 99, false, procs, []);
    const panel = buildStatusPanel(report);
    expect(report.warnings.length).to.be.greaterThan(0);
    expect(panel.pages[0]?.rows).to.deep.include({
      kind: "heading",
      text: "Avertissements",
    });
    expect(panel.pages[0]?.rows).to.deep.include({
      kind: "text",
      text: `⚠ ${report.warnings[0]}`,
    });
  });
});
