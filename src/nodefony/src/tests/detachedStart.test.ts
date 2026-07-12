/*
 *   Tests du lancement détaché (detachedStart.ts) — volet F DevSupervisor DX.
 *
 *   Le cœur (`launchDetached`) est testé avec des CHILD FACTICES injectés
 *   (`spawnCmd`/`spawnArgs` = `node -e "…"`) : readiness réelle sur des ports
 *   éphémères, crash, timeout+group-kill — sans jamais booter Nodefony.
 *   `parseDetachArgs` (pure) couvre le strip anti-récursion des flags.
 */

import assert from "node:assert";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import {
  launchDetached,
  parseDetachArgs,
  isDetachRequested,
  DETACH_CHILD_ENV,
} from "../service/dev/detachedStart";

/** Réserve un port libre (listen(0) → close) — évite les collisions inter-suites. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address() as net.AddressInfo;
      srv.close(() => resolve(port));
    });
    srv.once("error", reject);
  });
}

/** Chemin de log jetable dans le tmpdir système. */
function tmpLog(tag: string): string {
  return path.join(
    os.tmpdir(),
    `nodefony-detach-test-${tag}-${process.pid}-${Date.now()}.log`,
  );
}

describe("parseDetachArgs — parse + strip anti-récursion", () => {
  it("strip --detach/--wait/--health/--log des args relayés", () => {
    const p = parseDetachArgs([
      "development",
      "--detach",
      "--wait",
      "60",
      "--health",
      "/ping",
      "--log",
      "/tmp/x.log",
      "-d",
    ]);
    assert.strictEqual(p.detach, true);
    assert.strictEqual(p.waitSec, 60);
    assert.strictEqual(p.healthPath, "/ping");
    assert.strictEqual(p.logFile, "/tmp/x.log");
    // Les flags du détacheur ne sont JAMAIS relayés (— sinon récursion infinie),
    // le reste passe tel quel (commande + options du runtime).
    assert.deepStrictEqual(p.relayArgs, ["development", "-d"]);
  });

  it("forme --opt=valeur acceptée", () => {
    const p = parseDetachArgs(["cluster", "--wait=30", "--health=/h"]);
    assert.strictEqual(p.waitSec, 30);
    assert.strictEqual(p.healthPath, "/h");
    assert.deepStrictEqual(p.relayArgs, ["cluster"]);
  });

  it("défauts : wait 120, pas de health/log", () => {
    const p = parseDetachArgs(["development", "--detach"]);
    assert.strictEqual(p.waitSec, 120);
    assert.strictEqual(p.healthPath, undefined);
    assert.strictEqual(p.logFile, undefined);
  });

  it("isDetachRequested — vrai sur --detach, faux dans le child (anti-récursion)", () => {
    assert.strictEqual(isDetachRequested(["development", "--detach"]), true);
    assert.strictEqual(isDetachRequested(["development"]), false);
    process.env[DETACH_CHILD_ENV] = "1";
    try {
      assert.strictEqual(isDetachRequested(["development", "--detach"]), false);
    } finally {
      delete process.env[DETACH_CHILD_ENV];
    }
  });
});

