/*
 *   NODEFONY FRAMEWORK UNIT TEST — MOCHA STYLE
 *   Ce que l'aide globale PROMET, chaque commande autonome doit l'accepter
 */

import { expect } from "chai";
import { isGlobalCliFlag, stripGlobalCliFlags } from "../cli/globalFlags";
import { parseCreateArgv } from "../cli/create";
import { parseCardArgv } from "../cli/card";
import { parseEnvArgv } from "../cli/env";
import { parseSymbolsArgv } from "../cli/symbols";
import { parseAiSyncArgv } from "../cli/aiSync";
import { parseGitHooksArgv } from "../cli/gitHooks";
import { parseDoctorArgv } from "../kernel/checks/runDoctor";

/**
 * 🔴 Le défaut que ces cas gardent, et il décourage plus qu'il ne casse.
 *
 * `nodefony --help` annonce `-i, --interactive` et `-d, --debug` pour TOUTES
 * les commandes — ce sont des options posées sur commander par
 * `Cli.initCommander`. Mais les commandes servies par le raccourci autonome ne
 * passent jamais par commander : elles lisent `process.argv` elles-mêmes, pour
 * répondre sans démarrer l'application. Elles refusaient donc, avec « option
 * inconnue », ce que l'aide venait de promettre.
 *
 * Vécu sur `nodefony create app --interactive`, c'est-à-dire la toute première
 * commande qu'on tape en découvrant le framework. L'aide dit une chose, la
 * commande en dit une autre, et rien ne permet de savoir laquelle a raison.
 *
 * Le mode interactif de `create` n'est pas « activé » par ce drapeau : il est
 * DÉJÀ le comportement par défaut en terminal (`create.ts`, `process.stdin.isTTY
 * && !--yes`). Le drapeau confirme ce qui se produit déjà — et surtout, il ne
 * fait plus échouer la commande.
 */
describe("Les options globales du CLI sont acceptées par les commandes autonomes", () => {
  it("reconnaît les formes courtes ET longues", () => {
    for (const f of ["-i", "--interactive", "-d", "--debug"]) {
      expect(isGlobalCliFlag(f), f).to.equal(true);
    }
    // Ce qui n'est PAS global reste à la commande : sinon on avalerait en
    // silence une option qu'elle aurait dû refuser.
    for (const f of ["--json", "--deep", "-y", "--yes", "--help"]) {
      expect(isGlobalCliFlag(f), f).to.equal(false);
    }
  });

  it("les retire sans toucher au reste, ordre préservé", () => {
    expect(
      stripGlobalCliFlags(["app", "-i", "monapp", "--frontend", "react", "-d"]),
    ).to.deep.equal(["app", "monapp", "--frontend", "react"]);
  });

  /**
   * La CHAÎNE, pas la brique : chaque parseur autonome doit ACCEPTER les
   * drapeaux, pas seulement la fonction qui les connaît. C'est le motif « la
   * brique éprouvée, la chaîne jamais », et le seul qui reproduise le défaut.
   */
  const PARSEURS: ReadonlyArray<
    readonly [string, (argv: string[]) => unknown, string[]]
  > = [
    ["create", parseCreateArgv as (a: string[]) => unknown, ["create", "app"]],
    ["card", parseCardArgv as (a: string[]) => unknown, ["card"]],
    ["env", parseEnvArgv as (a: string[]) => unknown, ["env"]],
    ["symbols", parseSymbolsArgv as (a: string[]) => unknown, ["symbols"]],
    ["doctor", parseDoctorArgv as (a: string[]) => unknown, ["doctor"]],
    // Ces deux-là lisent `argv.slice(2)` : leur argv commence donc par deux
    // mots que Node y place (l'exécutable et le script).
    [
      "ai:sync",
      parseAiSyncArgv as (a: string[]) => unknown,
      ["node", "nodefony", "ai:sync"],
    ],
    [
      "git:hooks",
      parseGitHooksArgv as (a: string[]) => unknown,
      ["node", "nodefony", "git:hooks"],
    ],
  ];

  for (const [nom, parse, base] of PARSEURS) {
    for (const flag of ["-i", "--interactive", "-d", "--debug"]) {
      it(`${nom} accepte ${flag}`, () => {
        const r = parse([...base, flag]) as { error?: string };
        expect(
          r.error,
          `${nom} refuse ${flag}, que \`nodefony --help\` promet`,
        ).to.equal(undefined);
      });
    }

    it(`${nom} refuse toujours une option réellement inconnue`, () => {
      const r = parse([...base, "--nawak"]) as { error?: string };
      expect(r.error, `${nom} devrait refuser --nawak`).to.be.a("string");
    });
  }
});
