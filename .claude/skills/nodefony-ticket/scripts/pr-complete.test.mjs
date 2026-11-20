import { describe, expect, it } from "vitest";
import { planPrCompletion, referencedIssues } from "./pr-complete.mjs";

const ISSUE = {
  number: 797,
  milestone: { title: "10.0.x" },
  labels: [{ name: "10.0.1" }],
};
const BARE = {
  number: 799,
  body: "Refs #797\n\nLe corps.",
  baseRefName: "release/10.0.x",
  headRefName: "fix/797-generated-home-styles",
  assignees: [],
  labels: [],
  milestone: null,
  projectItems: [],
  closingIssuesReferences: [],
};
const CTX = { defaultBranch: "dev", projectTitle: "Nodefony" };
const kinds = (plan) => plan.actions.map((a) => `${a.kind}:${a.value}`);

describe("pr-complete — remplir la colonne de droite d'une pull request", () => {
  it("lit les tickets au corps et en tête de branche, sans doublon", () => {
    expect(referencedIssues(BARE)).toEqual([797]);
    expect(
      referencedIssues({
        body: "Closes #12, fixes #13",
        headRefName: "feat/14-x",
      }),
    ).toEqual([12, 13, 14]);
    expect(referencedIssues({ body: "voir #5", headRefName: "dev" })).toEqual(
      [],
    );
  });

  it("une PR nue reçoit responsable, jalon, lot et tableau tirés de son ticket", () => {
    const plan = planPrCompletion({ ...CTX, pr: BARE, issues: [ISSUE] });
    expect(kinds(plan)).toEqual([
      "assignee:@me",
      "milestone:10.0.x",
      "label:10.0.1",
      "project:Nodefony",
    ]);
  });

  it("vers une branche de release, le lien « Development » est DIT impossible, jamais tenté", () => {
    const plan = planPrCompletion({ ...CTX, pr: BARE, issues: [ISSUE] });
    expect(kinds(plan).some((k) => k.startsWith("closes:"))).toBe(false);
    expect(plan.notes.join("\n")).toMatch(/À LA MAIN vers release\/10\.0\.x/u);
    expect(plan.notes.join("\n")).toMatch(/fermer à la main/u);
  });

  it("vers la branche par défaut, le ticket non relié reçoit son « Closes »", () => {
    const plan = planPrCompletion({
      ...CTX,
      pr: { ...BARE, baseRefName: "dev" },
      issues: [ISSUE],
    });
    expect(kinds(plan)).toContain("closes:#797");
  });

  it("une PR complète ne reçoit aucun geste", () => {
    const plan = planPrCompletion({
      ...CTX,
      pr: {
        ...BARE,
        baseRefName: "dev",
        assignees: [{ login: "x" }],
        labels: [{ name: "10.0.1" }],
        milestone: { title: "10.0.x" },
        projectItems: [{ title: "Nodefony" }],
        closingIssuesReferences: [{ number: 797 }],
      },
      issues: [ISSUE],
    });
    expect(plan.actions).toEqual([]);
  });

  it("des tickets de jalons différents : le jalon n'est pas deviné", () => {
    const plan = planPrCompletion({
      ...CTX,
      pr: BARE,
      issues: [
        ISSUE,
        { number: 9, milestone: { title: "10.1.0" }, labels: [] },
      ],
    });
    expect(kinds(plan).some((k) => k.startsWith("milestone:"))).toBe(false);
    expect(plan.notes.join("\n")).toMatch(/plusieurs \(10\.0\.x, 10\.1\.0\)/u);
  });
});
