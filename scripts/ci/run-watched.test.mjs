/**
 * Le lanceur de la forge rend la main quand la commande finit, même si un
 * descendant détaché garde sa sortie ouverte — et il nomme ce descendant.
 *
 * Le cas réel est reproduit : un script qui lance un petit-enfant DÉTACHÉ
 * héritant de sa sortie, puis se termine. Sans le lanceur, qui attend ce tuyau
 * attend le petit-enfant — c'est le job Windows figé jusqu'à son plafond.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import {
  parseElapsed,
  parseProcessTable,
  selectSuspects,
} from "./run-watched.mjs";

const LAUNCHER = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "run-watched.mjs",
);

describe("parseProcessTable — la table du système, deux grammaires", () => {
  it("Windows : le JSON de Get-CimInstance, tableau ou objet seul, deux formats de date", () => {
    const many = JSON.stringify([
      {
        ProcessId: 10,
        ParentProcessId: 1,
        Name: "node.exe",
        CommandLine: "node a.js",
        CreationDate: "/Date(1000)/",
      },
      {
        ProcessId: 11,
        ParentProcessId: 10,
        Name: "turbo.exe",
        CommandLine: null,
        CreationDate: "1970-01-01T00:00:02.000Z",
      },
    ]);
    expect(parseProcessTable("win32", many, 0)).toEqual([
      { pid: 10, ppid: 1, startedAt: 1000, command: "node a.js" },
      { pid: 11, ppid: 10, startedAt: 2000, command: "turbo.exe" },
    ]);
    const one = JSON.stringify({
      ProcessId: 5,
      ParentProcessId: 4,
      Name: "x",
      CommandLine: "x --y",
      CreationDate: "/Date(7)/",
    });
    expect(parseProcessTable("win32", one, 0)).toEqual([
      { pid: 5, ppid: 4, startedAt: 7, command: "x --y" },
    ]);
  });

  it("POSIX : la sortie de ps, âge relu en date, arguments avec espaces conservés", () => {
    const raw =
      "  10     1 1-02:03:04 node /a b/c.js --x\n  11    10    00:05 sh -c npm run build\n\n";
    const now = 10_000_000;
    expect(parseProcessTable("linux", raw, now)).toEqual([
      {
        pid: 10,
        ppid: 1,
        startedAt: now - 93784 * 1000,
        command: "node /a b/c.js --x",
      },
      {
        pid: 11,
        ppid: 10,
        startedAt: now - 5000,
        command: "sh -c npm run build",
      },
    ]);
  });

  it("etime : les trois formes de ps", () => {
    expect(parseElapsed("00:05")).toBe(5);
    expect(parseElapsed("01:02:03")).toBe(3723);
    expect(parseElapsed("2-00:00:01")).toBe(172801);
    expect(parseElapsed("n/a")).toBeNaN();
  });
});

describe("selectSuspects — descendants vivants, et node/turbo DÉTACHÉS nés pendant l'étape", () => {
  const since = 100_000;
  const rows = [
    { pid: 1, ppid: 0, startedAt: 0, command: "init" },
    { pid: 50, ppid: 1, startedAt: since, command: "node run-watched.mjs" },
    { pid: 100, ppid: 50, startedAt: since + 10, command: "sh -c npm test" },
    { pid: 101, ppid: 100, startedAt: since + 20, command: "turbo run test" },
    // né pendant l'étape, rattaché à init : c'est lui qui tient le tuyau
    {
      pid: 200,
      ppid: 1,
      startedAt: since + 5000,
      command: "node dist/server.js",
    },
    // né pendant l'étape, détaché, mais pas node/turbo
    { pid: 201, ppid: 1, startedAt: since + 5000, command: "sleep 100" },
    // node détaché, mais né AVANT l'étape : un autre process de la machine
    { pid: 300, ppid: 1, startedAt: since - 60_000, command: "node autre.js" },
  ];

  it("garde l'arbre de la commande et le node détaché de l'étape, écarte le reste", () => {
    const got = selectSuspects(rows, 100, 50, since);
    expect(got.map((s) => s.pid)).toEqual([100, 101, 200]);
    expect(got.find((s) => s.pid === 200)?.detached).toBe(true);
    expect(got.find((s) => s.pid === 101)?.detached).toBe(false);
  });
});

describe("runWatched — le mécanisme réel", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "run-watched-"));
  const fixture = path.join(dir, "leaves-orphan.mjs");
  let orphanPid = 0;
  // Le script lance un petit-enfant DÉTACHÉ qui HÉRITE de sa sortie et vit
  // 30 s, annonce son pid, puis se termine tout de suite.
  fs.writeFileSync(
    fixture,
    [
      'import { spawn } from "node:child_process";',
      'const c = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)"], { detached: true, stdio: "inherit" });',
      "c.unref();",
      'console.log("ORPHAN_PID=" + c.pid);',
    ].join("\n"),
  );

  afterAll(() => {
    try {
      if (orphanPid) process.kill(orphanPid);
    } catch {
      // déjà mort
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("rend la main en quelques secondes, avec le code de la commande, et nomme l'orphelin", async () => {
    const started = Date.now();
    const { code, out, err } = await new Promise((resolve) => {
      const p = spawn(
        process.execPath,
        [LAUNCHER, "--", "node", JSON.stringify(fixture)],
        { stdio: ["ignore", "pipe", "pipe"] },
      );
      let o = "";
      let e = "";
      p.stdout.on("data", (c) => (o += c));
      p.stderr.on("data", (c) => (e += c));
      p.on("close", (status) => resolve({ code: status, out: o, err: e }));
    });
    orphanPid = Number(/ORPHAN_PID=(\d+)/u.exec(out)?.[1] ?? 0);
    const elapsed = Date.now() - started;
    expect(code).toBe(0);
    expect(orphanPid).toBeGreaterThan(0);
    // 30 s d'orphelin : s'il fallait l'attendre, on le verrait ici.
    expect(elapsed).toBeLessThan(15000);
    expect(err).toContain("un descendant garde sa sortie ouverte");
    expect(err).toContain(`DÉTACHÉ pid ${orphanPid}`);
  }, 40000);

  it("une commande muette au-delà de --idle : l'inventaire la nomme, sans l'interrompre", async () => {
    const { code, err } = await new Promise((resolve) => {
      const p = spawn(
        process.execPath,
        [
          LAUNCHER,
          "--idle",
          "1",
          "node",
          "-e",
          JSON.stringify("setTimeout(() => process.exit(0), 8000)"),
        ],
        { stdio: ["ignore", "ignore", "pipe"] },
      );
      let e = "";
      p.stderr.on("data", (c) => (e += c));
      p.on("close", (status) => resolve({ code: status, err: e }));
    });
    expect(code).toBe(0);
    expect(err).toContain("aucune sortie depuis 1 s");
    expect(err).toMatch(/pid \d+ ← \d+ : .*setTimeout/u);
  }, 30000);

  it("transmet le code de sortie d'une commande en échec", async () => {
    const code = await new Promise((resolve) => {
      const p = spawn(
        process.execPath,
        [LAUNCHER, "node", "-e", JSON.stringify("process.exit(3)")],
        { stdio: "ignore" },
      );
      p.on("close", resolve);
    });
    expect(code).toBe(3);
  }, 20000);
});
