/**
 * Éprouve la voie de fusion de `pr-finish.mjs` : la fusion automatique n'est
 * prise que si elle ATTEND vraiment la CI — sans check exigé, `--auto`
 * fusionnerait tout de suite, CI rouge comprise.
 */
import { describe, expect, it } from "vitest";
import { mergePlan, watchCommand } from "./pr-finish.mjs";

describe("mergePlan — fusion automatique seulement si elle attend la CI", () => {
  it("dépôt autorisé ET checks exigés → auto", () => {
    expect(mergePlan({ allowAutoMerge: true, requiredChecks: 12 }).mode).toBe(
      "auto",
    );
  });

  it("base non protégée → surveillance, même si le dépôt autorise", () => {
    const plan = mergePlan({ allowAutoMerge: true, requiredChecks: null });
    expect(plan.mode).toBe("watch");
    expect(plan.reason).toMatch(/non protégée/);
  });

  it("protection sans check exigé → surveillance", () => {
    expect(mergePlan({ allowAutoMerge: true, requiredChecks: 0 }).mode).toBe(
      "watch",
    );
  });

  it("fusion automatique désactivée → surveillance, quelle que soit la protection", () => {
    const plan = mergePlan({ allowAutoMerge: false, requiredChecks: 12 });
    expect(plan.mode).toBe("watch");
    expect(plan.reason).toMatch(/désactivée/);
  });
});

describe("watchCommand", () => {
  it("attend les checks puis fusionne en squash, et s'arrête au premier rouge", () => {
    expect(watchCommand(805)).toBe(
      "gh pr checks 805 --watch --fail-fast && gh pr merge 805 --squash --delete-branch",
    );
  });
});
