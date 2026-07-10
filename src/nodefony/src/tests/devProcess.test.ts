/*
 *   Tests UNITAIRES du helper d'introspection des process dev (devProcess.ts) —
 *   parsing `ps`, formatage, valeurs partagées. Fonctions PURES → déterministes,
 *   sans spawn `ps` ni dépendance machine. Couvre en particulier le parsing `%CPU`
 *   avec virgule décimale (bug locale FR qui avait fait passer la détection à zéro).
 */

import assert from "node:assert";
import path from "node:path";
import os from "node:os";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import {
  defaultDevPorts,
  detectRuntimeMode,
  devSupervisorPidFile,
  findRuntimeConflict,
  formatUptime,
  missingWorkspaceDists,
  parsePsRow,
  runtimeModes,
  type DevProcessInfo,
} from "../service/dev/devProcess";

describe("devProcess — parsePsRow (parsing ps)", () => {
  it("superviseur, %CPU à VIRGULE décimale (locale FR) → cpu numérique correct", () => {
    const r = parsePsRow(
      "15326 15293 108564   0,0   47:27 nodefony-dev-supervisor",
    );
    assert.ok(r);
    assert.strictEqual(r.role, "supervisor");
    assert.strictEqual(r.label, "supervisor");
    assert.strictEqual(r.pid, 15326);
    assert.strictEqual(r.ppid, 15293);
    assert.strictEqual(r.rssKb, 108564);
    assert.strictEqual(r.cpu, 0); // "0,0" ne doit PAS casser le parse
    assert.strictEqual(r.uptimeSec, 47 * 60 + 27); // 47:27 = MM:SS
  });

  it("serveur, %CPU à POINT décimal → cpu numérique correct", () => {
    const r = parsePsRow(
      "40482 15326 305444   12.7   01:08 nodefony-dev-server",
    );
    assert.ok(r);
    assert.strictEqual(r.role, "server");
    assert.strictEqual(r.cpu, 12.7);
    assert.strictEqual(r.uptimeSec, 68); // 01:08 = MM:SS
  });

  it("Vite mono-entry → label court `vite` + detail = bundle", () => {
    const r = parsePsRow(
      "40514 40482 436508 0,0 01:03 nodefony-vite[studio] /path/vite.js --port 5173",
    );
    assert.ok(r);
    assert.strictEqual(r.role, "vite");
    assert.strictEqual(r.label, "vite"); // colonne courte → alignement stable
    assert.strictEqual(r.detail, "studio");
  });

  it("Vite multi-entry → detail = bundles joints", () => {
    const r = parsePsRow(
      "40515 40482 132076 0,0 01:03 nodefony-vite[react+vue+studio] /path/vite.js",
    );
    assert.ok(r);
    assert.strictEqual(r.label, "vite");
    assert.strictEqual(r.detail, "react+vue+studio");
  });

  it("uptime HH:MM:SS et DD-HH:MM:SS → secondes", () => {
    const h = parsePsRow("100 1 1000 0,0 01:02:03 nodefony-dev-server");
    assert.strictEqual(h?.uptimeSec, 1 * 3600 + 2 * 60 + 3);
    const d = parsePsRow("100 1 1000 0,0 2-03:04:05 nodefony-dev-server");
    assert.strictEqual(d?.uptimeSec, 2 * 86400 + 3 * 3600 + 4 * 60 + 5);
  });

  it("process NON-dev → null (hors périmètre)", () => {
    assert.strictEqual(
      parsePsRow("500 1 20000 0.0 10:00 /usr/libexec/some-daemon"),
      null,
    );
  });

  it("serveur PROD mono (`nodefony server`) → mode prod, role server", () => {
    const r = parsePsRow("200 1 30000 0.0 05:00 nodefony server");
    assert.ok(r);
    assert.strictEqual(r.mode, "prod");
    assert.strictEqual(r.role, "server");
  });

  it("master cluster → mode cluster, role master, detail = nb workers", () => {
    const r = parsePsRow("300 1 18000 0.0 05:00 nodefony master [cluster 6w]");
    assert.ok(r);
    assert.strictEqual(r.mode, "cluster");
    assert.strictEqual(r.role, "master");
    assert.strictEqual(r.detail, "6 workers");
  });

  it("worker cluster → mode cluster, role worker, detail = #id", () => {
    const r = parsePsRow("301 300 32000 0.0 05:00 nodefony worker 3 [cluster]");
    assert.ok(r);
    assert.strictEqual(r.mode, "cluster");
    assert.strictEqual(r.role, "worker");
    assert.strictEqual(r.detail, "#3");
  });

  it("dev-server (tiret) ≠ prod-server (espace) → mode dev, pas prod", () => {
    const r = parsePsRow("100 1 30000 0.0 05:00 nodefony-dev-server");
    assert.ok(r);
    assert.strictEqual(r.mode, "dev");
    assert.strictEqual(r.role, "server");
  });
});

