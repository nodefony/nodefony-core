import { describe, expect, it } from "vitest";
import { runCapturedCommand } from "../service/dev/DevSupervisor";
import {
  isTurboLogLine,
  parseTurboSummary,
  turboSummaryExitCode,
  turboVerbosityArgs,
  TurboFreezeWatch,
} from "../service/dev/turboFreeze";

/**
 * La règle du gel de turbo (#479) : bilan affiché puis silence → figé, code
 * pris sur le bilan. Elle vit dans le produit — le superviseur de dev lançait
 * `turbo run build` sans elle, et un gel Windows au démarrage coûtait 120 s puis
 * un job mort, sans rien apprendre. Horloge injectée : éprouvée sans attendre,
 * et sans machine Windows.
 */
describe("parseTurboSummary — le bilan de turbo, couleurs comprises", () => {
  it("lit le bilan vert, le bilan rouge, et ignore le reste", () => {
    expect(
      parseTurboSummary(
        "\x1b[1m Tasks:    \x1b[32m\x1b[1m21 successful\x1b[0m, 21 total\x1b[0m",
      ),
    ).toEqual({ successful: 21, total: 21 });
    expect(parseTurboSummary(" Tasks:    20 successful, 21 total")).toEqual({
      successful: 20,
      total: 21,
    });
    expect(parseTurboSummary("Cached:    21 cached, 21 total")).toBeNull();
    expect(parseTurboSummary("@nodefony/http:build: Tasks: done")).toBeNull();
  });

  it("rend le code que turbo aurait rendu", () => {
    expect(turboSummaryExitCode({ successful: 21, total: 21 })).toBe(0);
    expect(turboSummaryExitCode({ successful: 20, total: 21 })).toBe(1);
    expect(turboSummaryExitCode({ successful: 0, total: 0 })).toBe(0);
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

describe("turboVerbosityArgs — journal détaillé sous CI seulement", () => {
  it("CI posé → --verbosity=2 ; absent ou « false » → rien", () => {
    expect(turboVerbosityArgs("true")).toEqual(["--verbosity=2"]);
    expect(turboVerbosityArgs("1")).toEqual(["--verbosity=2"]);
    expect(turboVerbosityArgs(undefined)).toEqual([]);
    expect(turboVerbosityArgs("")).toEqual([]);
    expect(turboVerbosityArgs("false")).toEqual([]);
  });
});

describe("TurboFreezeWatch — le verdict sur une horloge injectée", () => {
  const GREEN = " Tasks:    3 successful, 3 total\n";
  const RED = " Tasks:    2 successful, 3 total\n";

  it("sans bilan, JAMAIS figé — même après une heure de silence", () => {
    const w = new TurboFreezeWatch(0, 1000);
    w.stdout("@nodefony/http:build: bundling…\n", 10);
    expect(w.remaining(3_600_000)).toBe(Number.POSITIVE_INFINITY);
    expect(w.verdict(3_600_000)).toBeNull();
  });

  it("bilan vert puis silence : figé au délai de grâce exact, code 0", () => {
    const w = new TurboFreezeWatch(0, 1000);
    w.stdout(GREEN, 100);
    expect(w.verdict(1099)).toBeNull();
    expect(w.remaining(1099)).toBe(1);
    expect(w.verdict(1100)).toEqual({
      code: 0,
      summary: { successful: 3, total: 3 },
      silentMs: 1000,
    });
  });

  it("bilan rouge : code 1 — un échec ne devient jamais un vert", () => {
    const w = new TurboFreezeWatch(0, 1000);
    w.stdout(RED, 0);
    expect(w.verdict(5000)?.code).toBe(1);
  });

  it("une sortie APRÈS le bilan relance le délai (turbo vit encore)", () => {
    const w = new TurboFreezeWatch(0, 1000);
    w.stdout(GREEN, 0);
    w.stderr("2026-10-08T07:12:49.887+0200 [DEBUG] turborepo_run: x\n", 900);
    expect(w.verdict(1500)).toBeNull();
    expect(w.verdict(1900)?.code).toBe(0);
  });

  it("un bilan coupé entre deux paquets est lu quand même", () => {
    const w = new TurboFreezeWatch(0, 1000);
    w.stdout(" Tasks:    3 succ", 0);
    expect(w.summary).toBeNull();
    w.stdout("essful, 3 total\n  Time: 1s\n", 1);
    expect(w.summary).toEqual({ successful: 3, total: 3 });
  });

  it("un bilan sans saut de ligne final est lu au flush", () => {
    const w = new TurboFreezeWatch(0, 1000);
    w.stdout(" Tasks:    1 successful, 1 total", 0);
    w.flush();
    expect(w.summary).toEqual({ successful: 1, total: 1 });
  });

  it("stderr : journal gardé (borné), le reste rendu à l'appelant", () => {
    const w = new TurboFreezeWatch(0, 1000, 2);
    const log = (n: number) =>
      `2026-10-08T07:12:49.887+0200 [DEBUG] turborepo: étape ${n}\n`;
    const shown = w.stderr(
      `${log(1)}error TS2307: x\n${log(2)}${log(3)}npm warn y`,
      0,
    );
    expect(shown).toBe("error TS2307: x\n");
    expect(w.logTail).toEqual([
      "2026-10-08T07:12:49.887+0200 [DEBUG] turborepo: étape 2",
      "2026-10-08T07:12:49.887+0200 [DEBUG] turborepo: étape 3",
    ]);
    expect(w.flush()).toBe("npm warn y");
  });
});

/**
 * Le superviseur de dev emploie la règle : un turbo figé après son bilan rend
 * la main en `turboGraceMs`, pas à la borne d'inactivité (120 s au démarrage,
 * soit exactement le délai de readiness du banc d'intégration — le job mourait
 * avant que le superviseur ne réagisse).
 */
describe("runCapturedCommand — turbo figé après son bilan", () => {
  const IDLE_MS = 20_000;
  const GRACE_MS = 1_000;
  const HANG = "setInterval(() => {}, 1000);";
  const fake = (code: string, turbo = true) =>
    runCapturedCommand(process.execPath, ["-e", code], process.cwd(), IDLE_MS, {
      turbo,
      turboGraceMs: GRACE_MS,
    });
  const alive = (pid: number): boolean => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };

  it("bilan vert puis gel : rend la main bien avant la borne, ok, NOMMÉ, arbre tué", async () => {
    const t0 = Date.now();
    const r = await fake(
      `process.stdout.write(process.pid + ' pid\\n Tasks:    3 successful, 3 total\\n'); ${HANG}`,
    );
    expect(Date.now() - t0).toBeLessThan(IDLE_MS / 2);
    expect(r.ok).toBe(true);
    expect(r.output).toContain("[turbo] bilan affiché (3/3 réussies)");
    expect(r.output).toContain("code 0 rendu d'après le bilan");
    expect(r.output).not.toContain("déclaré calé");
    const pid = Number.parseInt(r.output, 10);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(alive(pid)).toBe(false);
  }, 30_000);

  it("bilan rouge puis gel : ok faux", async () => {
    const r = await fake(
      `process.stdout.write(' Tasks:    2 successful, 3 total\\n'); ${HANG}`,
    );
    expect(r.ok).toBe(false);
    expect(r.output).toContain("code 1 rendu d'après le bilan");
  }, 30_000);

  it("journal détaillé : retiré de la sortie, sa fin jointe au rapport de gel", async () => {
    const r = await fake(
      "process.stderr.write('2026-10-08T07:12:49.887+0200 [DEBUG] turborepo_telemetry: closing\\n');" +
        `process.stdout.write(' Tasks:    1 successful, 1 total\\n'); ${HANG}`,
    );
    expect(r.output).toContain(
      "la dernière ligne est l'étape où il s'est figé :\n2026-10-08T07:12:49.887+0200 [DEBUG] turborepo_telemetry: closing",
    );
    expect(r.output.match(/turborepo_telemetry/gu)).toHaveLength(1);
  }, 30_000);

  it("turbo qui sort de lui-même après son bilan : son propre code fait foi", async () => {
    const r = await fake(
      "process.stdout.write(' Tasks:    1 successful, 1 total\\n'); process.exitCode = 2;",
    );
    expect(r.ok).toBe(false);
    expect(r.output).not.toContain("bilan affiché");
  }, 30_000);

  it("sans l'option turbo, un bilan ne change rien : seule la borne d'inactivité vaut", async () => {
    const r = await fake(
      "process.stdout.write(' Tasks:    1 successful, 1 total\\n'); setTimeout(() => process.exit(0), 2500);",
      false,
    );
    expect(r.ok).toBe(true);
    expect(r.output).not.toContain("bilan affiché");
  }, 30_000);
});
