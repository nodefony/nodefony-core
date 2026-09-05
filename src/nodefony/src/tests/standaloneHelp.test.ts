import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runCardCommand } from "../cli/card";
import { runEnvCommand } from "../cli/env";
import { runSymbolsCommand } from "../cli/symbols";
import { runAiSyncCommand } from "../cli/aiSync";
import { runAiMcpCommand } from "../cli/aiMcp";
import { runGitHooksCommand } from "../cli/gitHooks";
import { runCreateCommand } from "../cli/create";
import { runCompletionCommand } from "../cli/completion";
import { runStandaloneDevCommand } from "../service/dev/devStatusReport";
import { runDoctorCommand } from "../kernel/checks/runDoctor";

/**
 * 🔴 Le pied de l'aide promet `nodefony <commande> --help`. Dix commandes le
 * démentaient.
 *
 * Sept répondaient « option inconnue : --help » avec le code 64 sur la sortie
 * d'erreur ; trois ignoraient le drapeau et S'EXÉCUTAIENT — `nodefony stop
 * --help` arrêtait réellement le serveur, `nodefony completion --help` crachait
 * sept cents lignes de shell. Une aide qui ment à sa dernière ligne apprend à
 * ne plus croire les autres.
 *
 * Ces commandes sont dites « standalone » : un fast-path de `CliKernel.start`
 * les sert sans booter, et c'est LEUR analyseur qui lit `process.argv` —
 * commander, qui pose `--help` sur chaque commande, n'est jamais consulté.
 *
 * Le devoir était déjà écrit dans un COMMENTAIRE de `standaloneOptions.test.ts`,
 * et `--help` y était retiré de ce que le test vérifie. Ce fichier en fait une
 * assertion, et l'assertion EXÉCUTE : elle appelle chaque commande comme le
 * terminal l'appelle, et regarde ce qui sort, sur quel canal, avec quel code.
 * Vérifier que l'analyseur pose un booléen aurait prouvé la brique, pas la
 * chaîne — et c'est la chaîne qui était rompue.
 */

const ICI = path.dirname(fileURLToPath(import.meta.url));

/** Les commandes servies par le fast-path, avec leur point d'entrée. */
const STANDALONE: ReadonlyArray<
  readonly [string, (argv: string[]) => number | Promise<number>]
> = [
  ["card", (a) => runCardCommand(a, "10.0.0")],
  ["env", runEnvCommand],
  ["symbols", runSymbolsCommand],
  ["ai:sync", runAiSyncCommand],
  ["ai:mcp", runAiMcpCommand],
  ["git:hooks", runGitHooksCommand],
  ["create", runCreateCommand],
  ["completion", runCompletionCommand],
  ["doctor", runDoctorCommand],
  ["status", () => runStandaloneDevCommand("status")],
  ["stop", () => runStandaloneDevCommand("stop")],
];

/** Ce que la commande a écrit, et où. */
interface ISortie {
  code: number;
  out: string;
  err: string;
}

/**
 * Appelle une commande avec `--help`, en captant ses deux sorties.
 *
 * `process.argv` est posé pour de vrai : ces analyseurs le lisent directement,
 * et leur passer un tableau ne suffirait pas — `status` et `stop` ne prennent
 * même pas d'argv en argument.
 */
async function avecHelp(
  nom: string,
  run: (argv: string[]) => number | Promise<number>,
  drapeau: string,
): Promise<ISortie> {
  const argvOrigine = process.argv;
  const outOrigine = process.stdout.write.bind(process.stdout);
  const errOrigine = process.stderr.write.bind(process.stderr);
  let out = "";
  let err = "";
  const argv = ["node", "nodefony", nom, drapeau];
  process.argv = argv;
  // La signature de `write` est surchargée ; ce mock ne rend que le booléen,
  // seul retour dont l'appelant se sert ici.
  process.stdout.write = (chunk: string): boolean => {
    out += chunk;
    return true;
  };
  process.stderr.write = (chunk: string): boolean => {
    err += chunk;
    return true;
  };
  try {
    const code = await run(argv);
    return { code, out, err };
  } finally {
    process.argv = argvOrigine;
    process.stdout.write = outOrigine;
    process.stderr.write = errOrigine;
  }
}

describe("commandes standalone — `--help` tient la promesse du pied de l'aide", () => {
  for (const [nom, run] of STANDALONE) {
    for (const drapeau of ["--help", "-h"] as const) {
      it(`${nom} ${drapeau} : une page sur stdout, code 0, stderr muette`, async () => {
        const { code, out, err } = await avecHelp(nom, run, drapeau);
        expect(err, `${nom} ${drapeau} a écrit sur la sortie d'erreur`).toBe(
          "",
        );
        expect(code, `${nom} ${drapeau} n'a pas rendu 0`).toBe(0);
        // Le nom de la commande en tête : c'est ce qui distingue une PAGE
        // d'un effet de bord qui aurait écrit quelque chose sur stdout.
        expect(out, `${nom} ${drapeau} n'a pas rendu sa page`).toContain(
          `nodefony ${nom}`,
        );
        expect(out).toContain("usage :");
        expect(out).toContain("CODES DE SORTIE");
      });
    }
  }

  it("aucun fast-path de CliKernel n'échappe à cette liste", () => {
    // 🔴 Une liste écrite ici se périme au prochain fast-path ajouté, et le
    // gate resterait vert sur une commande qui ne répond pas. On la confronte
    // donc à la SOURCE qui décide vraiment de ce qui est standalone.
    //
    // ⚠️ Il ne voit que les fast-paths posés par comparaison de NOM. Ceux qui
    // passent par un prédicat (`isDoctorCommand`, `isStandaloneDevCommand`)
    // lui échappent : leurs noms ne sont pas écrits là. Ils sont couverts
    // parce qu'ils sont dans la liste ci-dessus, pas parce que ce contrôle
    // l'exige — le dire plutôt que de laisser croire à une garantie entière.
    const source = readFileSync(
      path.join(ICI, "../kernel/CliKernel.ts"),
      "utf8",
    );
    const dansLeFastPath = new Set<string>();
    for (const m of source.matchAll(/requested === "([a-z][\w:-]*)"/gu)) {
      dansLeFastPath.add(m[1] as string);
    }
    // Un motif qui ne trouve RIEN rendrait ce contrôle vert à vide — c'est la
    // façon dont une garde cesse de garder sans que personne ne s'en aperçoive.
    expect(
      dansLeFastPath.size,
      "le motif ne reconnaît plus aucun fast-path : il a cessé de coller à " +
        "la forme du code, et ce contrôle ne prouve donc plus rien",
    ).toBeGreaterThan(5);
    // `__complete` répond au TAB du shell, pas à un humain : une page d'aide
    // y polluerait la liste de complétion. `devkit:card` est l'alias de `card`,
    // déjà couvert par lui.
    for (const hors of ["__complete", "devkit:card"])
      dansLeFastPath.delete(hors);
    const couverts = new Set(STANDALONE.map(([n]) => n));
    const oublies = [...dansLeFastPath].filter((n) => !couverts.has(n)).sort();
    expect(
      oublies,
      `fast-path sans épreuve de --help : ${oublies.join(", ")}`,
    ).toEqual([]);
  });
});