describe("devProcess — détection de mode & conflit (gardes anti-collision)", () => {
  const mk = (
    pid: number,
    mode: DevProcessInfo["mode"],
    role: DevProcessInfo["role"],
    ppid = 1,
  ): DevProcessInfo => ({
    pid,
    ppid,
    mode,
    role,
    label: role,
    rssKb: 1000,
    cpu: 0,
    uptimeSec: 1,
  });

  it("detectRuntimeMode : priorité dev > cluster > prod ; null si vide", () => {
    assert.strictEqual(detectRuntimeMode([]), null);
    assert.strictEqual(detectRuntimeMode([mk(1, "prod", "server")]), "prod");
    assert.strictEqual(
      detectRuntimeMode([
        mk(1, "cluster", "master"),
        mk(2, "cluster", "worker"),
      ]),
      "cluster",
    );
    // Cohabitation anormale dev+prod → dev domine (le superviseur a la priorité).
    assert.strictEqual(
      detectRuntimeMode([mk(1, "prod", "server"), mk(2, "dev", "supervisor")]),
      "dev",
    );
  });

  it("runtimeModes ignore Vite (enfant, ne tient pas les ports)", () => {
    const modes = runtimeModes([
      mk(1, "dev", "supervisor"),
      mk(2, "dev", "server"),
      mk(3, "dev", "vite"),
    ]);
    assert.deepStrictEqual([...modes], ["dev"]);
  });

  it("findRuntimeConflict(dev) : un prod/cluster est un conflit, un résiduel dev non", () => {
    const procs = [
      mk(1, "dev", "supervisor"),
      mk(2, "dev", "server"),
      mk(3, "prod", "server"),
    ];
    const conflict = findRuntimeConflict(procs, "dev");
    assert.strictEqual(conflict.length, 1);
    assert.strictEqual(conflict[0].pid, 3);
    assert.strictEqual(conflict[0].mode, "prod");
  });

  it("findRuntimeConflict(prod) : un dev qui tourne bloque le démarrage prod", () => {
    const conflict = findRuntimeConflict(
      [mk(1, "dev", "supervisor"), mk(2, "dev", "vite")],
      "prod",
    );
    // Le superviseur dev est un conflit ; le Vite (enfant) est exclu.
    assert.strictEqual(conflict.length, 1);
    assert.strictEqual(conflict[0].role, "supervisor");
  });

  it("ligne vide / header → null", () => {
    assert.strictEqual(parsePsRow(""), null);
    assert.strictEqual(parsePsRow("  PID PPID RSS %CPU ELAPSED COMMAND"), null);
  });
});

describe("devProcess — formatUptime", () => {
  it("formate par paliers lisibles", () => {
    assert.strictEqual(formatUptime(0), "0s");
    assert.strictEqual(formatUptime(45), "45s");
    assert.strictEqual(formatUptime(134), "2m14s");
    assert.strictEqual(formatUptime(3600), "1h00m");
    assert.strictEqual(formatUptime(90061), "1d 01h");
  });
});

describe("devProcess — valeurs partagées (anti-divergence)", () => {
  it("devSupervisorPidFile pointe node_modules/.cache/nodefony", () => {
    const f = devSupervisorPidFile("/app");
    assert.strictEqual(
      f,
      path.join(
        "/app",
        "node_modules",
        ".cache",
        "nodefony",
        "dev-supervisor.pid",
      ),
    );
  });

  it("defaultDevPorts : défaut, override CSV, valeur invalide", () => {
    const save = process.env.NODEFONY_DEV_PORTS;
    try {
      delete process.env.NODEFONY_DEV_PORTS;
      assert.deepStrictEqual(defaultDevPorts(), [5151, 5152]);
      process.env.NODEFONY_DEV_PORTS = "3000, 3001 ";
      assert.deepStrictEqual(defaultDevPorts(), [3000, 3001]);
      process.env.NODEFONY_DEV_PORTS = "nope";
      assert.deepStrictEqual(defaultDevPorts(), [5151, 5152]); // fallback
    } finally {
      if (save === undefined) delete process.env.NODEFONY_DEV_PORTS;
      else process.env.NODEFONY_DEV_PORTS = save;
    }
  });
});

describe("devProcess — missingWorkspaceDists (post-condition build)", () => {
  it("détecte un workspace à rolldown SANS dist ; ignore dist présent et workspace sans rolldown", () => {
    const root = path.join(os.tmpdir(), `nf-devbuild-${process.pid}`);
    try {
      mkdirSync(path.join(root, "pkgs", "a", "dist"), { recursive: true });
      mkdirSync(path.join(root, "pkgs", "b"), { recursive: true });
      mkdirSync(path.join(root, "pkgs", "c"), { recursive: true });
      writeFileSync(
        path.join(root, "package.json"),
        JSON.stringify({ workspaces: ["pkgs/*"] }),
      );
      // a : rolldown + dist présent → OK (absent de la liste)
      writeFileSync(path.join(root, "pkgs", "a", "rolldown.config.ts"), "");
      writeFileSync(
        path.join(root, "pkgs", "a", "package.json"),
        JSON.stringify({ name: "@x/a", main: "dist/index.js" }),
      );
      writeFileSync(path.join(root, "pkgs", "a", "dist", "index.js"), "");
      // b : rolldown mais PAS de dist → MANQUANT
      writeFileSync(path.join(root, "pkgs", "b", "rolldown.config.ts"), "");
      writeFileSync(
        path.join(root, "pkgs", "b", "package.json"),
        JSON.stringify({ name: "@x/b", main: "dist/index.js" }),
      );
      // c : PAS de config bundler (WIP non câblé) → ignoré même sans dist
      writeFileSync(
        path.join(root, "pkgs", "c", "package.json"),
        JSON.stringify({ name: "@x/c" }),
      );
      assert.deepStrictEqual(missingWorkspaceDists(root), ["@x/b"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("pas de package.json racine → liste vide (ne throw pas)", () => {
    const root = path.join(os.tmpdir(), `nf-devbuild-empty-${process.pid}`);
    try {
      mkdirSync(root, { recursive: true });
      assert.deepStrictEqual(missingWorkspaceDists(root), []);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
