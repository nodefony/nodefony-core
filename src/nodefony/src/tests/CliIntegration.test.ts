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
 *   - commandes SERVEUR + typo : bootent l'app réelle → lourdes, gardées par NF_RUN_CLI_BOOT=1.
 *     Le cœur = INVARIANT BOOT-COUNT : `production`/`cluster -w1` ne doivent créer qu'UN
 *     SEUL Kernel par process (avant refacto : 2 → ces asserts sont RED jusqu'à l'étape C).
 *     Observé via NF_KERNEL_TRACE_FILE (1 ligne par `new Kernel()`).
 */

import assert from "node:assert";
import { spawn, ChildProcess } from "node:child_process";
import { connect } from "node:net";
import https from "node:https";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findReservedEntity } from "../cli/scaffold/reservedEntities";
import {
  isPidAlive,
  readRuntimeState,
  readSupervisorPid,
} from "../service/dev/devProcess";

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
const RUN_BOOT = process.env.NF_RUN_CLI_BOOT === "1";

// Readiness d'un boot serveur RÉEL. Sous turbo (N workspaces buildent/testent en
// parallèle → CPU saturé), le spawn + import du dist + init des modules + listen
// peut dépasser un seuil serré et faire FLAKER le test : un seuil de 45 s en dur
// donnait un échec sporadique (même code → 1 échec puis vert) alors que le budget
// vitest était déjà de 90 s — la readiness abandonnait à mi-parcours. Seuil large,
// surchargeable pour une machine lente, et le budget test en dérive → readiness
// TOUJOURS < testTimeout par construction (plus de course entre les deux).
const READY_TIMEOUT_MS = Number(process.env.NF_CLI_READY_TIMEOUT_MS) || 80_000;
const BOOT_TEST_TIMEOUT_MS = READY_TIMEOUT_MS + 25_000; // marge countBoots + killAndWait

/** Résultat d'un spawn d'une commande terminante. */
interface CliResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

/** Spawn `node bin/nodefony <args>` et attend la sortie du process (commandes terminantes). */
/**
 * Budget d'attente d'une commande CLI qui BOOTE un kernel.
 *
 * Ces bancs vérifient un COMPORTEMENT (« le help liste telle commande »), pas une
 * performance : leur horloge doit tolérer une machine chargée. Sous `turbo run
 * test`, une trentaine de suites tournent de front et le boot d'un kernel dépasse
 * allègrement 30 s — le test échouait alors sur la charge de ses voisins, pas sur
 * son sujet. Réglable par `NF_CLI_TIMEOUT_MS` (CI lente, machine modeste).
 */
const CLI_TIMEOUT_MS = Number(process.env.NF_CLI_TIMEOUT_MS) || 120_000;

