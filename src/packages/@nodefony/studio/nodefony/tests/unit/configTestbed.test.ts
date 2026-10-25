/**
 * Unit — onglet « Décors » de la page Configuration
 * (`frontend/src/routes/config/testbedModel.ts`).
 *
 * Les compteurs se lisent dans le rapport (jamais écrits à la main), un décor
 * « à monter » l'est aussi quand le SERVEUR manque d'une variable, et le filtre
 * range les boîtes par famille sans laisser de famille vide.
 */
import { describe, expect, it } from "vitest";
import {
  groupTestbeds,
  needsWork,
  playedByText,
  summarize,
  type TestbedBox,
  type TestbedReport,
} from "../../../frontend/src/routes/config/testbedModel";

const box = (over: Partial<TestbedBox>): TestbedBox => ({
  id: "x",
  label: "X",
  family: "database",
  purpose: "",
  state: "ready",
  services: [],
  vars: [],
  sharedWith: [],
  server: null,
  suites: [],
  playedBy: "default",
  phase: null,
  upCommand: null,
  note: null,
  ...over,
});

const report: TestbedReport = {
  supported: true,
  generatedAt: "2026-10-25T00:00:00Z",
  docker: true,
  testbeds: [
    box({ id: "pg" }),
    box({
      id: "kc",
      family: "identity",
      server: { required: ["A"], missing: ["A"] },
    }),
    box({ id: "proxy", family: "network", state: "down", playedBy: "manual" }),
  ],
  switches: [
    { env: "NF_RUN_PERF", what: "", open: true, suites: [] },
    { env: "NF_RUN_X", what: "", open: false, suites: [] },
  ],
  tools: [
    {
      service: "grafana",
      label: "",
      what: "",
      oneShot: false,
      state: "running",
    },
    { service: "kafka", label: "", what: "", oneShot: false, state: "absent" },
    { service: "init", label: "", what: "", oneShot: true, state: "stopped" },
  ],
  blindSpots: [],
};

describe("Décors — modèle de l'onglet", () => {
  it("un conteneur prêt mais un serveur sans sa variable reste « à monter »", () => {
    expect(needsWork(report.testbeds[1]!)).toBe(true);
    expect(needsWork(report.testbeds[0]!)).toBe(false);
  });

  it("compte depuis le rapport ; une tâche unique n'est pas un outil éteint", () => {
    expect(summarize(report)).toEqual({
      ready: 2,
      total: 3,
      todo: 2,
      switchesOpen: 1,
      switchesTotal: 2,
      toolsUp: 1,
      toolsTotal: 2,
    });
  });

  it("range par famille dans l'ordre d'affichage, sans famille vide", () => {
    expect(groupTestbeds(report.testbeds, "all").map((g) => g.family)).toEqual([
      "database",
      "identity",
      "network",
    ]);
    expect(
      groupTestbeds(report.testbeds, "todo").flatMap((g) =>
        g.boxes.map((b) => b.id),
      ),
    ).toEqual(["kc", "proxy"]);
    expect(
      groupTestbeds(report.testbeds, "ready").flatMap((g) =>
        g.boxes.map((b) => b.id),
      ),
    ).toEqual(["pg"]);
  });

  it("dit qui lève le décor", () => {
    expect(playedByText(box({ playedBy: "phase", phase: "--mongo" }))).toBe(
      "levé par npm run test:all -- --mongo",
    );
    expect(playedByText(box({ playedBy: "manual" }))).toMatch(/personne/);
  });
});
