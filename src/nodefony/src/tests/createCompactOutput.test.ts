/**
 * Unit — la sortie COURTE de `create app` hors dialogue (#785).
 *
 * Mesuré sur un vrai `create app --yes --demo` : 24,5 Ko de sortie, et la
 * consigne « lis AGENTS.md » à l'octet 20 776. Un agent a rangé cette sortie
 * dans un fichier et n'en a lu que le début : la consigne ne lui est jamais
 * parvenue. Éprouvé ici : hors dialogue, la consigne tombe dans les 2 premiers
 * Ko, la liste des fichiers se résume, le journal d'une étape réussie se tait
 * et celui d'une étape ratée sort en entier ; `--verbose` rend tout.
 */
import { afterAll, afterEach, assert, describe, it, vi } from "vitest";
import path from "node:path";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import {
  isCompactCreateOutput,
  parseCreateArgv,
  renderAgentBrief,
  runCreateCommand,
  runPostStep,
  summarizeWrittenFiles,
} from "../cli/create";
import { portableSpawn } from "../cli/execPortable";
import { SysExit } from "../cli/sysexits";

const racine = mkdtempSync(path.join(tmpdir(), "nf-create-compact-"));
afterAll(() => rmSync(racine, { recursive: true, force: true }));
afterEach(() => vi.restoreAllMocks());

const argv = (...words: string[]): string[] => ["node", "nodefony", ...words];

/** Ce que `fn` écrit sur la sortie standard et la sortie d'erreur. */
async function captured(
  fn: () => unknown,
): Promise<{ out: string; err: string }> {
  let out = "";
  let err = "";
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    out += String(chunk);
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    err += String(chunk);
    return true;
  });
  await fn();
  vi.restoreAllMocks();
  return { out, err };
}

/** `create app <nom> --yes --demo` sans installation ni git, sortie capturée. */
async function createDemo(
  nom: string,
  ...extra: string[]
): Promise<{ code: number; out: string }> {
  let code = -1;
  const { out } = await captured(async () => {
    code = await runCreateCommand(
      argv(
        "create",
        "app",
        nom,
        "--dir",
        path.join(racine, nom),
        "--yes",
        "--demo",
        "--no-install",
        "--no-git",
        ...extra,
      ),
    );
  });
  return { code, out };
}

describe("isCompactCreateOutput — qui reçoit la sortie courte", () => {
  it("hors dialogue → courte ; en dialogue ou --verbose → complète", () => {
    assert.isTrue(
      isCompactCreateOutput({ interactive: false, verbose: false }),
    );
    assert.isFalse(
      isCompactCreateOutput({ interactive: false, verbose: true }),
    );
    assert.isFalse(
      isCompactCreateOutput({ interactive: true, verbose: false }),
    );
    assert.isFalse(isCompactCreateOutput({ interactive: true, verbose: true }));
  });

  it("--verbose est lu par l'analyseur, absent il vaut false", () => {
    const avec = parseCreateArgv(argv("create", "app", "x", "--verbose"));
    const sans = parseCreateArgv(argv("create", "app", "x"));
    assert.isTrue("verbose" in avec && avec.verbose);
    assert.isTrue("verbose" in sans && !sans.verbose);
  });
});

describe("renderAgentBrief — la consigne, chemin compris, en première ligne", () => {
  it("application dans un sous-dossier → chemin du AGENTS.md nommé", () => {
    const first = renderAgentBrief("chat").trimStart().split("\n")[0] ?? "";
    assert.include(first, "lis chat/AGENTS.md AVANT d'écrire");
  });

  it("application créée sur place → AGENTS.md seul", () => {
    const first = renderAgentBrief(".").trimStart().split("\n")[0] ?? "";
    assert.include(first, "lis AGENTS.md AVANT");
  });

  it("chemin AFFICHÉ en `/`, quelle que soit la plateforme", () => {
    const relDest = path.join("apps", "chat");
    assert.include(renderAgentBrief(relDest), "lis apps/chat/AGENTS.md");
  });
});

describe("summarizeWrittenFiles — la forme de l'application sans sa liste", () => {
  it("compte par dossier de premier niveau, séparateurs `/` et `\\` confondus", () => {
    const line = summarizeWrittenFiles([
      "package.json",
      "modules/demo/index.ts",
      "modules\\demo\\a.ts",
      "modules/demo/b.ts",
      "src/x.ts",
    ]);
    assert.include(line, "5 fichiers — modules/ 3 · src/ 1 · racine 1");
    assert.notInclude(line, "modules/demo/index.ts");
  });
});

describe("create app --yes : la sortie COURTE", () => {
  it("la consigne AGENTS.md tombe dans les 2 premiers Ko", async () => {
    const { code, out } = await createDemo("courte");
    assert.equal(code, SysExit.OK);
    // Le dossier vit sous le tmp du système : le chemin relatif affiché est
    // long, seule sa fin est stable.
    const at = out.indexOf("courte/AGENTS.md AVANT");
    assert.isAtLeast(at, 0, out);
    assert.isBelow(
      Buffer.byteLength(out.slice(0, at), "utf8"),
      2048,
      "la consigne arrive après 2 Ko — un agent ne la lira pas",
    );
    // Une seule fois : la fin de sortie ne la répète pas.
    assert.lengthOf(out.match(/Pour ton agent/gu) ?? [], 1, out);
    // La liste est résumée — aucun chemin de fichier en ligne propre.
    assert.match(out, /\d+ fichiers — /u);
    assert.notMatch(out, /^ {2}nodefony\.config\.ts$/mu);
  });

  it("--verbose rend la liste complète et garde la consigne en fin", async () => {
    const { code, out } = await createDemo("bavarde", "--verbose");
    assert.equal(code, SysExit.OK);
    assert.match(out, /^ {2}nodefony\.config\.ts$/mu);
    assert.notMatch(out, /\d+ fichiers — /u);
    assert.isAbove(
      out.indexOf("Pour ton agent"),
      out.indexOf("Prochaines étapes"),
      "en sortie complète, la consigne reste après les prochaines étapes",
    );
  });
});

describe("create app . : pas de « cd . »", () => {
  it("l'application EST le dossier courant → aucune étape « cd »", async () => {
    const ici = path.join(racine, "sur-place");
    mkdirSync(ici);
    vi.spyOn(process, "cwd").mockReturnValue(ici);
    const { out } = await captured(() =>
      runCreateCommand(
        argv("create", "app", ".", "--yes", "--no-install", "--no-git"),
      ),
    );
    assert.include(out, "Prochaines étapes");
    assert.notMatch(out, /^ {2}cd /mu, out);
  });
});

describe("runPostStep — le journal d'une étape silencieuse", () => {
  const step = (script: string) =>
    portableSpawn(process.execPath, ["-e", script]);

  it("réussie → rien d'écrit", async () => {
    let ok = false;
    const { out, err } = await captured(() => {
      ok = runPostStep(
        racine,
        step("console.log('bavard'); console.error('avertissement')"),
        true,
      );
    });
    assert.isTrue(ok);
    assert.equal(out, "");
    assert.equal(err, "");
  });

  it("ratée → journal ENTIER rendu, sur ses deux canaux", async () => {
    let ok = true;
    const { out, err } = await captured(() => {
      ok = runPostStep(
        racine,
        step(
          "console.log('ligne 1'); console.log('ligne 2'); " +
            "console.error('npm ERR! la cause'); process.exit(3)",
        ),
        true,
      );
    });
    assert.isFalse(ok);
    assert.include(out, "ligne 1\nligne 2");
    assert.include(err, "npm ERR! la cause");
  });
});
