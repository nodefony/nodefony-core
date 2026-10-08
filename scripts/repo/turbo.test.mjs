/**
 * Le lanceur turbo rend la main quand turbo a affiché son bilan mais ne se
 * termine pas (#479) — avec le code que le bilan annonce — et ne tue jamais un
 * turbo qui n'a pas encore fini.
 *
 * Le gel est reproduit par un faux turbo : un script node qui imprime un bilan,
 * puis reste en vie, sans enfant, comme `turbo.exe` dans les journaux de la forge.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  isTurboLogLine,
  parseSummary,
  runTurbo,
  summaryExitCode,
} from "./turbo.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nf-turbo-guard-"));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

/** Écrit un faux turbo : `body` reçoit ses arguments dans `argv`. */
function fakeTurbo(name, body) {
  const file = path.join(dir, `${name}.mjs`);
  fs.writeFileSync(file, `const argv = process.argv.slice(2);\n${body}\n`);
  return [process.execPath, file];
}

const GREEN =
  "console.log('\\x1b[1m Tasks:    \\x1b[32m3 successful\\x1b[0m, 3 total');" +
  "console.log('  Time:    1s');";
const RED =
  "console.log(' Tasks:    2 successful, 3 total');" +
  "console.log('Failed:    a#build');";
const HANG = "setInterval(() => {}, 1000);";
const LOG =
  "console.error('2026-10-08T07:12:49.887+0200 [DEBUG] turborepo_run: visitor completed, calculating exit code');";

describe("parseSummary — le bilan de turbo, couleurs comprises", () => {
  it("lit le bilan vert, le bilan rouge, et ignore le reste", () => {
    expect(
      parseSummary(
        "\x1b[1m Tasks:    \x1b[32m\x1b[1m21 successful\x1b[0m, 21 total\x1b[0m",
      ),
    ).toEqual({ successful: 21, total: 21 });
    expect(parseSummary(" Tasks:    20 successful, 21 total")).toEqual({
      successful: 20,
      total: 21,
    });
    expect(parseSummary("Cached:    21 cached, 21 total")).toBeNull();
    expect(parseSummary("@nodefony/http:build: Tasks: done")).toBeNull();
  });

  it("rend le code que turbo aurait rendu", () => {
    expect(summaryExitCode({ successful: 21, total: 21 })).toBe(0);
    expect(summaryExitCode({ successful: 20, total: 21 })).toBe(1);
    expect(summaryExitCode({ successful: 0, total: 0 })).toBe(0);
  });
});

describe("isTurboLogLine — le journal détaillé se garde, le reste s'affiche", () => {
  it("reconnaît les lignes horodatées de turbo, pas une sortie de tâche", () => {
    expect(
      isTurboLogLine(
        "2026-10-08T07:12:49.635+0200 [DEBUG] turborepo_shim::run: Global turbo version: 2.11.7",
      ),
    ).toBe(true);
    expect(
      isTurboLogLine("2026-10-08T05:12:49.635Z [TRACE] turborepo_lib: x"),
    ).toBe(true);
    // Un avertissement reste VISIBLE : il est adressé au lecteur du journal.
    expect(
      isTurboLogLine("2026-10-08T07:12:49.635+0200 [WARN] turborepo: x"),
    ).toBe(false);
    expect(isTurboLogLine("error TS2307: Cannot find module")).toBe(false);
  });
});

describe("runTurbo sous garde — le gel après bilan", () => {
  it("bilan vert puis gel : arbre arrêté, code 0 rendu", async () => {
    const t0 = Date.now();
    const code = await runTurbo(["run", "build"], {
      guarded: true,
      command: fakeTurbo("green-hang", `${LOG}${GREEN}${HANG}`),
      graceSeconds: 1,
    });
    expect(code).toBe(0);
    expect(Date.now() - t0).toBeLessThan(10_000);
  }, 15_000);

  it("bilan rouge puis gel : code 1 rendu — un échec ne devient jamais un vert", async () => {
    const code = await runTurbo(["run", "build"], {
      guarded: true,
      command: fakeTurbo("red-hang", `${RED}${HANG}`),
      graceSeconds: 1,
    });
    expect(code).toBe(1);
  }, 15_000);

  it("sans bilan, un turbo muet n'est JAMAIS tué : son propre code est rendu", async () => {
    const code = await runTurbo(["run", "build"], {
      guarded: true,
      // Muet 2,5 s, au-delà du délai de grâce, puis sortie avec un code propre.
      command: fakeTurbo("slow", "setTimeout(() => process.exit(7), 2500);"),
      graceSeconds: 1,
    });
    expect(code).toBe(7);
  }, 15_000);

  it("turbo qui sort de lui-même : son code, pas celui du bilan", async () => {
    const code = await runTurbo(["run", "build"], {
      guarded: true,
      command: fakeTurbo("green-exit-2", `${GREEN}process.exitCode = 2;`),
      graceSeconds: 1,
    });
    expect(code).toBe(2);
  }, 15_000);

  it("passe --verbosity AVANT la sous-commande, jamais après un `--`", async () => {
    const out = path.join(dir, "argv.json");
    await runTurbo(["run", "test", "--", "--foo"], {
      guarded: true,
      command: fakeTurbo(
        "argv",
        `(await import("node:fs")).default.writeFileSync(${JSON.stringify(out)}, JSON.stringify(argv));`,
      ),
      graceSeconds: 1,
    });
    expect(JSON.parse(fs.readFileSync(out, "utf8"))).toEqual([
      "--verbosity=2",
      "run",
      "test",
      "--",
      "--foo",
    ]);
  }, 15_000);
});

describe("runTurbo hors garde — transparent", () => {
  it("rend le code de turbo et ne touche pas à ses arguments", async () => {
    const out = path.join(dir, "argv-plain.json");
    const code = await runTurbo(["run", "build"], {
      guarded: false,
      command: fakeTurbo(
        "plain",
        `(await import("node:fs")).default.writeFileSync(${JSON.stringify(out)}, JSON.stringify(argv)); process.exitCode = 3;`,
      ),
    });
    expect(code).toBe(3);
    expect(JSON.parse(fs.readFileSync(out, "utf8"))).toEqual(["run", "build"]);
  }, 15_000);
});
