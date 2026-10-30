/**
 * `proof-commands` — relancer les preuves d'ABSENCE écrites dans un ticket.
 *
 * Le corps d'un ticket s'édite sur GitHub, par n'importe qui : la moitié de ces
 * tests garde la SÛRETÉ (rien d'autre que `rg`, aucun shell), l'autre la
 * LECTURE (quel verdict annonce la phrase).
 */
import { describe, it, expect } from "vitest";
import {
  countOutput,
  extractProofs,
  parseCommand,
  readExpected,
  runProof,
} from "./proof-commands.mjs";

describe("readExpected — le verdict annoncé après la commande", () => {
  it.each([
    ["rend 0.", 0],
    ["ne rend rien", 0],
    ["→ 0", 0],
    ["→ **0**", 0],
    ["rend vide", 0],
    ["→ aucun résultat", 0],
    ["rend **3**", 3],
    ["→ 12 lignes", 12],
  ])("« %s » → %s", (tail, expected) => {
    expect(readExpected(tail)).toBe(expected);
  });

  it("un verdict qualitatif est rapporté NON JUGÉ, jamais tu", () => {
    expect(readExpected("ne rend que le contrat")).toBeNull();
    expect(readExpected("→ plus aucun littéral de code")).toBeNull();
    expect(readExpected("rend analyses 26 · index 8")).toBeNull();
  });

  it("une liste « 18 · 3 · 51 » n'est pas un compte", () => {
    expect(readExpected("rend 18 · 3 · 51")).toBeNull();
  });

  it("sans verdict, la commande n'est qu'une mention", () => {
    expect(readExpected("(motif de recensement)")).toBeUndefined();
    expect(readExpected("")).toBeUndefined();
  });
});

describe("extractProofs — les preuves d'un corps de ticket", () => {
  it("lit une preuve en ligne, avec son numéro de ligne", () => {
    const body = 'intro\n`rg -c "IWebhookPayload" src/packages` rend 0.\n';
    expect(extractProofs(body)).toEqual([
      {
        command: 'rg -c "IWebhookPayload" src/packages',
        expected: 0,
        line: 2,
        tail: "rend 0.",
      },
    ]);
  });

  it("lit « rend `0` », le nombre écrit en code (forme enseignée par le skill)", () => {
    expect(extractProofs("`rg -c 'X' src` rend `0`.")).toMatchObject([
      { expected: 0 },
    ]);
  });

  it("lit une preuve en BLOC suivie de son verdict sur la ligne d'après", () => {
    const body = [
      "- Les directives absentes :",
      "",
      "```bash",
      'rg -c "frame-ancestors|report-to" src/packages/@nodefony/security',
      "```",
      "rend 0.",
    ].join("\n");
    const [proof] = extractProofs(body);
    expect(proof).toMatchObject({ expected: 0, line: 4 });
    expect(proof.command).toBe(
      'rg -c "frame-ancestors|report-to" src/packages/@nodefony/security',
    );
  });

  it("un bloc de plusieurs commandes n'est PAS une preuve (verdict ambigu)", () => {
    const body = "```bash\nrg -c a src\nrg -c b src\n```\nrend 0.";
    expect(extractProofs(body)).toEqual([]);
  });

  it("le code en ligne DANS un bloc n'est pas lu", () => {
    const body = "```md\n`rg -c x src` rend 0.\n```\n";
    expect(extractProofs(body)).toEqual([]);
  });

  it("dans un tableau, `\\|` redevient le tube qu'il échappait", () => {
    const body = "| preuve | `rg -l x src \\| wc -l` → 0 |";
    expect(extractProofs(body)[0].command).toBe("rg -l x src | wc -l");
  });

  it("un « Fini quand » décrit l'état VISÉ : ses commandes ne sont pas relancées", () => {
    const body = [
      "**Preuve au terrain**",
      "`rg -c IWebhookPayload src` rend 0.",
      "",
      "**Fini quand**",
      '- `rg -c "export type .*IWebhookPayload" index.ts` rend 1.',
      "```bash",
      "rg -c foo src",
      "```",
      "rend 0.",
      "",
      "---",
      "`rg -c bar src` rend 0.",
    ].join("\n");
    expect(extractProofs(body).map((p) => p.line)).toEqual([2, 12]);
  });

  it("« Critères de fin » sur la même ligne que la commande : non relancée", () => {
    const body =
      '**Critères de fin** : `rg "as unknown as" wsBackpressure.ts` → 0.';
    expect(extractProofs(body)).toEqual([]);
  });

  it("une simple mention de commande, sans verdict, est ignorée", () => {
    expect(
      extractProofs(
        "Recensement : `rg -n foo src` (26 lignes, voir plus bas).",
      ),
    ).toEqual([]);
  });
});

