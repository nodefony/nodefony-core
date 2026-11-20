/**
 * Éprouve la voie de fusion de `pr-finish.mjs` : la fusion automatique n'est
 * prise que si elle ATTEND vraiment la CI — sans check exigé, `--auto`
 * fusionnerait tout de suite, CI rouge comprise.
 */
import { describe, expect, it } from "vitest";
import {
  finishBlockers,
  mergePlan,
  squashMessage,
  watchCommand,
} from "./pr-finish.mjs";

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
  it("relance pr-finish en surveillance — le message de squash est composé par le script, pas par un shell", () => {
    expect(watchCommand(805)).toBe(
      "node .claude/skills/nodefony-ticket/scripts/pr-finish.mjs 805 --merge-when-green",
    );
  });
});

describe("squashMessage — LE commit que lira le changelog", () => {
  const pr = {
    title: "fix(http): libérer le scope d'un HEAD",
    number: 812,
    body: "Ouverte en brouillon par ticket-start.\n\nRefs #794\n",
    commits: [
      "fix(http): ouvrir le travail sur #794 [skip ci]",
      "fix(http): libérer le scope\n\ncorps détaillé",
      "fix(http): wip — reste le test [skip ci]",
      "test(http): voir le scope libéré",
    ],
  };

  it("sujet = titre (#PR) ; corps = commits de travail puis ligne de ticket", () => {
    expect(squashMessage(pr)).toEqual({
      subject: "fix(http): libérer le scope d'un HEAD (#812)",
      body: "- fix(http): libérer le scope\n- test(http): voir le scope libéré\n\nRefs #794",
    });
  });

  it("ne recopie JAMAIS un marqueur skip-ci — il couperait la CI de la branche longue", () => {
    expect(squashMessage(pr).body).not.toMatch(/\[skip ci\]/u);
  });

  it("garde « Closes #N » vers dev", () => {
    expect(
      squashMessage({ ...pr, body: "Closes #900", commits: [] }).body,
    ).toBe("Closes #900");
  });
});

describe("finishBlockers — refuser avant tout geste", () => {
  it("une tête marquée skip-ci : attente sans fin", () => {
    expect(
      finishBlockers({
        headMessage: "fix(x): wip — y [skip ci]",
        mergeStateStatus: "CLEAN",
      }),
    ).toHaveLength(1);
  });

  it("une PR en conflit", () => {
    expect(
      finishBlockers({
        headMessage: "fix(x): y",
        mergeStateStatus: "DIRTY",
      })[0],
    ).toContain("CONFLIT");
  });

  // PIÈGE : la fusion arrière release/x.y.x → dev squashée ne rendrait pas la
  // maintenance ancêtre de dev — la publication suivante resterait refusée.
  it("une PR qui embarque une release/* : jamais de squash", () => {
    const [motif] = finishBlockers({
      headMessage: "Merge remote-tracking branch 'origin/release/10.0.x'",
      mergeStateStatus: "CLEAN",
      carried: ["release/10.0.x"],
    });
    expect(motif).toContain("release/10.0.x");
    expect(motif).toContain("release-sync.mjs");
  });

  it("rien à dire sur une tête de travail sans conflit", () => {
    expect(
      finishBlockers({ headMessage: "fix(x): y", mergeStateStatus: "BLOCKED" }),
    ).toEqual([]);
  });
});
