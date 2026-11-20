/**
 * Éprouve la garde `commit-msg` du travail en demandes de fusion (#796).
 */
import { describe, expect, it } from "vitest";
import { commitGuard } from "./commit-guard.mjs";

const ok = { allowLongBranch: false };

describe("commitGuard — branche longue", () => {
  it("refuse un commit de travail sur dev, main et release/x.y.x", () => {
    for (const branch of ["dev", "main", "release/10.0.x"]) {
      expect(
        commitGuard({ ...ok, branch, message: "fix(http): corriger x" }),
      ).toHaveLength(1);
    }
  });

  it("accepte l'estampille de publication sur une branche longue", () => {
    expect(
      commitGuard({
        ...ok,
        branch: "release/10.0.x",
        message: "chore(release): 10.0.1",
      }),
    ).toEqual([]);
  });

  it("accepte tout commit sur une branche de ticket, et une tête détachée", () => {
    expect(
      commitGuard({
        ...ok,
        branch: "fix/794-http2-head-scope",
        message: "fix(http): x",
      }),
    ).toEqual([]);
    expect(commitGuard({ ...ok, branch: "", message: "fix(http): x" })).toEqual(
      [],
    );
  });

  it("l'échappatoire nommée laisse passer l'amorçage", () => {
    expect(
      commitGuard({
        branch: "dev",
        message: "fix(http): x",
        allowLongBranch: true,
      }),
    ).toEqual([]);
  });
});

describe("commitGuard — marqueur skip-ci", () => {
  const branch = "chore/796-branch-and-pr-first";

  it("refuse le marqueur dans le CORPS d'un commit de travail — le cas vécu de la PR #805", () => {
    const message =
      "feat(pilotage): entamer un ticket\n\ncommit vide `chore: ouvrir le travail sur #N [skip ci]`\n";
    expect(commitGuard({ ...ok, branch, message })).toHaveLength(1);
  });

  it("refuse toutes les variantes reconnues par GitHub", () => {
    for (const m of [
      "[ci skip]",
      "[no ci]",
      "[skip actions]",
      "[actions skip]",
      "[SKIP CI]",
    ]) {
      expect(
        commitGuard({ ...ok, branch, message: `fix(x): y ${m}` }),
      ).toHaveLength(1);
    }
  });

  it("accepte la mise de côté et l'ouverture, et ignore les lignes de commentaire", () => {
    expect(
      commitGuard({
        ...ok,
        branch,
        message: "fix(http): wip — reste le test [skip ci]",
      }),
    ).toEqual([]);
    expect(
      commitGuard({
        ...ok,
        branch,
        message: "chore(pilotage): ouvrir le travail sur #796 [skip ci]",
      }),
    ).toEqual([]);
    expect(
      commitGuard({
        ...ok,
        branch,
        message: "fix(x): y\n# [skip ci] dans un commentaire git\n",
      }),
    ).toEqual([]);
  });

  it("parler de « skip-ci » sans crochets est permis", () => {
    expect(
      commitGuard({
        ...ok,
        branch,
        message: "docs(x): expliquer le marqueur skip-ci",
      }),
    ).toEqual([]);
  });
});