describe("parseCommand — rien d'autre que rg, aucun shell", () => {
  it("découpe guillemets simples, doubles et échappements", () => {
    expect(parseCommand(`rg -n --pcre2 'a b' "c\\"d" e\\ f`)).toEqual({
      argv: ["-n", "--pcre2", "a b", 'c"d', "e f"],
      countLines: false,
    });
  });

  it("le MOTIF n'est pas un chemin : `/metrics` est cherché, pas lu", () => {
    expect(parseCommand('rg -c "/metrics" src scripts')).toEqual({
      argv: ["-c", "/metrics", "src", "scripts"],
      countLines: false,
    });
    expect(parseCommand("rg -c x -g '!**/dist/**' src")).toHaveProperty("argv");
  });

  it("avec `-e`, tout positionnel est un chemin, gardé comme tel", () => {
    expect(parseCommand("rg -e x /etc").refused).toMatch(/hors du dépôt/u);
  });

  it("accepte le seul tube `| wc -l`, et le compte lui-même", () => {
    expect(parseCommand("rg -l x src | wc -l")).toEqual({
      argv: ["-l", "x", "src"],
      countLines: true,
    });
  });

  it.each([
    ["rg x src; rm -rf .", /opérateur de shell « ; »/u],
    ["rg x src && echo", /opérateur de shell « & »/u],
    ["rg x src | sh", /opérateur de shell « \| »/u],
    ["rg $(whoami) src", /opérateur de shell « \$ »/u],
    ['rg "$(whoami)" src', /substitution de shell/u],
    ['rg "`id`" src', /substitution de shell/u],
    ["rg x src > out", /opérateur de shell « > »/u],
    ["grep -r x src", /programme « grep »/u],
    ["rg --pre ./evil x src", /--pre/u],
    ["rg --pre=./evil x src", /--pre/u],
    ["rg --hostname-bin ./evil x src", /--hostname-bin/u],
    ["rg -nz x src", /-z ou -r/u],
    ["rg -r y x src", /-r/u],
    ["rg x /etc", /hors du dépôt/u],
    ["rg x ../voisin", /hors du dépôt/u],
    ["rg -f /etc/passwd src", /hors du dépôt/u],
    ["rg 'non fermé src", /non fermé/u],
  ])("refuse « %s »", (command, reason) => {
    const parsed = parseCommand(command);
    expect(parsed).toHaveProperty("refused");
    expect(parsed.refused).toMatch(reason);
  });
});

describe("countOutput — ce que rend la commande", () => {
  it("additionne les comptes de `-c` sur plusieurs fichiers", () => {
    expect(
      countOutput(["-c", "x", "src"], "src/a.ts:2\nsrc/b.ts:5\n", false),
    ).toBe(7);
  });

  it("lit le compte nu de `-c` sur un seul fichier", () => {
    expect(countOutput(["-c", "x", "package.json"], "4\n", false)).toBe(4);
  });

  it("compte les lignes sans `-c`, et sous `| wc -l`", () => {
    expect(countOutput(["-n", "x", "src"], "a:1:x\nb:2:x\n", false)).toBe(2);
    expect(countOutput(["-c", "x", "src"], "a:2\nb:5\n", true)).toBe(2);
  });
});

describe("runProof — le verdict, exécuteur injecté", () => {
  const proof = (command, expected) => ({
    command,
    expected,
    line: 1,
    tail: "",
  });
  const exec =
    (status, stdout = "", stderr = "") =>
    () => ({ status, stdout, stderr });

  it("rg sans résultat (statut 1) tient une absence", () => {
    expect(
      runProof(proof("rg -c x src", 0), { repo: ".", exec: exec(1) }),
    ).toEqual({
      verdict: "OK",
      actual: 0,
    });
  });

  it("une absence qui ne tient plus est DÉMENTIE, avec le compte réel", () => {
    expect(
      runProof(proof("rg -c x src", 0), {
        repo: ".",
        exec: exec(0, "src/a.ts:3\n"),
      }),
    ).toEqual({ verdict: "DÉMENTIE", actual: 3 });
  });

  it("un compte qui a bougé est un ÉCART", () => {
    expect(
      runProof(proof("rg -l x src", 2), {
        repo: ".",
        exec: exec(0, "a\nb\nc\n"),
      }),
    ).toEqual({
      verdict: "ÉCART",
      actual: 3,
    });
  });

  it("une commande en erreur (statut 2) est CASSÉE, jamais un vert", () => {
    expect(
      runProof(proof("rg x src/disparu", 0), {
        repo: ".",
        exec: exec(
          2,
          "",
          "src/disparu: No such file or directory (os error 2)\n",
        ),
      }),
    ).toMatchObject({
      verdict: "CASSÉE",
      reason: expect.stringMatching(/No such file/u),
    });
  });

  it("une commande refusée n'est JAMAIS exécutée", () => {
    let called = false;
    const verdict = runProof(proof("rg x src; rm -rf .", 0), {
      repo: ".",
      exec: () => {
        called = true;
        return { status: 1, stdout: "", stderr: "" };
      },
    });
    expect(verdict.verdict).toBe("REFUSÉE");
    expect(called).toBe(false);
  });

  it("un verdict qualitatif n'est pas exécuté : NON JUGÉE", () => {
    expect(
      runProof(proof("rg -c x src", null), { repo: ".", exec: exec(0) }),
    ).toEqual({
      verdict: "NON JUGÉE",
    });
  });

  it("rg reçoit --no-config et la commande telle qu'écrite, sans shell", () => {
    let seen;
    runProof(proof('rg -c "a b" src', 0), {
      repo: ".",
      exec: (argv) => {
        seen = argv;
        return { status: 1, stdout: "", stderr: "" };
      },
    });
    expect(seen).toEqual([
      "--no-config",
      "--color",
      "never",
      "-c",
      "a b",
      "src",
    ]);
  });
});
