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
  childEnv,
  launchDetached,
  parseDetachArgs,
  isDetachRequested,
  DETACH_CHILD_ENV,
} from "../service/dev/detachedStart";
import { DELEGATED_ENV } from "../bin/resolveLocalCli";
import { signalProcessGroup, waitAllDead } from "../service/dev/devProcess";
import { isWatchDisabled } from "../kernel/commands/DevCommand";

/**
 * Borne HAUTE de la zone où ces bancs tirent leurs ports.
 *
 * Toutes les plateformes placent leur plage ÉPHÉMÈRE au-dessus : 32768 sous
 * Linux, 49152 sous macOS et Windows. Rester en dessous est ce qui rend le port
 * ré-attribuable à NOUS SEULS.
 */
const PORT_CEILING = 32768;

/** Base de tirage, décalée par process pour que deux workers ne se croisent pas. */
let portCursor = 21000 + (process.pid % 500) * 20;

/**
 * Réserve un port libre pour un child factice, HORS de la plage éphémère.
 *
 * Le `listen(0) → close` d'origine demandait un port au noyau — qui le prend
 * dans sa plage éphémère, donc dans le vivier où il puise aussi pour les
 * connexions SORTANTES. Entre notre `close` et le `listen` du child (300 ms plus
 * loin dans ces scénarios), n'importe quel `npm`, worker vitest ou requête du
 * runner pouvait se voir attribuer ce port : le child mourait sur `EADDRINUSE`,
 * et le banc accusait `launchDetached` d'avoir raté sa readiness. Observé en
 * intégration continue, sur Linux seulement — c'est la plateforme dont la plage
 * éphémère commence le plus bas, donc celle où la collision est la plus probable.
 *
 * Sous {@link PORT_CEILING}, un port ne s'attribue plus tout seul : seul un autre
 * banc pourrait le prendre, d'où le curseur monotone décalé par PID. Le port est
 * quand même ÉPROUVÉ libre avant d'être rendu — un vrai service local a le droit
 * d'être là, on passe au suivant.
 */
