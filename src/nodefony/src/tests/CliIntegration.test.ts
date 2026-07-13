/*
 *   Tests d'INTÉGRATION CLI — exécutent le binaire réel `node bin/nodefony <cmd>`.
 *
 *   Complète les tests UNITAIRES de dispatch (CliKernelDispatch.test.ts, classification
 *   sans boot) : ici on spawn le process complet et on observe son comportement de bout
 *   en bout. C'est le FILET qui sécurise le refacto « parse-pur + registry + 1 seul
 *   Kernel » (cf project_cli_module_command_dispatch).
 *
 *   Deux familles :
 *   - commandes TERMINANTES (--help / --version) : process sort seul, rapide → assert
 *     exit code + sortie. Gardées par la présence du `dist/` (le bin importe `nodefony`).
 *   - commandes SERVEUR + typo : bootent l'app réelle → lourdes, gardées par RUN_CLI_BOOT=1.
 *     Le cœur = INVARIANT BOOT-COUNT : `production`/`cluster -w1` ne doivent créer qu'UN
 *     SEUL Kernel par process (avant refacto : 2 → ces asserts sont RED jusqu'à l'étape C).
 *     Observé via NODEFONY_KERNEL_TRACE_FILE (1 ligne par `new Kernel()`).
 */

import assert from "node:assert";
import { spawn, ChildProcess } from "node:child_process";
import { connect } from "node:net";
import https from "node:https";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url)); // src/nodefony/src/tests
const CORE_ROOT = path.resolve(HERE, "../.."); // src/nodefony
const REPO_ROOT = path.resolve(CORE_ROOT, "../.."); // racine repo (= app dev)
const BIN = path.join(CORE_ROOT, "bin", "nodefony");
const DIST = path.join(CORE_ROOT, "dist", "node", "index.js"); // entrée `import` (cf package.json exports)

const HTTP_PORT = 5151; // port http principal de l'app dev — sert au garde-fou EADDRINUSE
const HTTPS_PORT = 5152; // port https/http2 (probe d'intégrité, cert auto-signé)
const READY_RE = /Server Listen on/i; // marqueur readiness (server-static.ts)
const SERVER_NET_RE = /Server Listen on http/i; // serveur RÉSEAU (exclut les statics)
const FAILSOFT_RE = /Cannot find package/i; // module physiquement introuvable → fail-soft
const RUN_BOOT = process.env.RUN_CLI_BOOT === "1";

/** Résultat d'un spawn d'une commande terminante. */
interface CliResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

/** Spawn `node bin/nodefony <args>` et attend la sortie du process (commandes terminantes). */
function runCli(
  args: string[],
  timeoutMs = 30000,
  extraEnv?: Record<string, string>,
): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [BIN, ...args], {
      cwd: REPO_ROOT,
      env: { ...process.env, ...extraEnv },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(
        new Error(`runCli timeout (${timeoutMs}ms) for: ${args.join(" ")}`),
      );
    }, timeoutMs);
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("exit", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr });
    });
  });
}

/** true si un serveur écoute déjà sur le port (garde-fou conflit pour les tests serveur). */
function isPortOpen(port: number, timeoutMs = 500): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = connect(port, "127.0.0.1");
    const done = (open: boolean) => {
      sock.destroy();
      resolve(open);
    };
    sock.setTimeout(timeoutMs);
    sock.once("connect", () => done(true));
    sock.once("timeout", () => done(false));
    sock.once("error", () => done(false));
  });
}

/** Compte les lignes non vides du trace file (1 ligne = 1 `new Kernel()`). */
function countKernelBoots(traceFile: string): number {
  if (!fs.existsSync(traceFile)) return 0;
  return fs
    .readFileSync(traceFile, "utf8")
    .split("\n")
    .filter((l) => l.trim().length > 0).length;
}

/** GET https://127.0.0.1:5152<path> (cert auto-signé accepté) → status code. */
function httpsGetStatus(p: string, timeoutMs = 6000): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = https.get(
      {
        host: "127.0.0.1",
        port: HTTPS_PORT,
        path: p,
        rejectUnauthorized: false,
        timeout: timeoutMs,
      },
      (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      },
    );
    req.once("error", reject);
    req.once("timeout", () => {
      req.destroy();
      reject(new Error(`https GET timeout ${p}`));
    });
  });
}

