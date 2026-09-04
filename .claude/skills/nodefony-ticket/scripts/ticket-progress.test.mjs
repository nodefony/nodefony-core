/**
 * Suite du marquage automatique « In Progress ».
 *
 * Le champ existait depuis toujours et n'avait JAMAIS servi (0 item sur 64) parce
 * que « commencer » n'est pas un instant qu'on sait nommer. Le remplacer par un
 * fait — le premier commit qui cite le ticket — ne vaut que si la lecture de ce
 * fait est juste : un message mal lu marque le mauvais ticket, ou remet « en
 * cours » un ticket que le même commit vient de fermer.
 *
 * Les cas marqués « PIÈGE » sont ceux où une lecture naïve se trompe.
 */
import { describe, expect, it } from "vitest";
import { parseTargets } from "./ticket-progress.mjs";

describe("tickets mis en cours par un message de commit", () => {
  it("un ticket cité sans être fermé passe en cours", () => {
    expect(
      parseTargets("feat(orm): avancer\n\nPremière moitié de #41."),
    ).to.deep.equal(["41"]);
  });

  // PIÈGE : sans cette exclusion, le commit qui FERME rouvrirait le ticket « en
  // cours » juste après que GitHub l'a passé à Done. Le tableau afficherait
  // l'inverse de la vérité, et c'est le pire état possible pour un instrument.
  it("IGNORE un ticket que le commit ferme", () => {
    for (const kw of [
      "Closes",
      "closes",
      "Close",
      "Fixes",
      "fixed",
      "Resolves",
    ]) {
      expect(parseTargets(`fix(x): y\n\n${kw} #58`), kw).to.deep.equal([]);
    }
  });

  it("distingue les deux dans un même message", () => {
    expect(
      parseTargets("fix(x): y\n\nAvance #41 et #42.\nCloses #58"),
    ).to.deep.equal(["41", "42"]);
  });

  // PIÈGE : un numéro cité deux fois ne doit pas produire deux appels réseau.
  it("dédoublonne", () => {
    expect(parseTargets("#41 puis encore #41")).to.deep.equal(["41"]);
  });

  it("ne rend rien quand aucun ticket n'est cité", () => {
    expect(parseTargets("chore: ménage")).to.deep.equal([]);
  });

  // PIÈGE : un commit de PILOTAGE (retex de session, recalage du tableau) cite des
  // dizaines de tickets sans en faire avancer un seul. Sans cette exclusion, le
  // retex de fin de session remet « en cours » tout ce qu'il énumère — vécu sur
  // #188, monté par le commit `docs(session)` qui le mentionnait dans son corps.
  // `board-lint.mjs` refuse déjà ces commits comme preuve de travail : les deux
  // scripts lisent la MÊME règle (`isPilotageCommit`), sinon elle diverge.
  it("IGNORE les tickets cités par un commit de pilotage", () => {
    for (const sujet of [
      "docs(session): retex 09-04e — leçons",
      "chore(pilotage): recaler le tableau de bord",
      "docs(claude): consigner la règle",
    ]) {
      expect(
        parseTargets(`${sujet}\n\nReste #183, #184 et #188.`),
        sujet,
      ).to.deep.equal([]);
    }
  });

  // PIÈGE : le corps d'un commit cite volontiers des ancres et des tailles.
  // `#` non suivi de chiffres, ou un dièse collé à un mot, ne sont pas des tickets.
  it("ne prend pas un dièse qui n'introduit pas un numéro", () => {
    expect(
      parseTargets("perf: passer de 35 MB à 12 MB — cf section #\n"),
    ).to.deep.equal([]);
  });
});
