/**
 * Éprouve la voie de fusion de `pr-finish.mjs` : la fusion automatique n'est
 * prise que si elle ATTEND vraiment la CI — sans check exigé, `--auto`
 * fusionnerait tout de suite, CI rouge comprise.
 */
import { describe, expect, it } from "vitest";
import {
  closeReminder,
  countRequiredChecks,
  finishBlockers,
  finishNotices,
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

  it("garde un commit de travail dont le CORPS cite le marqueur, sans recopier le marqueur (revue #796, N4)", () => {
    const { body } = squashMessage({
      ...pr,
      commits: [
        "feat(pilotage): entamer un ticket\n\ncommit vide `chore: x [skip ci]`",
      ],
    });
    expect(body).toContain("- feat(pilotage): entamer un ticket");
    expect(body).not.toMatch(/\[skip ci\]/u);
  });

  it("une rupture et un « Closes » d'un commit de travail survivent au squash — en pieds", () => {
    const { body } = squashMessage({
      ...pr,
      commits: [
        "feat(http)!: retirer y\n\ndétail\n\nBREAKING CHANGE: y disparaît\nCloses #753",
        "fix(http): z\n\nCloses #753",
      ],
    });
    expect(body).toBe(
      "- feat(http)!: retirer y\n- fix(http): z\n\nRefs #794\nBREAKING CHANGE: y disparaît\nCloses #753",
    );
    // Un pied sans « ! » au sujet : le « ! » est posé sur SA ligne.
    const { body: b2 } = squashMessage({
      ...pr,
      commits: ["fix(http): a", "refactor(orm): c\n\nBREAKING CHANGE: c casse"],
    });
    expect(b2).toContain("- fix(http): a\n- refactor(orm)!: c");
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

describe("squashMessage — le périmètre se juge PAR COMMIT (#796, revue N1)", () => {
  it("un commit d'outillage part dans un paragraphe indenté que le changelog ne lit pas", () => {
    const { body } = squashMessage({
      title: "chore(pilotage): flux par PR",
      number: 805,
      body: "Refs #796",
      commits: [
        { message: "fix(cli): nommer le caractère invisible", published: true },
        { message: "fix(release): promotion relancée", published: false },
      ],
    });
    expect(body).toBe(
      "- fix(cli): nommer le caractère invisible\n\n" +
        "Outillage du dépôt (hors paquets publiés) :\n  fix(release): promotion relancée\n\n" +
        "Refs #796",
    );
  });
});

describe("countRequiredChecks — protection classique ET rulesets (#796, revue B3)", () => {
  it("ni protection ni règle de checks → null (fusion automatique interdite)", () => {
    expect(countRequiredChecks({ protection: null, rules: [] })).toBeNull();
    expect(
      countRequiredChecks({ protection: null, rules: [{ type: "deletion" }] }),
    ).toBeNull();
  });

  it("un ruleset seul compte — l'oublier laissait --auto fusionner sur un rouge", () => {
    expect(
      countRequiredChecks({
        protection: null,
        rules: [
          {
            type: "required_status_checks",
            parameters: { required_status_checks: [{ context: "ci-ok" }] },
          },
        ],
      }),
    ).toBe(1);
  });

  it("les deux sources se cumulent", () => {
    expect(
      countRequiredChecks({
        protection: 2,
        rules: [
          {
            type: "required_status_checks",
            parameters: { required_status_checks: [{ context: "ci-ok" }] },
          },
        ],
      }),
    ).toBe(3);
  });
});

describe("finishNotices — ce que l'état de fusion dit sans interdire (#796, revue B2)", () => {
  it("BEHIND, BLOCKED, UNSTABLE et UNKNOWN se disent ; CLEAN se tait", () => {
    for (const s of ["BEHIND", "BLOCKED", "UNSTABLE", "UNKNOWN"])
      expect(
        finishNotices({ mergeStateStatus: s, base: "release/10.0.x" }),
      ).toHaveLength(1);
    expect(finishNotices({ mergeStateStatus: "CLEAN", base: "dev" })).toEqual(
      [],
    );
    expect(
      finishNotices({ mergeStateStatus: "BEHIND", base: "dev" })[0],
    ).toContain("git merge origin/dev");
  });
});

describe("closeReminder — vers release/*, la fusion ne ferme rien (#796, revue G1)", () => {
  it("Refs #N → rappel avec la commande de fermeture", () => {
    const r = closeReminder({
      body: "Ouverte par ticket-start.\n\nRefs #794\n",
    });
    expect(r).toContain("ne ferme PAS #794");
    expect(r).toContain("ticket-close.mjs 794");
  });

  it("un corps en fins de ligne CRLF (édité sur le web) est lu aussi", () => {
    expect(closeReminder({ body: "Ouverte.\r\n\r\nRefs #794\r\n" })).toContain(
      "#794",
    );
  });

  it("Closes #N (vers dev) → rien à rappeler", () => {
    expect(closeReminder({ body: "Closes #900" })).toBeNull();
  });
});