/** Tue un child et attend sa sortie (SIGTERM puis SIGKILL de secours). */
function killAndWait(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    const hard = setTimeout(() => child.kill("SIGKILL"), 5000);
    child.once("exit", () => {
      clearTimeout(hard);
      resolve();
    });
    child.kill("SIGTERM");
  });
}

/**
 * Spawn une commande SERVEUR, attend la readiness (regex stdout), compte les `new Kernel()`
 * via le trace file, puis tue le process. Retourne le boot-count observé.
 */
async function spawnServerAndCountBoots(
  args: string[],
  readyTimeoutMs = 45000,
): Promise<{ boots: number; out: string }> {
  const traceFile = path.join(
    os.tmpdir(),
    `nodefony-kernel-trace-${process.pid}-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}.log`,
  );
  const child = spawn(process.execPath, [BIN, ...args], {
    cwd: REPO_ROOT,
    env: { ...process.env, NODEFONY_KERNEL_TRACE_FILE: traceFile },
  });
  let out = "";
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () =>
          reject(new Error(`readiness timeout — no "${READY_RE}" in:\n${out}`)),
        readyTimeoutMs,
      );
      const onData = (d: Buffer) => {
        out += d.toString();
        if (READY_RE.test(out)) {
          clearTimeout(timer);
          resolve();
        }
      };
      child.stdout.on("data", onData);
      child.stderr.on("data", onData);
      child.once("error", (e) => {
        clearTimeout(timer);
        reject(e);
      });
      child.once("exit", (code, signal) => {
        clearTimeout(timer);
        reject(
          new Error(
            `process exited (code=${code} signal=${signal}) before readiness:\n${out}`,
          ),
        );
      });
    });
    // À la readiness, le(s) Kernel(s) sont tous construits (kernel#2 est créé AVANT son
    // propre boot serveur). Le compte est donc stable et fiable ici.
    const boots = countKernelBoots(traceFile);
    return { boots, out };
  } finally {
    await killAndWait(child);
    try {
      fs.rmSync(traceFile, { force: true });
    } catch {
      /* best-effort cleanup */
    }
  }
}

