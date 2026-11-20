/**
 * Éprouve les lignes « branche et PR » de la reprise (#796) : branche longue,
 * branche sans PR, branche avec PR et checks rouges — et le rattrapage des PR
 * fusionnées dont le ticket est resté ouvert.
 */
import { describe, expect, it } from "vitest";
import {
  branchLines,
  checksVerdict,
  diffSummary,
  isLongBranch,
  mergedButOpen,
} from "./branch-status.mjs";

const base = { vsBase: null, pushed: true, diff: "", dirty: 0, parked: [] };

describe("isLongBranch", () => {
  it("main, dev et release/x.y.x sont longues ; une branche de ticket non", () => {
    expect(isLongBranch("dev")).toBe(true);
    expect(isLongBranch("main")).toBe(true);
    expect(isLongBranch("release/10.0.x")).toBe(true);
    expect(isLongBranch("fix/794-http2-head-scope")).toBe(false);
    expect(isLongBranch("release/10.0.x-old")).toBe(false);
  });
});

describe("checksVerdict", () => {
  it("nomme les rouges ; un annulé n'est pas rouge ; sans conclusion = en cours", () => {
    const v = checksVerdict([
      { name: "unit", status: "COMPLETED", conclusion: "SUCCESS" },
      { name: "browser", status: "COMPLETED", conclusion: "FAILURE" },
      { name: "old", status: "COMPLETED", conclusion: "CANCELLED" },
      { name: "slow", status: "IN_PROGRESS", conclusion: "" },
    ]);
    expect(v.icon).toBe("❌");
    expect(v.red).toEqual(["browser"]);
    expect(v.pending).toBe(1);
  });

  it("tout vert → ✅ ; rien → aucun check (jamais un faux vert)", () => {
    expect(
      checksVerdict([{ status: "COMPLETED", conclusion: "SUCCESS" }]).icon,
    ).toBe("✅");
    expect(checksVerdict([]).icon).toBe("· aucun check");
  });
});

describe("diffSummary", () => {
  it("compte fichiers et lignes, nomme les plus touchés, tolère un binaire", () => {
    const s = diffSummary("10\t2\ta/x.mjs\n-\t-\timg.png\n100\t50\tb/y.mjs\n");
    expect(s).toBe(
      "3 fichier(s), +110 −52 · plus touchés : y.mjs, x.mjs, img.png",
    );
  });

  it("rien → le dit", () => {
    expect(diffSummary("")).toBe("aucun fichier modifié");
  });
});

describe("branchLines", () => {
  it("branche longue : consigne ticket-start, et les tickets mis de côté", () => {
    const lines = branchLines({
      ...base,
      branch: "dev",
      pr: null,
      parked: [{ number: 805, headRefName: "chore/796-branch-and-pr-first" }],
    });
    expect(lines[0]).toMatch(/branche LONGUE.*ticket-start/);
    expect(lines[1]).toMatch(/Mis de côté.*#805 chore\/796/);
  });

  it("branche de travail sans PR : dit de la rouvrir par ticket-start", () => {
    const lines = branchLines({ ...base, branch: "fix/794-x", pr: null });
    expect(lines[0]).toMatch(/AUCUNE PR/);
  });

  it("branche dont la PR est FUSIONNÉE : la dit finie et rend le retour à la base, jamais ticket-start", () => {
    const lines = branchLines({
      ...base,
      branch: "fix/794-x",
      pr: null,
      merged: { number: 803, baseRefName: "release/10.0.x" },
    });
    expect(lines[0]).toMatch(/PR #803 FUSIONNÉE dans release\/10\.0\.x/u);
    expect(lines[0]).toContain(
      "git switch release/10.0.x && git pull --ff-only && git branch -D fix/794-x",
    );
    expect(lines[0]).not.toContain("ticket-start");
    const sale = branchLines({
      ...base,
      branch: "fix/794-x",
      pr: null,
      dirty: 2,
      merged: { number: 803, baseRefName: "dev" },
    });
    expect(sale[0]).toContain("non commités : 2");
  });

  it("branche avec PR rouge : base, avance, rouges nommés, fichiers, non poussée", () => {
    const lines = branchLines({
      branch: "fix/794-x",
      pr: {
        number: 812,
        isDraft: false,
        baseRefName: "release/10.0.x",
        url: "https://x/812",
        statusCheckRollup: [
          { name: "unit", status: "COMPLETED", conclusion: "FAILURE" },
        ],
      },
      vsBase: { ahead: 3, behind: 1 },
      pushed: false,
      diff: "2 fichier(s), +5 −1 · plus touchés : a.ts",
      dirty: 2,
      parked: [],
    });
    expect(lines[0]).toBe(
      "🌿 fix/794-x → release/10.0.x · +3/−1 sur origin/release/10.0.x · NON poussée ⚠️",
    );
    expect(lines[1]).toMatch(/^ {3}PR #812 prête ❌ rouge : unit/);
    expect(lines[2]).toBe(
      "   2 fichier(s), +5 −1 · plus touchés : a.ts · non commités : 2",
    );
  });
});

describe("mergedButOpen", () => {
  it("rend le ticket encore ouvert d'une PR fusionnée, par Refs ou par nom de branche", () => {
    const merged = [
      { number: 804, body: "Refs #802", headRefName: "chore/802-deps-patches" },
      { number: 799, body: "Refs #797", headRefName: "fix/797-x" },
      { number: 810, body: "", headRefName: "fix/808-y" },
    ];
    const items = [
      { number: 802, state: "OPEN" },
      { number: 797, state: "CLOSED" },
      { number: 808, state: "OPEN" },
    ];
    expect(mergedButOpen(merged, items)).toEqual([
      { pr: 804, ticket: 802 },
      { pr: 810, ticket: 808 },
    ]);
  });
});