function runCli(
  args: string[],
  timeoutMs = CLI_TIMEOUT_MS,
  extraEnv?: Record<string, string>,
  cwd: string = REPO_ROOT,
): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [BIN, ...args], {
      cwd,
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

/**
 * Attend que le runtime publie un PID DIFFÉRENT — la signature d'un rechargement.
 *
 * Sonde le fichier d'état plutôt que les journaux : c'est le canal que le serveur
 * alimente lui-même une fois ses ports ouverts, donc il ne dit « rechargé » qu'une fois
 * le nouvel enfant réellement en écoute. Rend le PID d'origine si le délai expire —
 * l'appelant conclut, jamais ce helper.
 */
/**
 * Fin du journal du runtime détaché, pour joindre à un échec.
 *
 * Un « le superviseur n'a pas relancé » ne dit RIEN de la cause : le watcher
 * n'a pas vu la modification, le rebuild a échoué, l'arrêt du groupe a traîné ?
 * Sur une plateforme qu'on ne peut pas reproduire en local — Windows —, la
 * seule pièce disponible est ce journal, et il faut donc qu'il voyage AVEC
 * l'échec plutôt que de rester sur un runner déjà détruit.
 *
 * @returns les dernières lignes, ou une mention explicite si le journal manque.
 */
function tailDetachedLog(lines = 40): string {
  const file = path.join(REPO_ROOT, "tmp", "nodefony-detached.log");
  if (!fs.existsSync(file)) {
    return `\n(aucun journal détaché à ${file})`;
  }
  const tail = fs
    .readFileSync(file, "utf8")
    .split("\n")
    .slice(-lines)
    .join("\n");
  return `\n─── fin de ${file} ───\n${tail}`;
}

async function waitForRuntimePidChange(
  from: number,
  timeoutMs: number,
): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = readRuntimeState(REPO_ROOT);
    if (state && state.pid !== from) return state.pid;
    await new Promise((r) => setTimeout(r, 500));
  }
  return from;
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
  readyTimeoutMs = READY_TIMEOUT_MS,
): Promise<{ boots: number; out: string }> {
  const traceFile = path.join(
    os.tmpdir(),
    `nodefony-kernel-trace-${process.pid}-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}.log`,
  );
  const child = spawn(process.execPath, [BIN, ...args], {
    cwd: REPO_ROOT,
    env: { ...process.env, NF_KERNEL_TRACE_FILE: traceFile },
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
    // Le budget du test doit rester AU-DESSUS de celui de la commande qu'il
    // attend, sinon vitest coupe avant `runCli` et le diagnostic se perd.
    vi.setConfig({
      testTimeout: CLI_TIMEOUT_MS + 10_000,
      hookTimeout: CLI_TIMEOUT_MS + 10_000,
    });

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

    // ─── L'aide est groupée par INTENTION, et rien n'y échappe ───────────────
    // Une commande intégrée sans `helpGroup` tombe sous « AUTRES » : elle reste
    // listée, mais dans le fourre-tout de fin de page, là où personne ne la
    // cherche. L'invariant s'observe donc sur le PRODUIT, pas sur une table.
    it("⭐ aucune commande intégrée ne tombe dans le fourre-tout de l'aide", async () => {
      const r = await runCli(["--help"], CLI_TIMEOUT_MS, { NF_NO_COLOR: "1" });
      assert.strictEqual(r.code, 0, r.stderr);
      const txt = r.stdout + r.stderr;
      assert.ok(
        !/^\s{2}AUTRES\s/mu.test(txt),
        `une intégrée a perdu son groupe d'intention\n${txt}`,
      );
      // …et les groupes attendus sont bien là, dans l'ordre de la journée.
      const ordre = ["LANCER", "COMPRENDRE", "GÉNÉRER ET CONSTRUIRE"];
      const positions = ordre.map((g) => txt.indexOf(`  ${g} `));
      // `node:assert` strict ici (le fichier n'importe pas chai) : ses
      // comparaisons se disent avec `ok`, et le message porte le diagnostic.
      for (const [i, at] of positions.entries()) {
        assert.ok(at >= 0, `groupe absent de l'aide : ${ordre[i]}`);
        if (i > 0) {
          assert.ok(
            at > (positions[i - 1] ?? -1),
            `groupes dans le désordre : ${ordre[i]} devrait suivre ${ordre[i - 1]}`,
          );
        }
      }
    });

    // ─── Hors d'une APPLICATION — le moment où l'on découvre l'outil ─────────
    // `Kernel.startBoot` ne LÈVE pas quand il n'y a rien à démarrer : il
    // `terminate(1)`. Le repli greffé sur un rejet ne s'exécutait donc jamais,
    // et `nodefony --help` répondait par un CRITIC et un code 1 à qui venait
    // d'installer le paquet et cherchait `create app`.
    it("⭐ `--help` hors d'un projet rend l'aide des intégrées, et sort en 0", async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nf-help-hors-"));
      try {
        const r = await runCli(["--help"], CLI_TIMEOUT_MS, {}, dir);
        assert.strictEqual(
          r.code,
          0,
          `demander de l'aide n'est pas une erreur\n${r.stderr}`,
        );
        const txt = r.stdout + r.stderr;
        for (const name of ["create", "development", "production", "doctor"]) {
          assert.ok(txt.includes(name), `l'aide doit lister "${name}"\n${txt}`);
        }
        assert.ok(
          /create app/.test(txt),
          `l'aide doit dire par quoi commencer\n${txt}`,
        );
        assert.ok(!/CRITIC/.test(txt), `un help n'est pas un incident\n${txt}`);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it("⭐ une application NON INSTALLÉE reçoit l'aide, et SON geste à elle", async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nf-help-brut-"));
      try {
        fs.writeFileSync(
          path.join(dir, "package.json"),
          '{"name":"a","version":"1.0.0","main":"dist/index.js",' +
            '"dependencies":{"nodefony":"^10.0.0"}}',
        );
        fs.writeFileSync(
          path.join(dir, "nodefony.config.ts"),
          "export default {};",
        );
        const r = await runCli(["--help"], CLI_TIMEOUT_MS, {}, dir);
        assert.strictEqual(r.code, 0, r.stderr);
        const txt = r.stdout + r.stderr;
        assert.ok(txt.includes("development"), "l'aide est bien rendue");
        assert.ok(
          /npm install/.test(txt),
          `qui A une application ne doit pas s'entendre dire d'en créer une\n${txt}`,
        );
        assert.ok(
          !/create app/.test(txt),
          `…et surtout pas le contraire de son geste\n${txt}`,
        );
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it("--help (production) liste les commandes des modules MANDATORY, pas les dev-only", async () => {
      // Sans commande d'env, le bin résout le mode runtime au défaut PRODUCTION
      // (12-factor safe — cf Kernel.resolveRuntimeEnv). On le force ici pour un test
      // déterministe quel que soit le NODE_ENV de la suite mocha.
      const r = await runCli(["--help"], CLI_TIMEOUT_MS, {
        NODE_ENV: "production",
      });
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
      const r = await runCli(["--help"], CLI_TIMEOUT_MS, {
        NODE_ENV: "development",
      });
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
        const r = await runCli(["completion", "zsh"], CLI_TIMEOUT_MS, {
          NF_KERNEL_TRACE_FILE: traceFile,
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
      const r = await runCli(["__complete", "--", ""], CLI_TIMEOUT_MS);
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
      const r = await runCli(
        ["__complete", "--", "cluster", "--"],
        CLI_TIMEOUT_MS,
      );
      assert.strictEqual(r.code, 0, r.stderr);
      const candidates = new Set(
        r.stdout.split("\n").filter((l) => l.length > 0),
      );
      assert.ok(candidates.has("--workers"), r.stdout);
      assert.ok(candidates.has("--detach"), r.stdout);
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
        const r = await runCli(["status"], CLI_TIMEOUT_MS, {
          NF_KERNEL_TRACE_FILE: traceFile,
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

/*
 * Contrat de la sortie MACHINE : une commande qui échoue ne part jamais muette.
 *
 * Ce banc existe parce que le contraire s'est produit (BUG_REPORT, BUG-1) : base
 * injoignable, `inspect <sujet> --json` rendait zéro octet sur les deux flux et
 * sortait en 1. L'appelant — ici un agent — en a conclu que l'application n'avait
 * aucune route, et a écrit un chiffre inventé plutôt que de constater la panne.
 *
 * Il vérifie le COMPORTEMENT OBSERVABLE, pas le chemin interne qui le produit :
 * c'est ce qui le rend robuste au refactor. Le silence avait justement survécu à
 * un test unitaire vert, lequel forçait sa condition avec `setOptionValue` et
 * validait donc une branche que le CLI réel n'emprunte jamais.
 *
 * L'hôte `.invalid` est un TLD réservé (RFC 2606) : sa résolution échoue partout
 * et tout de suite, là où un nom fantaisiste peut être capté par le résolveur
 * d'un fournisseur d'accès et transformer l'échec attendu en attente longue.
 */
describe.skipIf(!fs.existsSync(DIST))(
  "CLI integration — sortie machine : un boot en échec n'est jamais silencieux",
  () => {
    vi.setConfig({
      testTimeout: CLI_TIMEOUT_MS + 10_000,
      hookTimeout: CLI_TIMEOUT_MS + 10_000,
    });

    it("base injoignable + --json → l'échec se lit sur la sortie d'erreur", async () => {
      const r = await runCli(["inspect", "routes", "--json"], CLI_TIMEOUT_MS, {
        NF_DATABASE_URL: "postgres://app:pwd@base-absente.invalid:5432/app",
      });

      assert.notStrictEqual(
        r.code,
        0,
        `un boot en échec doit sortir en code non nul\nstdout: ${r.stdout}\nstderr: ${r.stderr}`,
      );
      assert.ok(
        r.stderr.trim().length > 0,
        "MUET : boot en échec, et pas un octet sur la sortie d'erreur — " +
          "l'appelant ne peut pas distinguer « aucune route » de « rien n'a démarré »",
      );
      assert.match(
        r.stderr,
        /ENOTFOUND|connecteur|ERROR|CRITIC/,
        `la sortie d'erreur doit NOMMER la panne, pas seulement exister\n${r.stderr}`,
      );
    });

    it("l'échec ne pollue pas la sortie standard réservée aux données", async () => {
      const r = await runCli(["inspect", "routes", "--json"], CLI_TIMEOUT_MS, {
        NF_DATABASE_URL: "postgres://app:pwd@base-absente.invalid:5432/app",
      });

      // Rien, ou du JSON — jamais du texte de journal : `… --json | jq` doit
      // rester utilisable, y compris le jour où la commande échoue.
      const out = r.stdout.trim();
      if (out.length > 0) {
        assert.doesNotThrow(
          () => JSON.parse(out),
          `stdout doit rester du JSON pur en mode machine\n${out.slice(0, 400)}`,
        );
      }
    });
  },
);

// Skip hors NF_RUN_CLI_BOOT ou sans dist (conditions sync). « Serveur déjà up » est
// une condition ASYNC → vérifiée par beforeEach via ctx.skip().
describe.skipIf(!RUN_BOOT || !fs.existsSync(DIST))(
  "CLI integration — boot réel (NF_RUN_CLI_BOOT=1)",
  () => {
    vi.setConfig({
      testTimeout: BOOT_TEST_TIMEOUT_MS,
      hookTimeout: BOOT_TEST_TIMEOUT_MS,
    });
    beforeEach(async (ctx) => {
      // Un serveur tourne déjà (dev) → le child échouerait EADDRINUSE → skip soft.
      if (await isPortOpen(HTTP_PORT)) ctx.skip();
    });

    // ─── Anti-dérive : la liste des noms d'entités réservés dit-elle encore vrai ? ──
    // `create entity` refuse les noms que les modules du framework occupent, sur la
    // foi d'une table écrite à la main (`scaffold/reservedEntities.ts`). Une table
    // écrite à la main se périme : un module qui ajoute une entité rouvrirait la
    // panne qu'elle ferme. Ce dépôt EST une application chargeant user/http/security/
    // framework — on lui DEMANDE ses entités plutôt que de les déduire.
    it("reservedEntities couvre ce que `inspect entities` rapporte VRAIMENT", async () => {
      const r = await runCli(["inspect", "entities", "--json"], CLI_TIMEOUT_MS);
      assert.strictEqual(
        r.code,
        0,
        `inspect entities doit sortir 0\n${r.stderr}`,
      );
      const parsed = JSON.parse(r.stdout) as
        | { entities?: { name: string; module: string }[] }
        | { name: string; module: string }[];
      const live = Array.isArray(parsed) ? parsed : (parsed.entities ?? []);
      assert.ok(live.length > 0, "l'app dev doit déclarer des entités");
      const missing = live.filter((e) => findReservedEntity(e.name) === null);
      assert.deepStrictEqual(
        missing.map((e) => `${e.name} (${e.module})`),
        [],
        "entités du framework absentes de RESERVED_ENTITY_NAMES — " +
          "`create entity <ce nom>` casserait le boot de l'app générée",
      );
    });

    it("commande inconnue (typo) → exit 64 (EX_USAGE) et AUCUN serveur démarré", async () => {
      const r = await runCli(["foobar:nope"], CLI_TIMEOUT_MS);
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

    // ─── `doctor --live` sur une app qui NE DÉMARRE PAS ───────────────────────
    // La BRIQUE (`runDoctorWithoutLive`) est éprouvée à part ; ici la CHAÎNE —
    // le binaire réel, un boot qui meurt pour de bon, et ce que l'utilisateur
    // reçoit. C'est le cas POUR lequel `doctor` existe : tant qu'il n'était pas
    // rattrapé, `--live` rendait 61 lignes de pile et aucun rapport, soit moins
    // que `doctor` nu.
    it("⭐ boot MORT → le rapport statique est rendu quand même, étage 2 expliqué", async () => {
      const r = await runCli(["doctor", "--live"], CLI_TIMEOUT_MS, {
        // Un hôte que le DNS ne résoudra jamais : le connecteur tombe à
        // `onPreBoot`, donc bien avant `onPostReady` où l'étage 2 se branche.
        NF_DATABASE_URL: "postgres://app:x@base-absente.invalid:5432/app",
        NF_NO_COLOR: "1",
      });
      assert.ok(
        /ÉTAT/.test(r.stdout),
        `le rapport doit être rendu malgré le boot mort\n${r.stdout.slice(0, 600)}\n--- stderr ---\n${r.stderr.slice(0, 600)}`,
      );
      assert.ok(
        /n'a pas démarré/.test(r.stdout),
        `l'étage 2 doit DIRE pourquoi il n'a pas pu répondre\n${r.stdout.slice(-1500)}`,
      );
      assert.ok(
        !READY_RE.test(r.stdout + r.stderr),
        "un diagnostic ne monte aucun serveur",
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
        const r = await runCli(["http:network", "-j"], CLI_TIMEOUT_MS, {
          NF_KERNEL_TRACE_FILE: traceFile,
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
        const stop = await runCli(["stop"], CLI_TIMEOUT_MS);
        assert.strictEqual(stop.code, 0, `stop doit nettoyer\n${stop.stderr}`);
      }
      // Ports libérés après stop — aucun zombie.
      assert.strictEqual(await isPortOpen(HTTP_PORT), false);
    }, 210000);

    // ─── Cycle dev COMPLET : démarrer → recharger → arrêter ─────────────────────
    // Le mode dev n'était éprouvé sur AUCUNE plateforme autre que par lecture de
    // code : le job d'intégration est ubuntu-only et démarre en `production`. Ce
    // test est en Node pur (aucun shell), donc il s'exécute là où le reste du
    // filet CLI s'exécute — Windows compris, qui est précisément l'endroit où
    // rien ne prouvait que le superviseur sait relancer son enfant.
    it("development --detach → le superviseur RECHARGE sur modification, puis stop propre", async () => {
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
        const before = readRuntimeState(REPO_ROOT);
        assert.ok(before, "le runtime détaché doit publier son fichier d'état");
        const pidBefore = before.pid;
        assert.strictEqual(await isPortOpen(HTTP_PORT), true);

        // Touche un fichier SURVEILLÉ sans écrire dedans : `utimesSync` ne change que
        // les dates, donc l'arbre git reste identique — alors que chokidar, lui, voit
        // bien un changement. Modifier le contenu pour déclencher un watcher est un
        // piège : le test laisserait un diff derrière lui s'il échoue avant sa
        // restauration.
        const watched = path.join(
          REPO_ROOT,
          "src",
          "modules",
          "test",
          "index.ts",
        );
        assert.ok(
          fs.existsSync(watched),
          `fichier surveillé absent : ${watched}`,
        );
        const now = new Date();
        fs.utimesSync(watched, now, now);

        // Rechargement = anti-rebond + rebuild ciblé + arrêt du groupe + respawn.
        // Le capteur est le PID publié dans le fichier d'état : c'est le canal que
        // le serveur alimente lui-même, pas une heuristique de log.
        const pidAfter = await waitForRuntimePidChange(pidBefore, 180000);
        if (pidAfter === pidBefore) {
          // Échec MUET jusqu'ici : le PID inchangé ne distingue pas « le watcher
          // n'a rien vu » de « le rebuild a échoué » ni de « l'arrêt du groupe
          // n'a pas rendu la main ». Le journal du runtime tranche, et c'est la
          // seule pièce qui survit à un runner distant.
          assert.fail(
            `le superviseur doit relancer son enfant après modification d'une source ` +
              `(pid inchangé : ${pidBefore})${tailDetachedLog()}`,
          );
        }
        // Un rechargement qui ne réécoute pas est un rechargement raté.
        assert.strictEqual(
          await isPortOpen(HTTP_PORT),
          true,
          "le serveur doit réécouter après rechargement",
        );
      } finally {
        const stop = await runCli(["stop"], CLI_TIMEOUT_MS);
        assert.strictEqual(stop.code, 0, `stop doit nettoyer\n${stop.stderr}`);
      }
      assert.strictEqual(await isPortOpen(HTTP_PORT), false);
    }, 400000);

    // ─── Développement SANS superviseur (`--no-watch`) ──────────────────────────
    // La sortie explicite du rechargement automatique. Une suite d'intégration en a
    // besoin : un rebuild déclenché au milieu d'un run coupe les connexions sous les
    // tests, et le diagnostic qui suit accuse le code plutôt que le décor.
    // La preuve porte sur le PIDFILE du superviseur, pas sur une liste de process :
    // l'observation externe n'existe pas partout (Windows, images minces), le fichier
    // si — c'est le seul capteur qui vaut sur les trois plateformes.
    it("development --no-watch → serveur en écoute et AUCUN superviseur", async () => {
      const r = await runCli(
        ["development", "--no-watch", "--detach", "--wait", "150"],
        170000,
      );
      try {
        assert.strictEqual(
          r.code,
          0,
          `--no-watch doit sortir 0 à la readiness\n${r.stdout}\n${r.stderr}`,
        );
        assert.strictEqual(
          await isPortOpen(HTTP_PORT),
          true,
          "le serveur de développement doit écouter, superviseur ou non",
        );
        const supervisor = readSupervisorPid(REPO_ROOT);
        assert.ok(
          supervisor === null || !isPidAlive(supervisor),
          `aucun superviseur ne doit tourner avec --no-watch (pid ${supervisor})`,
        );
      } finally {
        const stop = await runCli(["stop"], CLI_TIMEOUT_MS);
        assert.strictEqual(stop.code, 0, `stop doit nettoyer\n${stop.stderr}`);
      }
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
        const st = await runCli(["status"], CLI_TIMEOUT_MS);
        assert.strictEqual(st.code, 0);
        assert.ok(
          st.stdout.includes(String(port)),
          `status doit rapporter le port réel ${port}\n${st.stdout}`,
        );
      } finally {
        const stop = await runCli(["stop"], CLI_TIMEOUT_MS);
        assert.strictEqual(stop.code, 0, `stop doit nettoyer\n${stop.stderr}`);
      }
      assert.strictEqual(await isPortOpen(port), false);
    }, 210000);

    // ─── Point d'arrêt onReady SANS serveur ─────────────────────────────────────
    // `proxy:generate` déclare `kernelEvent: "onReady"` : la phase la plus profonde
    // AVANT initServers. Preuve que le boot s'arrête bien à la phase déclarée : la
    // conf est générée (introspection des serveurs) mais AUCUNE socket n'écoute.
    it("proxy:generate nginx (kernelEvent onReady) → conf générée, 0 serveur", async () => {
      const r = await runCli(["proxy:generate", "nginx"], CLI_TIMEOUT_MS);
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
            READY_TIMEOUT_MS,
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
    //     superviseur/enfant : sans `NF_DEV_CHILD=1` la sortie des commandes
    //     de module n'atteint pas stdout, et avec, le module `frontend` démarre Vite
    //     (process vivant) → le mode ONESHOT ne peut jamais terminer.
    // Le MÉCANISME sous-jacent (oneshot → `terminate`, daemon → `park`, `lifetime`)
    // reste couvert UNITAIREMENT par `KernelLifecycle.test.ts` (terminate()/park).
    // Réactiver quand les commandes de démo des modes de boot migreront hors d'un
    // module dev-only (module de banc mandatory) OU que le boot dev exposera la
    // sortie des commandes de module. Ce N'EST PAS un problème de flush Syslog
    // (filet anti-perte présent et fonctionnel) ni une régression (pré-existant).
    it.skip("test:batch → mode BATCH : exit 0, AUCUN serveur, terminaison propre", async () => {
      const r = await runCli(["test:batch"], CLI_TIMEOUT_MS);
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
            READY_TIMEOUT_MS,
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
