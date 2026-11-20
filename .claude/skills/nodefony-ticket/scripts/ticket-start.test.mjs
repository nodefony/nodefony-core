/**
 * Éprouve les règles PURES de `ticket-start.mjs` — les décisions 2, 3 et 4 de
 * #796 : le nom de la branche, sa base, le corps de la PR, et le commit vide
 * qui l'ouvre sans lancer de CI.
 */
import { describe, expect, it } from "vitest";
import {
  baseFor,
  branchName,
  commitPrefix,
  openingCommitMessage,
  prBody,
  ticketBranches,
} from "./ticket-start.mjs";

const REMOTE = ["dev", "main", "release/10.0.x"];

describe("branchName — <type>/<N>-<sujet>", () => {
  it("prend le type du titre du ticket", () => {
    expect(
      branchName(
        "fix(http): corriger le scope de HEAD en HTTP/2",
        794,
        "http2-head-scope",
      ),
    ).toBe("fix/794-http2-head-scope");
    expect(
      branchName("feat(orm)!: livrer les migrations", 12, "schema-migrations"),
    ).toBe("feat/12-schema-migrations");
  });

  it("refuse un sujet non ASCII, hors kebab-case, vide ou trop long", () => {
    const t = "chore(pilotage): x";
    expect(() => branchName(t, 1, "accès-réseau")).toThrow(/invalide/);
    expect(() => branchName(t, 1, "Http2_Head")).toThrow(/invalide/);
    expect(() => branchName(t, 1, "")).toThrow(/invalide/);
    expect(() => branchName(t, 1, undefined)).toThrow(/invalide/);
    expect(() => branchName(t, 1, "a".repeat(41))).toThrow(/trop long/);
    expect(branchName(t, 1, "a".repeat(40))).toBe(`chore/1-${"a".repeat(40)}`);
  });

  it("refuse un titre hors Conventional Commits", () => {
    expect(() => commitPrefix("Le hub publie mocha")).toThrow(/Conventional/);
    expect(() => commitPrefix("wip: à moitié")).toThrow(/Conventional/);
  });
});

describe("baseFor — jalon de correctif → release/x.y.x, sinon dev", () => {
  it("un jalon de correctif part de sa branche de maintenance", () => {
    expect(baseFor("10.0.x", REMOTE)).toBe("release/10.0.x");
    expect(baseFor("10.0.2", REMOTE)).toBe("release/10.0.x");
  });

  it("une mineure, une majeure ou le backlog partent de dev", () => {
    expect(baseFor("10.1.0", REMOTE)).toBe("dev");
    expect(baseFor("11.0.0", REMOTE)).toBe("dev");
    expect(baseFor(null, REMOTE)).toBe("dev");
    expect(baseFor("outillage-agents", REMOTE)).toBe("dev");
  });

  it("l'outillage de PILOTAGE part de la plus ancienne branche de maintenance, quel que soit son jalon", () => {
    const remote = ["dev", "release/10.10.x", "release/10.2.x", "main"];
    // Tri numérique : 10.2 avant 10.10 — un tri de chaînes prendrait 10.10.
    expect(baseFor("outillage-agents", remote, "pilotage")).toBe(
      "release/10.2.x",
    );
    expect(baseFor("10.1.0", remote, "pilotage")).toBe("release/10.2.x");
    expect(baseFor(null, ["dev", "main"], "pilotage")).toBe("dev");
    // Un autre scope suit son jalon.
    expect(baseFor("outillage-agents", remote, "http")).toBe("dev");
  });

  it("une branche de maintenance ABSENTE est une erreur, jamais un repli sur dev", () => {
    expect(() => baseFor("10.1.x", REMOTE)).toThrow(/release\/10\.1\.x/);
  });
});

describe("prBody — Closes vers la branche par défaut, Refs ailleurs", () => {
  it("vers dev : Closes, sans consigne de fermeture manuelle", () => {
    const body = prBody(812, "dev", "dev");
    expect(body.startsWith("Closes #812\n")).toBe(true);
    expect(body).not.toMatch(/à la main/);
  });

  it("vers release/* : Refs, et la fermeture manuelle écrite", () => {
    const body = prBody(794, "release/10.0.x", "dev");
    expect(body.startsWith("Refs #794\n")).toBe(true);
    expect(body).not.toMatch(/Closes/);
    expect(body).toMatch(/fermer #794 à la main/);
  });
});

describe("openingCommitMessage — le commit vide qui ouvre la PR", () => {
  it("reprend type et scope du ticket, cite le ticket, et ne lance pas la CI", () => {
    expect(
      openingCommitMessage(
        "chore(pilotage): ouvrir une branche avant tout code",
        796,
      ),
    ).toBe("chore(pilotage): ouvrir le travail sur #796 [skip ci]");
    expect(openingCommitMessage("docs: corriger le guide", 3)).toBe(
      "docs: ouvrir le travail sur #3 [skip ci]",
    );
  });
});

describe("ticketBranches — retrouver la branche d'un ticket", () => {
  it("trouve la branche du ticket et seulement elle, sans doublon local/distant", () => {
    const branches = [
      "dev",
      "chore/796-branch-and-pr-first",
      "chore/796-branch-and-pr-first",
      "fix/7960-autre",
      "fix/79-autre",
    ];
    expect(ticketBranches(796, branches)).toEqual([
      "chore/796-branch-and-pr-first",
    ]);
  });
});
