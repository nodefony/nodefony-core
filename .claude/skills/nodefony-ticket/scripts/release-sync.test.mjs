/**
 * Suite de la fusion arrière `release/x.y.x → dev` (D9, #796).
 *
 * Les fonctions éprouvées ici décident QUOI fusionner et QUAND refuser un
 * squash ; une erreur ne se voit pas tout de suite — elle se paie à la
 * publication suivante, refusée par `refusDeMaintenance`.
 */
import { describe, expect, it } from "vitest";
import {
  carriedReleases,
  localCleanupPlan,
  pickMaintenance,
  syncBranchName,
  syncPlan,
  syncPr,
  syncStart,
} from "./release-sync.mjs";
import { ticketOfBranch } from "./commit-kind.mjs";

describe("pickMaintenance — quelle release/x.y.x rapatrier", () => {
  it("prend la seule branche de maintenance distante", () => {
    expect(pickMaintenance(["dev", "main", "release/10.0.x"])).toBe(
      "release/10.0.x",
    );
  });

  it("refuse sans branche de maintenance", () => {
    expect(() => pickMaintenance(["dev", "main"])).toThrow(/aucune/u);
  });

  it("exige un choix quand il y en a plusieurs, et l'honore", () => {
    const remote = ["release/10.0.x", "release/10.1.x"];
    expect(() => pickMaintenance(remote)).toThrow(/plusieurs/u);
    expect(pickMaintenance(remote, "release/10.1.x")).toBe("release/10.1.x");
  });

  it("refuse un nom qui n'est pas une maintenance distante", () => {
    expect(() => pickMaintenance(["release/10.0.x"], "release/9.0.x")).toThrow(
      /n'est pas/u,
    );
  });
});

describe("syncPlan — quoi fusionner, dans quel ordre", () => {
  it("main D'ABORD, puis la maintenance", () => {
    expect(
      syncPlan("release/10.0.x", {
        mainInTarget: false,
        maintenanceInTarget: false,
      }),
    ).toEqual(["origin/main", "origin/release/10.0.x"]);
  });

  it("ne refusionne pas ce qui est déjà dans dev", () => {
    expect(
      syncPlan("release/10.0.x", {
        mainInTarget: true,
        maintenanceInTarget: false,
      }),
    ).toEqual(["origin/release/10.0.x"]);
    expect(
      syncPlan("release/10.0.x", {
        mainInTarget: true,
        maintenanceInTarget: true,
      }),
    ).toEqual([]);
  });
});

describe("branche et PR de la fusion arrière", () => {
  // PIÈGE : une branche `chore/<N>-…` mettrait un ticket « en cours ».
  it("la branche ne porte aucun ticket", () => {
    const name = syncBranchName("release/10.0.x");
    expect(name).toBe("chore/merge-release-10.0.x");
    expect(ticketOfBranch(name)).toBe(null);
  });

  it("la PR dit la fusion en COMMIT DE FUSION, et ne ferme aucun ticket", () => {
    const { title, body } = syncPr("release/10.0.x", [
      "origin/main",
      "origin/release/10.0.x",
    ]);
    expect(title).toBe("chore(release): rapatrier release/10.0.x dans dev");
    expect(body).toContain("`origin/main` puis `origin/release/10.0.x`");
    expect(body).toContain("COMMIT DE FUSION");
    expect(body).not.toMatch(/\b(?:closes|refs) #\d+/iu);
  });
});

describe("carriedReleases — ce qu'une PR embarque", () => {
  it("une release/* ancêtre de la tête mais pas de la base", () => {
    expect(
      carriedReleases([
        { name: "release/10.0.x", inHead: true, inBase: false },
      ]),
    ).toEqual(["release/10.0.x"]);
  });

  // PIÈGE : une branche de ticket partie de dev APRÈS la fusion arrière contient
  // la maintenance — par la base, pas par elle. Elle se squashe normalement.
  it("rien quand la base la contient déjà, ou que la tête ne la contient pas", () => {
    expect(
      carriedReleases([
        { name: "release/10.0.x", inHead: true, inBase: true },
        { name: "release/10.1.x", inHead: false, inBase: false },
      ]),
    ).toEqual([]);
  });
});

describe("syncStart — reprendre la fusion en cours, jamais une fusion passée", () => {
  it("RECRÉE une branche locale déjà fusionnée dans dev, même si l'on est dessus", () => {
    expect(syncStart({ current: false, exists: true, inTarget: true })).toBe(
      "recreate",
    );
    expect(syncStart({ current: true, exists: true, inTarget: true })).toBe(
      "recreate",
    );
  });

  it("REPREND une branche aux commits propres (conflit résolu, pas encore poussé)", () => {
    expect(syncStart({ current: false, exists: true, inTarget: false })).toBe(
      "resume",
    );
    expect(syncStart({ current: true, exists: true, inTarget: false })).toBe(
      "stay",
    );
  });

  it("CRÉE quand rien n'existe", () => {
    expect(syncStart({ current: false, exists: false, inTarget: false })).toBe(
      "create",
    );
  });
});

describe("localCleanupPlan — la copie locale d'une branche fusionnée (#796)", () => {
  const facts = {
    head: "chore/796-x",
    base: "release/10.0.x",
    current: "dev",
    dirty: false,
    localTip: "a".repeat(40),
    mergedTip: "a".repeat(40),
  };

  it("supprime la copie locale quand elle EST la tête fusionnée, sans changer de branche", () => {
    expect(localCleanupPlan(facts)).toMatchObject({
      switchTo: null,
      deleteLocal: true,
    });
  });

  it("revient sur la base quand on était sur la branche fusionnée, puis la supprime", () => {
    expect(
      localCleanupPlan({ ...facts, current: "chore/796-x" }),
    ).toMatchObject({ switchTo: "release/10.0.x", deleteLocal: true });
  });

  it("GARDE une copie locale qui porte autre chose que la tête fusionnée — jamais de -D à l'aveugle", () => {
    const plan = localCleanupPlan({ ...facts, localTip: "b".repeat(40) });
    expect(plan).toMatchObject({ switchTo: null, deleteLocal: false });
    expect(plan.reason).toContain("git branch -D chore/796-x");
  });

  it("GARDE la branche courante sur un arbre sale, et rien quand elle n'existe pas en local", () => {
    expect(
      localCleanupPlan({ ...facts, current: "chore/796-x", dirty: true }),
    ).toMatchObject({ switchTo: null, deleteLocal: false });
    expect(localCleanupPlan({ ...facts, localTip: null })).toMatchObject({
      deleteLocal: false,
    });
  });
});