describe("launchDetached — readiness / crash / timeout (child factices)", () => {
  vi.setConfig({ testTimeout: 30000, hookTimeout: 30000 });

  it("readiness : child qui ouvre les ports → ok, exit 0, log capturé", async () => {
    const [p1, p2] = [await freePort(), await freePort()];
    const log = tmpLog("ready");
    try {
      // Child factice : ouvre les 2 ports après 300 ms puis reste vivant.
      const script = `
        const net = require("node:net");
        console.log("[dev] fake boot");
        setTimeout(() => {
          net.createServer().listen(${p1}, "127.0.0.1");
          net.createServer().listen(${p2}, "127.0.0.1");
          console.log("listening");
        }, 300);
        setInterval(() => {}, 1 << 30);
      `;
      const r = await launchDetached({
        spawnCmd: process.execPath,
        spawnArgs: ["-e", script],
        logFile: log,
        ports: [p1, p2],
        waitSec: 15,
      });
      assert.strictEqual(r.ok, true, `attendu ok — reason: ${r.reason}`);
      assert.strictEqual(r.exitCode, 0);
      assert.ok(typeof r.pid === "number" && r.pid > 0);
      // Readiness = AU MoINS un port (la sonde peut rendre la main entre les
      // deux listen du child) — l'état par port reste rapporté.
      assert.ok(r.ports.some((p) => p.listening));
      // Le stdout du child va bien dans le log file.
      assert.ok(fs.readFileSync(log, "utf8").includes("[dev] fake boot"));
      // Cleanup : tuer le child factice détaché (leader de groupe).
      try {
        process.kill(-(r.pid as number), "SIGKILL");
      } catch {
        process.kill(r.pid as number, "SIGKILL");
      }
    } finally {
      fs.rmSync(log, { force: true });
    }
  });

  it("readiness partielle : UN SEUL port ouvert sur 2 sondés → ok (app https:false)", async () => {
    const [p1, p2] = [await freePort(), await freePort()];
    const log = tmpLog("partial");
    try {
      // Child factice type app `https: false` : n'ouvrira JAMAIS le 2ᵉ port —
      // la liste sondée est une CONVENTION du parent, pas la topologie réelle.
      const script = `
        const net = require("node:net");
        setTimeout(() => net.createServer().listen(${p1}, "127.0.0.1"), 300);
        setInterval(() => {}, 1 << 30);
      `;
      const r = await launchDetached({
        spawnCmd: process.execPath,
        spawnArgs: ["-e", script],
        logFile: log,
        ports: [p1, p2],
        waitSec: 15,
      });
      assert.strictEqual(r.ok, true, `attendu ok — reason: ${r.reason}`);
      // Fail-loud : le port jamais ouvert reste VISIBLE comme fermé dans l'état.
      assert.strictEqual(r.ports.find((p) => p.port === p1)?.listening, true);
      assert.strictEqual(r.ports.find((p) => p.port === p2)?.listening, false);
      try {
        process.kill(-(r.pid as number), "SIGKILL");
      } catch {
        process.kill(r.pid as number, "SIGKILL");
      }
    } finally {
      fs.rmSync(log, { force: true });
    }
  });

  it("crash : child qui meurt avant la readiness → EX_UNAVAILABLE + diagnostic", async () => {
    const p1 = await freePort();
    const log = tmpLog("crash");
    try {
      const script = `console.error("boom fatal"); process.exit(3);`;
      const r = await launchDetached({
        spawnCmd: process.execPath,
        spawnArgs: ["-e", script],
        logFile: log,
        ports: [p1],
        waitSec: 15,
      });
      assert.strictEqual(r.ok, false);
      assert.strictEqual(r.exitCode, 69); // EX_UNAVAILABLE
      assert.ok(
        r.reason?.includes("exit 3"),
        `reason doit porter le code du child : ${r.reason}`,
      );
      // Le diagnostic embarque la fin du log (stderr du child).
      assert.ok(r.logTail?.some((l) => l.includes("boom fatal")));
    } finally {
      fs.rmSync(log, { force: true });
    }
  });

  it("timeout : child vivant sans readiness → EX_UNAVAILABLE + child group-killé", async () => {
    const p1 = await freePort();
    const log = tmpLog("timeout");
    try {
      // Child vivant qui n'ouvre JAMAIS le port.
      const script = `setInterval(() => {}, 1 << 30);`;
      const r = await launchDetached({
        spawnCmd: process.execPath,
        spawnArgs: ["-e", script],
        logFile: log,
        ports: [p1],
        waitSec: 2,
      });
      assert.strictEqual(r.ok, false);
      assert.strictEqual(r.exitCode, 69);
      assert.ok(r.reason?.includes("readiness non atteinte"));
      // Pas de runtime zombie : le child a été group-killé.
      await new Promise((rr) => setTimeout(rr, 300));
      assert.throws(
        () => process.kill(r.pid as number, 0),
        "le child doit être mort après le timeout (group-kill)",
      );
    } finally {
      fs.rmSync(log, { force: true });
    }
  });
});
