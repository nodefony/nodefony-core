/**
 * Suite du compte rendu de fermeture.
 *
 * Ce que ces cas protègent : un compte rendu est cru sans être relu, comme le
 * ticket lui-même. Deux façons de le rendre nuisible plutôt qu'inutile — lui
 * attribuer le travail d'un AUTRE ticket (`#9` qui ramène `#95`), et rendre un
 * gabarit dont les trous ne se voient pas, donc qu'on colle tel quel.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  commitsDuTicket,
  composer,
  fichiersDeTest,
  motifTicket,
} from "./ticket-close.mjs";

describe("les fichiers de test d'un diff", () => {
  it("retient les suites, quelle que soit leur forme", () => {
    expect(
      fichiersDeTest([
        "src/nodefony/src/kernel/Kernel.ts",
        "src/nodefony/src/tests/readinessRegistry.test.ts",
        "src/packages/@nodefony/http/nodefony/tests/http/health.test.ts",
        ".claude/skills/nodefony-ticket/scripts/ticket-close.test.mjs",
      ]),
    ).to.deep.equal([
      "src/nodefony/src/tests/readinessRegistry.test.ts",
      "src/packages/@nodefony/http/nodefony/tests/http/health.test.ts",
      ".claude/skills/nodefony-ticket/scripts/ticket-close.test.mjs",
    ]);
  });

  it("ne rend jamais deux fois le même fichier", () => {
    const f = "src/tests/a.test.ts";
    expect(fichiersDeTest([f, f, f])).to.deep.equal([f]);
  });

  it("ignore le code de production", () => {
    expect(
      fichiersDeTest(["src/nodefony/src/kernel/readinessRegistry.ts"]),
    ).to.deep.equal([]);
  });

  // PIÈGE VÉCU : `src/modules/test/` est le module de DÉCOR du dépôt, pas une
  // suite. Un motif au singulier le ramassait tout entier — controllers et
  // `CLAUDE.md` compris —, noyant les six vraies preuves sous du bruit.
  it("n'est PAS trompé par le module `test` du dépôt", () => {
    expect(
      fichiersDeTest([
        "src/modules/test/index.ts",
        "src/modules/test/CLAUDE.md",
        "src/modules/test/nodefony/controller/ReadinessController.ts",
      ]),
    ).to.deep.equal([]);
  });
});

/**
 * Le motif se prouve contre un VRAI dépôt git, jamais contre l'idée qu'on se
 * fait des expressions rationnelles.
 *
 * 🔴 Défaut constaté au premier usage réel de ce script : `--grep='#95\b'` ne
 * mord sur RIEN — le moteur de git est une ERE POSIX, qui n'a pas de borne de
 * mot. Le compte rendu sortait vide en annonçant « aucun commit ne cite #95 »
 * juste après un commit qui le citait : un outil qui accuse à tort est pire
 * qu'un outil absent. Aucun test sur la chaîne du motif n'aurait vu ça.
 */
describe("les commits d'un ticket, contre un dépôt git réel", () => {
  let repo = "";
  const git = (...args) =>
    execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" });

  beforeAll(() => {
    repo = mkdtempSync(path.join(tmpdir(), "nf-close-"));
    git("init", "-q", "-b", "main");
    git("config", "user.email", "banc@nodefony.local");
    git("config", "user.name", "banc");
    for (const sujet of [
      "feat(a): premier — closes #9",
      "feat(b): second — closes #95",
      "feat(c): troisième, cite #950",
    ]) {
      writeFileSync(path.join(repo, `${sujet.length}.txt`), sujet);
      git("add", "-A");
      git("commit", "-q", "--no-verify", "-m", sujet);
    }
  });
  afterAll(() => rmSync(repo, { recursive: true, force: true }));

  const sujets = (numero) =>
    git(
      "log",
      "--reverse",
      "--format=%s",
      `--grep=${motifTicket(numero)}`,
      "-E",
    )
      .split("\n")
      .filter(Boolean);

  it("TROUVE le commit qui cite le ticket", () => {
    expect(sujets(95)).to.deep.equal(["feat(b): second — closes #95"]);
  });

  it("ne confond pas #9 avec #95 ni #950", () => {
    expect(sujets(9)).to.deep.equal(["feat(a): premier — closes #9"]);
  });

  it("`commitsDuTicket` rend le sha et le sujet", () => {
    const cwd = process.cwd();
    try {
      process.chdir(repo);
      const commits = commitsDuTicket(95);
      expect(commits).to.have.length(1);
      expect(commits[0].sujet).to.equal("feat(b): second — closes #95");
      expect(commits[0].sha).to.match(/^[0-9a-f]{7,}$/);
    } finally {
      process.chdir(cwd);
    }
  });
});

describe("le brouillon rendu à l'auteur", () => {
  const commits = [
    { sha: "abc1234", sujet: "feat(http): retenir la mise en service" },
  ];

  it("porte les commits et les preuves trouvés", () => {
    const t = composer(95, commits, ["src/tests/a.test.ts"]);
    expect(t).to.include("`abc1234` feat(http): retenir la mise en service");
    expect(t).to.include("`src/tests/a.test.ts`");
  });

  // PIÈGE : un gabarit dont les trous sont muets se rend tel quel. Les deux blocs
  // que le script NE PEUT PAS deviner doivent se voir — ce sont les seuls qui
  // portent ce que seul l'auteur sait.
  it("EXIGE en toutes lettres les deux blocs qu'aucun automate ne connaît", () => {
    const t = composer(95, commits, ["src/tests/a.test.ts"]);
    expect(t).to.include("**Au-delà du ticket**");
    expect(t).to.include("**Non fait**");
    expect(t, "la garde vue mordre est une preuve, pas une option").to.include(
      "Garde vue mordre",
    );
  });

  // PIÈGE : sans commit citant le ticket, la timeline GitHub reste vide et le
  // travail devient introuvable. Se taire ici reviendrait à valider l'oubli.
  it("DIT que rien ne cite le ticket, au lieu de rendre un bloc vide", () => {
    const t = composer(95, [], []);
    expect(t).to.include("aucun commit ne cite #95");
    expect(t).to.include("aucun fichier de test touché");
  });
});