async function freePort(): Promise<number> {
  for (let attempt = 0; attempt < 200; attempt++) {
    const port = portCursor++;
    if (portCursor >= PORT_CEILING) portCursor = 21000;
    const free = await new Promise<boolean>((resolve) => {
      const srv = net.createServer();
      srv.once("error", () => resolve(false));
      srv.listen(port, "127.0.0.1", () => srv.close(() => resolve(true)));
    });
    if (free) return port;
  }
  throw new Error("aucun port libre sous la plage éphémère");
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
 *
 * Rend la main quand le process est RÉELLEMENT mort, pas quand le signal est parti :
 * ce qui suit (la suppression du répertoire de travail) échoue sous Windows tant
 * qu'un process y a son répertoire courant. Envoyer un signal n'est pas une preuve
 * de mort — elle se constate.
 */
async function killDetached(pid: number | undefined): Promise<void> {
  if (!pid) return;
  // Même implémentation que le reste du dépôt : groupe POSIX / `taskkill /T` Windows.
  signalProcessGroup(pid, "SIGKILL");
  // `waitAllDead` RETOURNE les survivants — il ne lève rien. Ignorer sa valeur
  // faisait rendre la main comme si la mort était acquise : le nettoyage partait
  // sur un répertoire encore tenu, et rougissait en `EPERM` sous Windows pour une
  // faute qui n'était pas la sienne. Un process qui survit à SIGKILL est le VRAI
  // danger que ce nettoyage existe pour éviter (un immortel sur la machine) : il
  // se dit, fort, au lieu de se déduire d'un `EPERM` deux lignes plus bas.
  const survivants = await waitAllDead([pid], 5000);
  if (survivants.length > 0) {
    console.warn(
      `[detachedStart] process ${survivants.join(", ")} survit à SIGKILL après 5 s — ` +
        `le répertoire de travail restera probablement verrouillé (Windows).`,
    );
  }
}

/**
 * Supprime le répertoire de travail d'un child qu'on vient de tuer.
 *
 * Windows refuse de supprimer un dossier tant qu'un process l'a pour répertoire
 * courant : la suppression échoue en `EPERM`, DANS le `finally` — ce qui fait échouer
 * un test dont toutes les assertions sont passées. C'est ce qui rougissait ici, et
 * seulement pour les cas qui se donnent un répertoire de travail.
 *
 * Le remède tient à l'ORDRE, pas au nombre d'essais : {@link killDetached} attend
 * désormais la mort EFFECTIVE du process avant qu'on arrive ici. Une fenêtre subsiste
 * (le système relâche le verrou peu après la mort), et les réessais de Node la
 * couvrent — en ceinture. Sans effet sous POSIX, où la suppression passe du premier coup.
 */
function removeWorkDir(dir: string): void {
  try {
    fs.rmSync(dir, {
      recursive: true,
      force: true,
      maxRetries: 20,
      retryDelay: 50,
    });
  } catch (e) {
    // 🔴 Un NETTOYAGE qui échoue ne doit jamais invalider des assertions qui sont
    // passées. C'est exactement ce qui rougissait la plateforme Windows en
    // intégration continue : le test avait tout vérifié, et tombait dans son
    // `finally` sur un verrou que le système n'avait pas encore relâché.
    //
    // Le dossier vit dans le temporaire de la machine — l'y laisser coûte un
    // répertoire vide que l'OS balaiera, quand faire échouer le run coûte un
    // diagnostic entier sur une piste fausse. On AVERTIT (le résidu se constate)
    // sans transformer un ménage imparfait en échec de mesure.
    console.warn(
      `[detachedStart] répertoire de travail non supprimé : ${dir} — ` +
        `${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

describe("development --no-watch — la sortie explicite du superviseur", () => {
  it("reconnu sur argv, et seulement lui", () => {
    assert.strictEqual(isWatchDisabled(["development", "--no-watch"]), true);
    assert.strictEqual(isWatchDisabled(["development"]), false);
    // Ni `--watch` (qui n'existe pas), ni une occurrence en sous-chaîne.
    assert.strictEqual(isWatchDisabled(["development", "--watch"]), false);
    assert.strictEqual(
      isWatchDisabled(["development", "--no-watchdog"]),
      false,
    );
  });

  it("cohabite avec le lancement détaché : le flag SURVIT au relais vers l'enfant", () => {
    // `--detach` est retiré des args relayés (anti-récursion), `--no-watch` non :
    // sans quoi le child détaché relancerait un superviseur, et l'intention serait
    // perdue au passage exact où elle compte.
    const p = parseDetachArgs(["development", "--no-watch", "--detach"]);
    assert.strictEqual(p.detach, true);
    assert.deepStrictEqual(p.relayArgs, ["development", "--no-watch"]);
    assert.strictEqual(isWatchDisabled(p.relayArgs), true);
  });
});

describe("le décor du banc — les ports qu'il réserve", () => {
  it("hors de la plage éphémère du système (sinon le child perd son port)", async () => {
    // La garde de l'invariant, pas une redite du helper : le `listen(0)` d'avant
    // rendait un port éphémère (≥ 32768) et ce cas serait tombé. C'est ce qui
    // rendait la readiness ROUGE en intégration continue, une fois sur beaucoup.
    for (let i = 0; i < 5; i++) {
      const port = await freePort();
      assert.ok(
        port > 1024 && port < PORT_CEILING,
        `port ${port} hors de la zone réservée au banc (1024 < p < ${PORT_CEILING})`,
      );
    }
  });
});

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
      assert.strictEqual(
        r.ok,
        true,
        // Le journal du child, sinon « process mort avant la readiness (exit 1) »
        // ne dit RIEN de la cause — et c'est précisément le message qu'on a
        // récolté en intégration continue, sans pouvoir conclure.
        `attendu ok — reason: ${r.reason}\njournal du child :\n${r.logTail ?? "(vide)"}`,
      );
      assert.strictEqual(r.exitCode, 0);
      assert.ok(typeof r.pid === "number" && r.pid > 0);
      // Readiness = AU MoINS un port (la sonde peut rendre la main entre les
      // deux listen du child) — l'état par port reste rapporté.
      assert.ok(r.ports.some((p) => p.listening));
      // Le stdout du child va bien dans le log file.
      assert.ok(fs.readFileSync(log, "utf8").includes("[dev] fake boot"));
    } finally {
      await killDetached(childPid);
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
      assert.strictEqual(
        r.ok,
        true,
        // Le journal du child, sinon « process mort avant la readiness (exit 1) »
        // ne dit RIEN de la cause — et c'est précisément le message qu'on a
        // récolté en intégration continue, sans pouvoir conclure.
        `attendu ok — reason: ${r.reason}\njournal du child :\n${r.logTail ?? "(vide)"}`,
      );
      // Fail-loud : le port jamais ouvert reste VISIBLE comme fermé dans l'état.
      assert.strictEqual(r.ports.find((p) => p.port === p1)?.listening, true);
      assert.strictEqual(r.ports.find((p) => p.port === p2)?.listening, false);
    } finally {
      await killDetached(childPid);
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
      assert.strictEqual(
        r.ok,
        true,
        // Le journal du child, sinon « process mort avant la readiness (exit 1) »
        // ne dit RIEN de la cause — et c'est précisément le message qu'on a
        // récolté en intégration continue, sans pouvoir conclure.
        `attendu ok — reason: ${r.reason}\njournal du child :\n${r.logTail ?? "(vide)"}`,
      );
      assert.strictEqual(r.exitCode, 0);
      // La readiness a suivi le state file : elle rapporte le port RÉEL, pas la
      // convention qu'on lui avait passée.
      assert.deepStrictEqual(
        r.ports.map((p) => p.port),
        [real],
      );
      assert.strictEqual(r.ports[0].listening, true);
    } finally {
      await killDetached(childPid);
      fs.rmSync(log, { force: true });
      removeWorkDir(cwd);
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
      await killDetached(childPid);
      for (const s of squatters) s.close();
      fs.rmSync(log, { force: true });
      removeWorkDir(cwd);
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
      assert.strictEqual(
        r.ok,
        true,
        // Le journal du child, sinon « process mort avant la readiness (exit 1) »
        // ne dit RIEN de la cause — et c'est précisément le message qu'on a
        // récolté en intégration continue, sans pouvoir conclure.
        `attendu ok — reason: ${r.reason}\njournal du child :\n${r.logTail ?? "(vide)"}`,
      );
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
      await killDetached(childPid);
      fs.rmSync(log, { force: true });
      removeWorkDir(cwd);
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
      assert.strictEqual(
        r.ok,
        true,
        // Le journal du child, sinon « process mort avant la readiness (exit 1) »
        // ne dit RIEN de la cause — et c'est précisément le message qu'on a
        // récolté en intégration continue, sans pouvoir conclure.
        `attendu ok — reason: ${r.reason}\njournal du child :\n${r.logTail ?? "(vide)"}`,
      );
      assert.strictEqual(r.desiredPorts, undefined);
    } finally {
      await killDetached(childPid);
      fs.rmSync(log, { force: true });
      removeWorkDir(cwd);
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
      await killDetached(childPid);
      fs.rmSync(log, { force: true });
    }
  });
});

/*
 * Ce que le child NE DOIT PAS hériter.
 *
 * Défaut vécu, et invisible partout où le CLI global et le CLI local sont le
 * même code (monorepo, `create app --link`) : sur une application installée
 * depuis les tarballs, `nodefony production --detach` bootait le framework du
 * CLI GLOBAL contre l'application locale — un seul module chargé sur huit, puis
 * « profil serveur mais aucun serveur en écoute », sans un mot sur la cause.
 *
 * La garde de délégation décrit l'état du process COURANT (« j'ai déjà chargé
 * le CLI de l'app, je n'ai plus à déléguer ») ; héritée par un child relancé
 * sur le binaire d'ENTRÉE, elle lui interdit la délégation qui l'aurait renvoyé
 * vers le CLI de l'application.
 */
describe("l'environnement du child détaché — ce qui ne franchit PAS le spawn", () => {
  it("childEnv : garde de délégation retirée, marqueur anti-récursion posé", () => {
    const env = childEnv(
      { PATH: "/bin", [DELEGATED_ENV]: "1" },
      { NF_PORT: "1234" },
    );
    assert.strictEqual(
      env[DELEGATED_ENV],
      undefined,
      "la garde de délégation ne se propage pas : le child doit pouvoir redéléguer",
    );
    assert.strictEqual(env[DETACH_CHILD_ENV], "1");
    assert.strictEqual(env.NF_PORT, "1234");
    assert.strictEqual(env.PATH, "/bin", "le reste de l'environnement passe");
  });

  it("au SPAWN réel : le child ne voit pas la garde que porte le parent", async () => {
    const p1 = await freePort();
    const log = tmpLog("delegated");
    let childPid: number | undefined;
    const saved = process.env[DELEGATED_ENV];
    // Le parent est dans l'état exact du CLI global ayant délégué au CLI local.
    process.env[DELEGATED_ENV] = "1";
    try {
      // Le child RAPPORTE ce qu'il a reçu — c'est son env constaté qui juge,
      // pas la façon dont on l'a composé.
      const script = `
        const net = require("node:net");
        console.log("DELEGATED=" + String(process.env.${DELEGATED_ENV}));
        console.log("DETACH_CHILD=" + String(process.env.${DETACH_CHILD_ENV}));
        net.createServer().listen(${p1}, "127.0.0.1");
        setInterval(() => {}, 1 << 30);
      `;
      const r = await launchDetached({
        spawnCmd: process.execPath,
        spawnArgs: ["-e", script],
        logFile: log,
        ports: [p1],
        waitSec: 15,
      });
      childPid = r.pid as number;
      assert.strictEqual(r.ok, true, `attendu ok — reason: ${r.reason}`);
      const journal = fs.readFileSync(log, "utf8");
      assert.ok(
        journal.includes("DELEGATED=undefined"),
        `le child a hérité la garde de délégation — il exécutera le CLI global ` +
          `contre l'application locale.\njournal du child :\n${journal}`,
      );
      assert.ok(journal.includes("DETACH_CHILD=1"));
    } finally {
      await killDetached(childPid);
      fs.rmSync(log, { force: true });
      if (saved === undefined) delete process.env[DELEGATED_ENV];
      else process.env[DELEGATED_ENV] = saved;
    }
  });
});