// Skip si le dist n'est pas bâti (le bin importe `nodefony` depuis dist).
describe.skipIf(!fs.existsSync(DIST))(
  "CLI integration — commandes terminantes (--help / --version)",
  () => {
    vi.setConfig({ testTimeout: 40000, hookTimeout: 40000 });

    it("--help → exit 0 et liste les commandes built-in", async () => {
      const r = await runCli(["--help"]);
      assert.strictEqual(
        r.code,
        0,
        `exit code attendu 0, reçu ${r.code}\n${r.stderr}`,
      );
      const txt = r.stdout + r.stderr;
      for (const name of ["production", "cluster", "build", "development"]) {
        assert.ok(txt.includes(name), `--help doit lister "${name}"\n${txt}`);
      }
    });

    it("--help (production) liste les commandes des modules MANDATORY, pas les dev-only", async () => {
      // Sans commande d'env, le bin résout le mode runtime au défaut PRODUCTION
      // (12-factor safe — cf Kernel.resolveRuntimeEnv). On le force ici pour un test
      // déterministe quel que soit le NODE_ENV de la suite mocha.
      const r = await runCli(["--help"], 30000, { NODE_ENV: "production" });
      assert.strictEqual(
        r.code,
        0,
        `exit code attendu 0, reçu ${r.code}\n${r.stderr}`,
      );
      const txt = r.stdout + r.stderr;
      // Commandes posées par des modules MANDATORY (@nodefony/http → network,
      // @nodefony/frontend → frontend:build) : présentes même en production.
      for (const name of ["network", "frontend:build"]) {
        assert.ok(
          txt.includes(name),
          `--help doit lister la commande de module "${name}"\n${txt}`,
        );
      }
      // Les commandes des modules `policy:"dev"` (ex. test:batch du module
      // @nodefony/test) sont légitimement ABSENTES du help en production (gating).
      assert.ok(
        !txt.includes("test:batch"),
        `--help en production ne doit PAS lister une commande dev-only\n${txt}`,
      );
      // Help-only : aucun serveur ne doit démarrer.
      assert.ok(
        !READY_RE.test(txt),
        `--help ne doit JAMAIS démarrer un serveur\n${txt}`,
      );
    });

    it("--help en development liste AUSSI les commandes des modules dev (test:batch)", async () => {
      // En mode development, les modules `policy:"dev"` sont chargés → leurs commandes
      // apparaissent dans le help (gating dev reflété dans la surface CLI).
      const r = await runCli(["--help"], 30000, { NODE_ENV: "development" });
      assert.strictEqual(
        r.code,
        0,
        `exit code attendu 0, reçu ${r.code}\n${r.stderr}`,
      );
      const txt = r.stdout + r.stderr;
      assert.ok(
        txt.includes("test:batch"),
        `--help (development) doit lister la commande dev "test:batch"\n${txt}`,
      );
      assert.ok(
        !READY_RE.test(txt),
        `--help ne doit JAMAIS démarrer un serveur\n${txt}`,
      );
    });

    it("invocation nue `nodefony` → même help complet (built-ins + modules), exit 0", async () => {
      const r = await runCli([]);
      assert.strictEqual(
        r.code,
        0,
        `exit code attendu 0, reçu ${r.code}\n${r.stderr}`,
      );
      const txt = r.stdout + r.stderr;
      assert.ok(
        txt.includes("development"),
        `nu doit lister un built-in\n${txt}`,
      );
      assert.ok(
        txt.includes("network"),
        `nu doit lister une commande de module\n${txt}`,
      );
    });

    it("--version → exit 0 et imprime un numéro de version", async () => {
      const r = await runCli(["--version"]);
      assert.strictEqual(
        r.code,
        0,
        `exit code attendu 0, reçu ${r.code}\n${r.stderr}`,
      );
      assert.ok(
        /\d+\.\d+\.\d+/.test(r.stdout + r.stderr),
        `version semver attendue\n${r.stdout}${r.stderr}`,
      );
    });

    it("completion zsh → exit 0, script compdef (standalone, 0 boot)", async () => {
      const traceFile = path.join(
        os.tmpdir(),
        `nodefony-kernel-trace-compl-${process.pid}-${Date.now()}.log`,
      );
      try {
        const r = await runCli(["completion", "zsh"], 30000, {
          NODEFONY_KERNEL_TRACE_FILE: traceFile,
        });
        assert.strictEqual(r.code, 0, r.stderr);
        assert.ok(r.stdout.includes("#compdef nodefony"), r.stdout);
        assert.ok(r.stdout.includes("__complete --"), r.stdout);
        assert.ok(r.stdout.includes("./node_modules/.bin/nodefony"), r.stdout);
        assert.strictEqual(
          countKernelBoots(traceFile),
          0,
          "completion est standalone : AUCUN Kernel",
        );
      } finally {
        fs.rmSync(traceFile, { force: true });
      }
    });

    it("__complete → candidats de commandes, exit 0, sortie machine propre", async () => {
      const r = await runCli(["__complete", "--", ""], 30000);
      assert.strictEqual(r.code, 0, r.stderr);
      const candidates = r.stdout.split("\n").filter((l) => l.length > 0);
      assert.ok(
        candidates.includes("development"),
        `development attendu dans les candidats\n${r.stdout}`,
      );
      assert.ok(candidates.includes("cluster"));
      // Sortie MACHINE : uniquement des candidats (1 token par ligne, pas de log).
      assert.ok(
        candidates.every((l) => /^[\w:@/.-]+$/.test(l)),
        `sortie polluée par des logs :\n${r.stdout}`,
      );
    });

    it("__complete après commande validée → options (--detach, --workers)", async () => {
      const r = await runCli(["__complete", "--", "cluster", "--"], 30000);
      assert.strictEqual(r.code, 0, r.stderr);
      const candidates = r.stdout.split("\n").filter((l) => l.length > 0);
      assert.ok(candidates.includes("--workers"), r.stdout);
      assert.ok(candidates.includes("--detach"), r.stdout);
    });

    it("status (standalone) → exit 0 et ZÉRO Kernel construit", async () => {
      // `status`/`stop` sont des commandes SYSTÈME standalone (CliKernel.start
      // court-circuite AVANT `new Kernel`) — l'équivalent du niveau d'arrêt le plus
      // précoce. Le trace file prouve qu'aucun Kernel n'est instancié.
      const traceFile = path.join(
        os.tmpdir(),
        `nodefony-kernel-trace-status-${process.pid}-${Date.now()}.log`,
      );
      try {
        const r = await runCli(["status"], 30000, {
          NODEFONY_KERNEL_TRACE_FILE: traceFile,
        });
        assert.strictEqual(
          r.code,
          0,
          `status doit sortir 0 même sans runtime up\n${r.stderr}`,
        );
        assert.strictEqual(
          countKernelBoots(traceFile),
          0,
          "status est standalone : AUCUN `new Kernel()` ne doit être tracé",
        );
      } finally {
        fs.rmSync(traceFile, { force: true });
      }
    });
  },
);

