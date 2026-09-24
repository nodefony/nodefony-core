/**
 * Règles pures de la reprise et de la clôture — chaque cas porte le défaut
 * réel qu'il empêche de revenir.
 */
import { describe, it, expect } from "vitest";
import {
  ciVerdict,
  citedHashes,
  datesIn,
  linksInSection,
  liveRetexThemes,
  modifiedOf,
  newlyDone,
  uncitedWork,
} from "./session-lib.mjs";

describe("uncitedWork — le garde-fou `_state` ↔ commits", () => {
  const state = "## Fait\n- `49b5010a` générateur\n- d1930bea prettier\n";
  it("un feat/fix non cité rend le `_state` périmé", () => {
    const commits = [
      { hash: "49b5010a", subject: "feat(cli): générateur" },
      { hash: "79bf5e1c", subject: "fix(http): 404 sur identifiant mal formé" },
    ];
    expect(uncitedWork(commits, state).map((c) => c.hash)).toEqual([
      "79bf5e1c",
    ]);
  });
  it("docs/chore/style ne comptent pas — seul le travail PRODUIT désigne la suite", () => {
    const commits = [
      { hash: "aaaaaaa1", subject: "docs(session): retex" },
      { hash: "aaaaaaa2", subject: "chore(board): empreinte" },
    ];
    expect(uncitedWork(commits, state)).toEqual([]);
  });
  it("un hash cité en 7 caractères couvre sa forme longue, et `feat(x)!:` compte", () => {
    const commits = [{ hash: "d1930bea", subject: "feat(core)!: rupture" }];
    expect(uncitedWork(commits, "cité : d1930be")).toEqual([]);
  });
  it("un mot hexadécimal collé à du texte n'est pas un hash", () => {
    expect(citedHashes("sha1deadbeefcafe").size).toBe(0);
  });
});

describe("ciVerdict — le statut fait foi, jamais la conclusion seule", () => {
  it('un run EN COURS a `conclusion: ""` — il n\'est pas terminé', () => {
    const v = ciVerdict([
      { status: "in_progress", conclusion: "", workflowName: "nodefony-core" },
      { status: "completed", conclusion: "success", workflowName: "Secrets" },
    ]);
    expect(v.state).toBe("running");
    expect(v.running).toEqual(["nodefony-core"]);
  });
  it("un rouge l'emporte sur un run en cours", () => {
    const v = ciVerdict([
      { status: "in_progress", conclusion: "", workflowName: "a" },
      { status: "completed", conclusion: "failure", workflowName: "b" },
    ]);
    expect(v).toMatchObject({ state: "failure", failed: ["b"] });
  });
  it("annulé (remplacé par un run plus récent) n'est pas un rouge", () => {
    expect(
      ciVerdict([
        { status: "completed", conclusion: "cancelled", workflowName: "a" },
      ]).state,
    ).toBe("success");
  });
  it("aucun run → none, pas un vert", () => {
    expect(ciVerdict([]).state).toBe("none");
  });
});

describe("newlyDone — fermés entre deux empreintes", () => {
  it("rend ce qui est passé à Done, pas ce qui l'était déjà", () => {
    const before = [
      { number: 1, status: "Todo" },
      { number: 2, status: "Done" },
    ];
    const after = [
      { number: 1, status: "Done", title: "a" },
      { number: 2, status: "Done", title: "b" },
      { number: 3, status: "Done", title: "neuf" },
    ];
    expect(newlyDone(before, after).map((i) => i.number)).toEqual([1]);
  });
});

describe("liveRetexThemes — les titres vivants du sas", () => {
  const sas = [
    "# RETEX",
    "## 🪞 Le remède — GRADUÉ",
    "## ⌨️ Une commande tapée",
    "## 🗄️ 🧨 DÉCLARATION — VERSÉS",
    "## 👻 Un process sans port",
    "## 🗄️ Gradué aux CONSOLIDATE",
    "## 🩹 Archivé vivant après la borne",
  ].join("\n");
  it("écarte les gradués/versés et s'arrête à la section d'archive", () => {
    expect(liveRetexThemes(sas)).toEqual([
      "⌨️ Une commande tapée",
      "👻 Un process sans port",
    ]);
  });
});

describe("helpers de mémoire", () => {
  it("linksInSection ne lit QUE la section demandée", () => {
    const t =
      "## Fait\n[[a]]\n## Reste\n1. [[kit-x]] puis [[kit-y]] [[kit-x]]\n## Autre\n[[z]]";
    expect(linksInSection(t, "Reste")).toEqual(["kit-x", "kit-y"]);
  });
  it("modifiedOf lit le frontmatter", () => {
    expect(modifiedOf("---\n  modified: 2026-09-24T06:44:26.016Z\n---")).toBe(
      "2026-09-24T06:44:26.016Z",
    );
  });
  it("datesIn trouve les dates ISO", () => {
    expect(datesIn("corrigé le 2026-09-24, v10.0.0")).toEqual(["2026-09-24"]);
  });
});
