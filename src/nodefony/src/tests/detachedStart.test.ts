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

/**
 * Tue un child factice détaché (leader de son groupe).
 *
 * À appeler depuis un `finally`, JAMAIS en fin de corps de test : ces children
 * tournent sur un `setInterval(() => {}, 1 << 30)` — une assertion qui échoue
 * avant le nettoyage en laisse un immortel sur la machine. Vécu : un résidu
 * découvert plus d'un jour après le run qui l'avait engendré.
 *
 * Tolérant par construction (pid absent, process déjà mort) — un nettoyage ne
 * doit jamais masquer l'échec qu'il suit.
 */
function killDetached(pid: number | undefined): void {
  if (!pid) return;
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      /* déjà mort — rien à nettoyer */
    }
  }
}

describe("launchDetached — readiness / crash / timeout (child factices)", () => {
  vi.setConfig({ testTimeout: 30000, hookTimeout: 30000 });

  it("readiness : child qui ouvre les ports → ok, exit 0, log capturé", async () => {
    const [p1, p2] = [await freePort(), await freePort()];
    const log = tmpLog("ready");
    let childPid: number | undefined;
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
      childPid = r.pid as number;
      assert.strictEqual(r.ok, true, `attendu ok — reason: ${r.reason}`);
      assert.strictEqual(r.exitCode, 0);
      assert.ok(typeof r.pid === "number" && r.pid > 0);
      // Readiness = AU MoINS un port (la sonde peut rendre la main entre les
      // deux listen du child) — l'état par port reste rapporté.
      assert.ok(r.ports.some((p) => p.listening));
      // Le stdout du child va bien dans le log file.
      assert.ok(fs.readFileSync(log, "utf8").includes("[dev] fake boot"));
    } finally {
      killDetached(childPid);
      fs.rmSync(log, { force: true });
    }
  });

  it("readiness partielle : UN SEUL port ouvert sur 2 sondés → ok (app https:false)", async () => {
    const [p1, p2] = [await freePort(), await freePort()];
    const log = tmpLog("partial");
    let childPid: number | undefined;
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
      childPid = r.pid as number;
      assert.strictEqual(r.ok, true, `attendu ok — reason: ${r.reason}`);
      // Fail-loud : le port jamais ouvert reste VISIBLE comme fermé dans l'état.
      assert.strictEqual(r.ports.find((p) => p.port === p1)?.listening, true);
      assert.strictEqual(r.ports.find((p) => p.port === p2)?.listening, false);
    } finally {
      killDetached(childPid);
      fs.rmSync(log, { force: true });
    }
  });

  it("port HORS convention : le child publie le state file → readiness sur SES ports", async () => {
    // Le cas d'une app qui déclare son port (PaaS `PORT`, ingress, `servers.http.port`) :
    // elle écoute ailleurs que la convention du parent — et ce, `portPolicy: "strict"`
    // compris (le glissement `auto` n'est PAS la seule sortie de la convention). Sans
    // le state file, la sonde ne verrait rien, attendrait son plafond, puis
    // group-killerait un serveur qui écoutait parfaitement.
    const [conv1, conv2, real] = [
      await freePort(),
      await freePort(),
      await freePort(),
    ];
    const cwd = fs.mkdtempSync(
      path.join(os.tmpdir(), "nodefony-detach-state-"),
    );
    const log = tmpLog("state");
    let childPid: number | undefined;
    try {
      // Child factice : écoute sur `real` (jamais sondé par le parent) PUIS publie
      // ses ports effectifs, exactement comme le fait `HttpKernel.publishRuntimePorts`.
      const stateFile = path.join(
        cwd,
        "node_modules",
        ".cache",
        "nodefony",
        "runtime.json",
      );
      const script = `
        const net = require("node:net");
        const fs = require("node:fs");
        const path = require("node:path");
        setTimeout(() => {
          net.createServer().listen(${real}, "127.0.0.1", () => {
            fs.mkdirSync(path.dirname(${JSON.stringify(stateFile)}), { recursive: true });
            fs.writeFileSync(${JSON.stringify(stateFile)}, JSON.stringify({
              pid: process.pid, ports: [${real}], desiredPorts: [${real}], ts: Date.now(),
            }));
          });
        }, 300);
        setInterval(() => {}, 1 << 30);
      `;
      const r = await launchDetached({
        spawnCmd: process.execPath,
        spawnArgs: ["-e", script],
        logFile: log,
        cwd,
        ports: [conv1, conv2], // la CONVENTION du parent — aucun ne sera ouvert
        waitSec: 15,
      });
      childPid = r.pid as number;
      assert.strictEqual(r.ok, true, `attendu ok — reason: ${r.reason}`);
      assert.strictEqual(r.exitCode, 0);
      // La readiness a suivi le state file : elle rapporte le port RÉEL, pas la
      // convention qu'on lui avait passée.
      assert.deepStrictEqual(
        r.ports.map((p) => p.port),
        [real],
      );
      assert.strictEqual(r.ports[0].listening, true);
    } finally {
      killDetached(childPid);
      fs.rmSync(log, { force: true });
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("ports tenus par un TIERS : le child n'écoute jamais → PAS de faux READY", async () => {
    // Le piège du banc devkit : un AUTRE serveur occupe les ports sondés. Une
    // readiness qui ne regarde que « ça écoute » déclare prêt — et tout ce qui
    // suit interroge l'application du voisin (symptôme : 404 partout, y compris
    // sur les routes du gabarit). La readiness doit exiger la preuve que c'est
    // NOTRE runtime qui répond : le state file publié par lui.
    const [conv1, conv2] = [await freePort(), await freePort()];
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "nodefony-detach-3rd-"));
    const log = tmpLog("thirdparty");
    const squatters = [conv1, conv2].map((p) =>
      net.createServer().listen(p, "127.0.0.1"),
    );
    let childPid: number | undefined;
    try {
      // Child vivant qui n'ouvre RIEN et ne publie RIEN — le seul écho sur les
      // ports vient du tiers.
      const r = await launchDetached({
        spawnCmd: process.execPath,
        spawnArgs: ["-e", "setInterval(() => {}, 1 << 30);"],
        logFile: log,
        cwd,
        ports: [conv1, conv2],
        waitSec: 2,
      });
      childPid = r.pid as number;
      assert.strictEqual(
        r.ok,
        false,
        "un port tenu par un TIERS ne prouve rien : jamais de READY",
      );
      assert.strictEqual(r.exitCode, 69);
    } finally {
      killDetached(childPid);
      for (const s of squatters) s.close();
      fs.rmSync(log, { force: true });
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("glissement de ports : le décalage config→effectif est RAPPORTÉ", async () => {
    // `portPolicy: "auto"` : les ports voulus sont pris, l'app glisse ailleurs.
    // Elle démarre très bien — mais quiconque garde le port de la config tape
    // chez l'occupant et reçoit 404 partout. Le résultat doit porter le décalage.
    const [wanted, real] = [await freePort(), await freePort()];
    const cwd = fs.mkdtempSync(
      path.join(os.tmpdir(), "nodefony-detach-shift-"),
    );
    const log = tmpLog("shift");
    let childPid: number | undefined;
    try {
      const stateFile = path.join(
        cwd,
        "node_modules",
        ".cache",
        "nodefony",
        "runtime.json",
      );
      const script = `
        const net = require("node:net");
        const fs = require("node:fs");
        const path = require("node:path");
        setTimeout(() => {
          net.createServer().listen(${real}, "127.0.0.1", () => {
            fs.mkdirSync(path.dirname(${JSON.stringify(stateFile)}), { recursive: true });
            fs.writeFileSync(${JSON.stringify(stateFile)}, JSON.stringify({
              pid: process.pid, ports: [${real}], desiredPorts: [${wanted}], ts: Date.now(),
            }));
          });
        }, 300);
        setInterval(() => {}, 1 << 30);
      `;
      const r = await launchDetached({
        spawnCmd: process.execPath,
        spawnArgs: ["-e", script],
        logFile: log,
        cwd,
        ports: [wanted],
        waitSec: 15,
      });
      childPid = r.pid as number;
      assert.strictEqual(r.ok, true, `attendu ok — reason: ${r.reason}`);
      assert.deepStrictEqual(
        r.desiredPorts,
        [wanted],
        "le port DEMANDÉ doit être rapporté quand l'app a glissé",
      );
      assert.deepStrictEqual(
        r.ports.map((p) => p.port),
        [real],
      );
    } finally {
      killDetached(childPid);
      fs.rmSync(log, { force: true });
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("pas de glissement : aucun décalage rapporté (silence quand tout va bien)", async () => {
    // Contrôle : `desiredPorts` ne doit PAS s'allumer quand l'app écoute là où
    // elle voulait — sinon l'avertissement devient du bruit permanent.
    const real = await freePort();
    const cwd = fs.mkdtempSync(
      path.join(os.tmpdir(), "nodefony-detach-noshift-"),
    );
    const log = tmpLog("noshift");
    let childPid: number | undefined;
    try {
      const stateFile = path.join(
        cwd,
        "node_modules",
        ".cache",
        "nodefony",
        "runtime.json",
      );
      const script = `
        const net = require("node:net");
        const fs = require("node:fs");
        const path = require("node:path");
        setTimeout(() => {
          net.createServer().listen(${real}, "127.0.0.1", () => {
            fs.mkdirSync(path.dirname(${JSON.stringify(stateFile)}), { recursive: true });
            fs.writeFileSync(${JSON.stringify(stateFile)}, JSON.stringify({
              pid: process.pid, ports: [${real}], desiredPorts: [${real}], ts: Date.now(),
            }));
          });
        }, 300);
        setInterval(() => {}, 1 << 30);
      `;
      const r = await launchDetached({
        spawnCmd: process.execPath,
        spawnArgs: ["-e", script],
        logFile: log,
        cwd,
        ports: [real],
        waitSec: 15,
      });
      childPid = r.pid as number;
      assert.strictEqual(r.ok, true, `attendu ok — reason: ${r.reason}`);
      assert.strictEqual(r.desiredPorts, undefined);
    } finally {
      killDetached(childPid);
      fs.rmSync(log, { force: true });
      fs.rmSync(cwd, { recursive: true, force: true });
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
    let childPid: number | undefined;
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
      childPid = r.pid as number;
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
      // Ceinture : si l'assertion ci-dessus tombe, c'est justement que le child
      // a SURVÉCU — le laisser en vie doublerait le dégât.
      killDetached(childPid);
      fs.rmSync(log, { force: true });
    }
  });
});