// Skip hors RUN_CLI_BOOT ou sans dist (conditions sync). « Serveur déjà up » est
// une condition ASYNC → vérifiée par beforeEach via ctx.skip().
describe.skipIf(!RUN_BOOT || !fs.existsSync(DIST))(
  "CLI integration — boot réel (RUN_CLI_BOOT=1)",
  () => {
    vi.setConfig({ testTimeout: 90000, hookTimeout: 90000 });
    beforeEach(async (ctx) => {
      // Un serveur tourne déjà (dev) → le child échouerait EADDRINUSE → skip soft.
      if (await isPortOpen(HTTP_PORT)) ctx.skip();
    });

    it("commande inconnue (typo) → exit 64 (EX_USAGE) et AUCUN serveur démarré", async () => {
      const r = await runCli(["foobar:nope"], 60000);
      // dispatchModuleCommand → terminate(SysExit.USAGE) : code SÉMANTIQUE lisible
      // par un orchestrateur (usage ≠ crash logiciel), pas juste « ≠ 0 ».
      assert.strictEqual(
        r.code,
        64,
        `une typo doit sortir EX_USAGE (64), reçu ${r.code}\n${r.stderr}`,
      );
      assert.ok(
        !READY_RE.test(r.stdout + r.stderr),
        `une typo ne doit JAMAIS démarrer un serveur (fallback serveur legacy)\n${r.stdout}`,
      );
    });

    // ─── Happy-path d'une commande de MODULE (dispatch différé) ────────────────
    // La typo ci-dessus couvre le chemin d'ERREUR du dispatch différé ; ici le chemin
    // NOMINAL : la commande `http:network` (posée par @nodefony/http à onPreRegister,
    // kernelEvent onRegister) doit s'exécuter au point d'arrêt déclaré, produire sa
    // sortie, ne monter AUCUN serveur et ne construire qu'UN SEUL Kernel (console).
    it("http:network -j (commande de module) → exit 0, JSON, 0 serveur, 1 Kernel", async () => {
      const traceFile = path.join(
        os.tmpdir(),
        `nodefony-kernel-trace-modcmd-${process.pid}-${Date.now()}.log`,
      );
      try {
        const r = await runCli(["http:network", "-j"], 60000, {
          NODEFONY_KERNEL_TRACE_FILE: traceFile,
        });
        assert.strictEqual(
          r.code,
          0,
          `http:network doit sortir 0\n${r.stderr}`,
        );
        assert.ok(
          r.stdout.includes('"address"'),
          `sortie JSON des interfaces réseau attendue\n${r.stdout.slice(-1500)}`,
        );
        assert.ok(
          !READY_RE.test(r.stdout + r.stderr),
          `une commande console ne doit JAMAIS démarrer un serveur\n${r.stdout.slice(-1500)}`,
        );
        assert.strictEqual(
          countKernelBoots(traceFile),
          1,
          "une commande de module doit booter UN SEUL Kernel (console)",
        );
      } finally {
        fs.rmSync(traceFile, { force: true });
      }
    });

    // ─── Lancement DÉTACHÉ (volet F — l'expérience start.sh absorbée) ───────────
    // `development --detach` : fast-path standalone (0 boot dans le process appelant),
    // spawn détaché + readiness ports + exit 0. Cleanup par `nodefony stop` (natif).
    it("development --detach → readiness, exit 0, puis stop propre", async () => {
      const r = await runCli(
        ["development", "--detach", "--wait", "150"],
        170000,
      );
      try {
        assert.strictEqual(
          r.code,
          0,
          `--detach doit sortir 0 à la readiness\n${r.stdout}\n${r.stderr}`,
        );
        assert.ok(
          /READY — ports en écoute/.test(r.stdout),
          `le rapport doit annoncer la readiness\n${r.stdout}`,
        );
        assert.ok(
          /UP — PID=\d+/.test(r.stdout),
          `le rapport doit donner le PID du runtime détaché\n${r.stdout}`,
        );
        // Le runtime détaché écoute réellement (indépendant du process CLI, sorti).
        assert.strictEqual(await isPortOpen(HTTP_PORT), true);
        // Le boot dev a écrit le manifest de complétion — commandes de MODULE
        // incluses (la donnée du TAB reste fraîche sans regénérer le script).
        const manifest = JSON.parse(
          fs.readFileSync(
            path.join(
              REPO_ROOT,
              "node_modules",
              ".cache",
              "nodefony",
              "cli-manifest.json",
            ),
            "utf8",
          ),
        ) as { commands: { name: string }[] };
        assert.ok(
          manifest.commands.some((c) => c.name === "http:network"),
          "le manifest de complétion doit contenir les commandes de module",
        );
      } finally {
        const stop = await runCli(["stop"], 30000);
        assert.strictEqual(stop.code, 0, `stop doit nettoyer\n${stop.stderr}`);
      }
      // Ports libérés après stop — aucun zombie.
      assert.strictEqual(await isPortOpen(HTTP_PORT), false);
    }, 210000);

    // ─── PRODUCTION sur un port NON conventionnel ───────────────────────────────
    // Le chemin réel du déploiement : l'app déclare son port (`NF_PORT`, ou `PORT`
    // en PaaS Cloud Run/Heroku). Elle écoute donc AILLEURS que la convention
    // `[5151, 5152]` que sonde le parent — en `portPolicy: "strict"` compris.
    //
    // Sans le state file publié EN PRODUCTION, `--wait` sondait la convention, ne
    // voyait rien, épuisait son plafond, puis group-killait un serveur qui écoutait
    // parfaitement (faux négatif). Ce test verrouille le chemin de bout en bout :
    // readiness → ports publiés → `status` → `stop`. Le test de `detachedStart` ne
    // couvre que le parent (child factice) : la publication, elle, vit dans le vrai
    // HttpKernel — une capacité prouvée sur un chemin n'existe pas sur le voisin.
    it("production --detach --wait sur un port déclaré (NF_PORT) → readiness sur le port RÉEL", async () => {
      const port = 5361; // hors convention [5151, 5152]
      const portHttps = 5362;
      const stateFile = path.join(
        REPO_ROOT,
        "node_modules",
        ".cache",
        "nodefony",
        "runtime.json",
      );
      const r = await runCli(
        ["production", "--detach", "--wait", "150"],
        170000,
        { NF_PORT: String(port), NF_PORT_HTTPS: String(portHttps) },
      );
      try {
        assert.strictEqual(
          r.code,
          0,
          `--wait doit sortir 0 : le serveur écoute sur ${port}, pas sur la convention\n${r.stdout}\n${r.stderr}`,
        );
        // Il écoute VRAIMENT sur le port déclaré, et rien sur la convention.
        assert.strictEqual(await isPortOpen(port), true);
        assert.strictEqual(await isPortOpen(HTTP_PORT), false);
        // Le serveur a PUBLIÉ sa topologie (le canal qui rend `status`/`stop`/
        // readiness lucides) — en production aussi, pas seulement en dev.
        const state = JSON.parse(fs.readFileSync(stateFile, "utf8")) as {
          pid: number;
          ports: number[];
        };
        assert.ok(
          state.ports.includes(port),
          `le state file doit porter le port réel — vu: ${JSON.stringify(state.ports)}`,
        );
        // `status` lit le state file → il rapporte le port réel, pas 5151.
        const st = await runCli(["status"], 30000);
        assert.strictEqual(st.code, 0);
        assert.ok(
          st.stdout.includes(String(port)),
          `status doit rapporter le port réel ${port}\n${st.stdout}`,
        );
      } finally {
        const stop = await runCli(["stop"], 30000);
        assert.strictEqual(stop.code, 0, `stop doit nettoyer\n${stop.stderr}`);
      }
      assert.strictEqual(await isPortOpen(port), false);
    }, 210000);

    // ─── Point d'arrêt onReady SANS serveur ─────────────────────────────────────
    // `proxy:generate` déclare `kernelEvent: "onReady"` : la phase la plus profonde
    // AVANT initServers. Preuve que le boot s'arrête bien à la phase déclarée : la
    // conf est générée (introspection des serveurs) mais AUCUNE socket n'écoute.
    it("proxy:generate nginx (kernelEvent onReady) → conf générée, 0 serveur", async () => {
      const r = await runCli(["proxy:generate", "nginx"], 60000);
      assert.strictEqual(
        r.code,
        0,
        `proxy:generate doit sortir 0\n${r.stderr}`,
      );
      assert.ok(
        r.stdout.includes("upstream nodefony"),
        `la conf nginx doit être générée sur stdout\n${r.stdout.slice(-1500)}`,
      );
      assert.ok(
        !SERVER_NET_RE.test(r.stdout + r.stderr),
        `kernelEvent onReady = arrêt AVANT initServers : aucun serveur réseau\n${r.stdout.slice(-1500)}`,
      );
    });

    it("production --workers 1 → UN SEUL Kernel par process", async () => {
      const { boots, out } = await spawnServerAndCountBoots([
        "production",
        "--workers",
        "1",
      ]);
      assert.strictEqual(
        boots,
        1,
        `production -w1 doit créer 1 seul Kernel, observé ${boots} (double-boot)\n${out.slice(-2000)}`,
      );
    });

    it("cluster --workers 1 → UN SEUL Kernel par process (mono)", async () => {
      const { boots, out } = await spawnServerAndCountBoots([
        "cluster",
        "--workers",
        "1",
      ]);
      assert.strictEqual(
        boots,
        1,
        `cluster -w1 doit créer 1 seul Kernel, observé ${boots} (double-boot)\n${out.slice(-2000)}`,
      );
    });

    // ─── Intégrité du chargement des modules (anti fail-soft silencieux) ───────
    // Mon filet initial ne vérifiait QUE « Server Listen » → un module en fail-soft
    // (Cannot find package) cassait la chaîne sans rien faire échouer (serveur up mais
    // module absent → routes 404). Ce test attrape ce cas : modules chargés + route servie.
    it("production -w1 → intégrité des modules (0 fail-soft, pipeline HTTP servi)", async () => {
      const child = spawn(
        process.execPath,
        [BIN, "production", "--workers", "1"],
        {
          cwd: REPO_ROOT,
          env: { ...process.env },
        },
      );
      let out = "";
      try {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error(`readiness timeout:\n${out.slice(-1500)}`)),
            45000,
          );
          const onData = (d: Buffer) => {
            out += d.toString();
            if (SERVER_NET_RE.test(out)) {
              clearTimeout(timer);
              resolve();
            }
          };
          child.stdout.on("data", onData);
          child.stderr.on("data", onData);
          child.once("exit", (c, s) => {
            clearTimeout(timer);
            reject(
              new Error(
                `exited before ready (code=${c} sig=${s}):\n${out.slice(-1500)}`,
              ),
            );
          });
        });
        // 1) Aucun module en fail-soft (Cannot find package) → chaîne de modules intègre.
        assert.ok(
          !FAILSOFT_RE.test(out),
          `aucun module ne doit échouer au chargement (fail-soft)\n${out.slice(-2500)}`,
        );
        // 2) Les modules MANDATORY (présents en production) sont chargés. Le module
        //    `test` est dev-only → absent en prod ; on vérifie le socle mandatory
        //    (framework/security/studio) à la place, ce qui garde le sens du test :
        //    détecter une chaîne de modules cassée EN PRODUCTION.
        for (const m of ["framework", "security", "studio"]) {
          assert.ok(
            new RegExp(`MODULE ADD\\s*:\\s*${m}`, "i").test(out),
            `le module mandatory "${m}" doit être chargé en production\n${out.slice(-2500)}`,
          );
        }
        // 3) Preuve ultime : le pipeline HTTP RÉPOND réellement (au-delà de "Server
        //    Listen") — une requête obtient un status HTTP, pas un ECONNREFUSED.
        const status = await httpsGetStatus("/");
        assert.ok(
          status >= 200 && status < 600,
          `le serveur doit router une requête en production (status reçu ${status})`,
        );
      } finally {
        await killAndWait(child);
      }
    });

    // ─── Modes BATCH / DAEMON — SKIP (dette assumée, cf ci-dessous) ────────────
    // Ces deux e2e spawnent les commandes de DÉMO `test:batch`/`test:daemon`, qui
    // vivent dans le module `@nodefony/test` — devenu `policy:"dev"` (ses routes ne
    // doivent pas être servies en production). Conséquence STRUCTURELLE :
    //   • en production (défaut des subprocess) le module test n'est pas chargé →
    //     `unknown command 'test:batch'` ;
    //   • en `development` (seul env qui le charge), le boot passe par le couple
    //     superviseur/enfant : sans `NODEFONY_DEV_CHILD=1` la sortie des commandes
    //     de module n'atteint pas stdout, et avec, le module `frontend` démarre Vite
    //     (process vivant) → le mode ONESHOT ne peut jamais terminer.
    // Le MÉCANISME sous-jacent (oneshot → `terminate`, daemon → `park`, `lifetime`)
    // reste couvert UNITAIREMENT par `KernelLifecycle.test.ts` (terminate()/park).
    // Réactiver quand les commandes de démo des modes de boot migreront hors d'un
    // module dev-only (module de banc mandatory) OU que le boot dev exposera la
    // sortie des commandes de module. Ce N'EST PAS un problème de flush Syslog
    // (filet anti-perte présent et fonctionnel) ni une régression (pré-existant).
    it.skip("test:batch → mode BATCH : exit 0, AUCUN serveur, terminaison propre", async () => {
      const r = await runCli(["test:batch"], 60000);
      assert.strictEqual(
        r.code,
        0,
        `batch doit terminer proprement (exit 0)\n${r.stderr}`,
      );
      const txt = r.stdout + r.stderr;
      assert.ok(
        /BATCH MODE OK/i.test(txt),
        `le job batch doit s'exécuter\n${txt.slice(-1500)}`,
      );
      assert.ok(
        !SERVER_NET_RE.test(txt),
        `un batch CONSOLE ne démarre AUCUN serveur réseau\n${txt.slice(-1500)}`,
      );
      // Le hook onKernelTerminate (cleanup, tous modes) doit fire au terminate.
      assert.ok(
        /BATCH cleanup/i.test(txt),
        "onKernelTerminate doit fire (cleanup)",
      );
    });

    // ─── Mode DAEMON (CONSOLE long-running, 0 serveur, SIGTERM → graceful) ─────
    // SKIP — même dette que `test:batch` ci-dessus (commande de démo d'un module
    // dev-only + boot dev qui n'expose pas la sortie ; `park`/`lifetime` couverts
    // unitairement dans `KernelLifecycle.test.ts`).
    it.skip("test:daemon → mode DAEMON : reste vivant sans serveur, SIGTERM = graceful", async () => {
      const child = spawn(process.execPath, [BIN, "test:daemon"], {
        cwd: REPO_ROOT,
        env: { ...process.env },
      });
      let out = "";
      try {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(
            () =>
              reject(new Error(`daemon n'a pas atteint son ready:\n${out}`)),
            45000,
          );
          const onData = (d: Buffer) => {
            out += d.toString();
            if (/DAEMON MODE OK/i.test(out)) {
              clearTimeout(timer);
              resolve();
            }
          };
          child.stdout.on("data", onData);
          child.stderr.on("data", onData);
          child.once("exit", () => {
            clearTimeout(timer);
            reject(
              new Error(
                `le daemon a quitté avant son ready (devrait park)\n${out}`,
              ),
            );
          });
        });
        assert.ok(
          !SERVER_NET_RE.test(out),
          `un daemon CONSOLE ne démarre AUCUN serveur réseau\n${out.slice(-1500)}`,
        );
        assert.strictEqual(
          child.exitCode,
          null,
          "le daemon doit rester VIVANT (park), pas terminer seul",
        );
      } finally {
        await killAndWait(child); // SIGTERM = docker stop / k8s
      }
      assert.ok(
        /DAEMON graceful shutdown/i.test(out),
        `SIGTERM doit déclencher le graceful shutdown (onKernelTerminate)\n${out.slice(-1500)}`,
      );
    });
  },
);
