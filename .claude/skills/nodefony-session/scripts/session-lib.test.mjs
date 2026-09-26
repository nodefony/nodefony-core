/**
 * Règles pures de la reprise et de la clôture — chaque cas porte le défaut
 * réel qu'il empêche de revenir.
 */
import { describe, it, expect } from "vitest";
import {
  ciVerdict,
  citedHashes,
  datesIn,
  firstPriority,
  nextStateName,
  linksInSection,
  modifiedOf,
  sessionLogArgs,
  stateWrittenAt,
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
  it("annulé sur le dernier commit (job figé) n'est pas un vert — et il est nommé", () => {
    const v = ciVerdict([
      {
        status: "completed",
        conclusion: "cancelled",
        workflowName: "nodefony-core",
      },
      { status: "completed", conclusion: "success", workflowName: "Secrets" },
    ]);
    expect(v).toMatchObject({
      state: "cancelled",
      cancelled: ["nodefony-core"],
    });
  });
  it("un rouge l'emporte sur une annulation", () => {
    expect(
      ciVerdict([
        { status: "completed", conclusion: "cancelled", workflowName: "a" },
        { status: "completed", conclusion: "failure", workflowName: "b" },
      ]).state,
    ).toBe("failure");
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

describe("stateWrittenAt — l'ancre de session ne dépend pas d'un champ facultatif", () => {
  it("le commit du dépôt mémoire fait foi, même sans `modified:`", () => {
    expect(
      stateWrittenAt({
        committedAt: "2026-09-24T20:15:57+02:00",
        modified: null,
        mtime: "2026-09-25T08:00:00.000Z",
      }),
    ).toBe("2026-09-24T20:15:57+02:00");
  });
  it("replis : `modified:`, puis la date du fichier, puis rien", () => {
    expect(
      stateWrittenAt({ committedAt: null, modified: "m", mtime: "t" }),
    ).toBe("m");
    expect(
      stateWrittenAt({ committedAt: null, modified: null, mtime: "t" }),
    ).toBe("t");
    expect(
      stateWrittenAt({ committedAt: null, modified: null, mtime: null }),
    ).toBeNull();
  });
});

describe("sessionLogArgs — une révision se résout, elle ne se devine pas", () => {
  const resolve = (rev) =>
    ({ "abc1234^": "0f0f0f0", "HEAD~3": "1e1e1e1", abc1234: "abc1234" })[rev] ??
    null;

  it("`sha^` et `HEAD~3` sont des révisions, pas des dates", () => {
    expect(sessionLogArgs("abc1234^", resolve).args).toEqual(["0f0f0f0..HEAD"]);
    expect(sessionLogArgs("HEAD~3", resolve).args).toEqual(["1e1e1e1..HEAD"]);
  });
  it("une date reste une date", () => {
    expect(sessionLogArgs("2026-09-24T20:15:57+02:00", resolve).args).toEqual([
      "--since=2026-09-24T20:15:57+02:00",
    ]);
  });
  it("sans ancre, le repli est ANNONCÉ", () => {
    expect(sessionLogArgs(null, resolve)).toEqual({
      args: ["-20"],
      anchored: false,
    });
  });
});

describe("firstPriority — une priorité du `_state` SANS ticket ne s'enterre pas", () => {
  // Vécu : la Priorité 1 du `_state` 09-26d (vider le cliquet de typage)
  // n'avait aucun ticket ; la reprise n'a proposé que la ligne ➡️ du tableau,
  // et le chantier structurel a été relégué derrière un ticket de release.
  const state =
    "## Fait\n- #487 fermé\n\n## Reste\n\n1. **Priorité 1 — vider le cliquet**, une session = un paquet,\n   chacun retiré de l'override.\n2. Reporté — #312 plus tard.\n";
  it("rend le PREMIER item du Reste, lignes de suite comprises", () => {
    expect(firstPriority(state)?.text).toBe(
      "**Priorité 1 — vider le cliquet**, une session = un paquet, chacun retiré de l'override.",
    );
  });
  it("sans `#N` dans l'item, aucun ticket — même si le suivant en cite un", () => {
    expect(firstPriority(state)?.tickets).toEqual([]);
  });
  it("relève les tickets cités par l'item", () => {
    const t = "## Reste\n- Priorité 1 — #496 puis #497 (voir #496)\n";
    expect(firstPriority(t)?.tickets).toEqual([496, 497]);
  });
  it("pas de section Reste, ou vide → null", () => {
    expect(firstPriority("## Fait\n- x\n")).toBeNull();
    expect(firstPriority("## Reste\n\n## Autre\n- y\n")).toBeNull();
  });
});

describe("nextStateName — le _state du jour se range APRÈS ceux qui existent", () => {
  // Vécu : avec `09-26`, `09-26c`, `09-26d` sur le disque, la « première lettre
  // libre » rendait `09-26b` — rangé AVANT c et d, donc la reprise (qui prend le
  // dernier par nom) relisait l'ANCIEN état.
  const s = (x) => `project_session_2026-09-26${x}_state.md`;
  it("aucun _state du jour → sans lettre", () => {
    expect(
      nextStateName(["project_session_2026-09-25d_state.md"], "2026-09-26"),
    ).toBe(s(""));
  });
  it("la lettre qui SUIT la plus haute, même avec un trou", () => {
    expect(nextStateName([s(""), s("c"), s("d")], "2026-09-26")).toBe(s("e"));
  });
  it("après le _state sans lettre, vient b", () => {
    expect(nextStateName([s("")], "2026-09-26")).toBe(s("b"));
  });
});
