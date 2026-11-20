/**
 * Suite du marquage automatique « In Progress ».
 *
 * Le champ existait depuis toujours et n'avait JAMAIS servi (0 item sur 64) parce
 * que « commencer » n'est pas un instant qu'on sait nommer. Le remplacer par un
 * fait — le premier commit sur la branche du ticket — ne vaut que si la lecture
 * de ce fait est juste : une branche mal lue marque le mauvais ticket.
 *
 * Les cas marqués « PIÈGE » sont ceux où une lecture naïve se trompe.
 */
import { describe, expect, it } from "vitest";
import { mentionedTickets, ticketOfBranch } from "./commit-kind.mjs";
import { ticketsInProgress } from "./ticket-progress.mjs";
import { referencedIssues } from "./pr-complete.mjs";

describe("ticket mis en cours par un commit : celui de la BRANCHE", () => {
  it("une branche de travail met son ticket en cours", () => {
    expect(ticketsInProgress("fix/794-http2-head-scope")).to.deep.equal([794]);
    expect(ticketsInProgress("chore/796-branch-and-pr-first")).to.deep.equal([
      796,
    ]);
  });

  // PIÈGE vécu (#796) : des commits de la branche de #796 citaient #794 (exemple
  // d'essai à blanc) et #445 — tous deux passés « In Progress », remis à Todo à la
  // main. Le message n'est plus lu : seule la branche parle.
  it("n'a PAS de paramètre message : une mention ne met rien en cours", () => {
    expect(ticketsInProgress.length).toBe(1);
  });

  it("hors branche de travail, rien n'est mis en cours", () => {
    for (const branch of [
      "dev",
      "main",
      "release/10.0.x",
      "", // HEAD détaché
      "chore(x)/12-y",
      "fix/sans-numero",
      "fix/12", // pas de sujet
    ]) {
      expect(ticketsInProgress(branch), branch).to.deep.equal([]);
    }
  });

  // PIÈGE : une branche ancienne `wip/20-min-release-age` n'est pas la branche du
  // ticket #20 — seul un type de `BRANCH_TYPES` fait une branche de travail.
  it("refuse un préfixe hors des types de branche de travail", () => {
    expect(ticketOfBranch("wip/20-min-release-age")).toBe(null);
    expect(ticketOfBranch("dependabot/npm_and_yarn/vite-7")).toBe(null);
  });

  it("la PR retrouve son ticket par la MÊME règle", () => {
    expect(referencedIssues({ headRefName: "wip/20-x" })).to.deep.equal([]);
    expect(referencedIssues({ headRefName: "fix/797-home" })).to.deep.equal([
      797,
    ]);
  });
});

describe("tickets cités par un texte (`mentionedTickets`)", () => {
  // Plus lue par la mise en cours, la règle sert encore la préparation de clôture
  // et la lecture du `_state` : ses pièges restent gardés ici.

  // PIÈGE : un numéro cité deux fois ne doit pas produire deux appels réseau.
  it("dédoublonne", () => {
    expect(mentionedTickets("#41 puis encore #41")).to.deep.equal([41]);
  });

  // PIÈGE : le corps d'un commit cite volontiers des ancres et des tailles.
  // `#` non suivi de chiffres, ou un dièse collé à un mot, ne sont pas des tickets.
  it("ne prend pas un dièse qui n'introduit pas un numéro", () => {
    expect(
      mentionedTickets("perf: passer de 35 MB à 12 MB — cf section #\n"),
    ).to.deep.equal([]);
  });

  // Vécu : « PKCS#11 » dans un message faisait citer la demande de fusion #11.
  it("ne prend pas un dièse collé à un mot (PKCS#11, C#7, chemin/#12)", () => {
    expect(
      mentionedTickets(
        "docs: ajouter PKCS#11, C#7 et docs/#12 au glossaire (#583)\n",
      ),
    ).to.deep.equal([583]);
  });

  // Vécu : des numéros d'alerte CodeQL ont passé #245, #246 et #248 en cours.
  it("ne prend pas un numéro d'alerte CodeQL pour un ticket", () => {
    expect(
      mentionedTickets(
        "fix(x): échapper l'antislash (#227)\n\n" +
          "CodeQL js/incomplete-sanitization (#245, #246) : la barre…\n" +
          "CodeQL #248 : dans un segment de code…\n" +
          "alertes CodeQL #247 et #249 classées. CodeQL rouge, voir #12.\n",
      ),
    ).to.deep.equal([227, 12]);
  });
});
