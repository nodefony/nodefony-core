#!/usr/bin/env node
/**
 * Une application que `nodefony create app` PRODUIT pour un gestionnaire
 * donné démarre-t-elle, démo comprise, et sert-elle sa page `/demo` ?
 *
 * 🔴 Pourquoi ce banc existe (#755). Une application pnpm avec sa démo ne
 * servait aucune interface (#754) : démo refusée au démarrage, Vite arrêté —
 * et aucun automate ne l'a vu. Le banc « Code généré » génère, installe et
 * démarre son témoin avec npm SEUL ; or npm hisse les dépendances et masque
 * ce que pnpm, strict, refuse : un module non déclaré, un plugin Vite installé
 * dans un seul module, une pair prise au registre. Le seul scénario pnpm vivait
 * dans le smoke de publication, lancé à la main.
 *
 * Le geste est celui d'un utilisateur, joué par SON gestionnaire : génération
 * (qui installe), build, `nodefony development`. Les lignes de commande
 * sortent du PRODUIT (`packageManagerCommandLines`) : le banc ne recopie
 * aucune syntaxe, il exécute celle que le gabarit conseille.
 *
 * Verdict, lu dans le bilan que le noyau écrit (`var/last-boot.json`) et sur
 * la page elle-même :
 *   - démarrage allé au bout (`status: "ok"`) ;
 *   - `demo` dans `modulesLoaded` ;
 *   - aucune notice `MODULE_FAILED` ni `FRONTEND_BUILD_FAILED` ;
 *   - aucun `ERROR` émis pendant le démarrage ;
 *   - `GET /demo` → 200.
 *
 * Le décor est câblé sur le checkout (`--link`), pour la raison que porte
 * `check-scaffold-format.mjs` : sur un commit d'estampille, la version
 * épinglée par le gabarit n'existe pas encore sur le registre.
 *
 *   node scripts/scaffold/check-scaffold-boot.mjs                  # pnpm + svelte
 *   node scripts/scaffold/check-scaffold-boot.mjs --package-manager=yarn --frontend=react
 *   node scripts/scaffold/check-scaffold-boot.mjs --keep           # garde le décor
 *
 * ⚠️ Démarre un serveur sur `--port` (15161 par défaut, et le suivant pour
 * HTTPS) : jamais sur 5151, celui d'un `nodefony development` déjà ouvert.
 *
 * @usage node scripts/scaffold/check-scaffold-boot.mjs [--package-manager=pnpm] [--frontend=svelte] [--port=15161] [--keep]
 */
import { spawn, spawnSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
} from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { packageManagerCommandLines, packageManagerToolchain } from "nodefony";
import { REPO_ROOT as ROOT } from "../lib/repo-root.mjs";
// La source TypeScript, comme `scripts/repo/turbo.mjs` : l'implémentation
// UNIQUE qui tue un arbre (groupe POSIX, `taskkill /T` sous Windows).
import { signalProcessGroup } from "../../src/nodefony/src/service/dev/devProcess.ts";
import { tailOf } from "../lib/tail-of.mjs";

const PACKAGE_MANAGERS = ["npm", "pnpm", "yarn", "bun"];
const FRONTENDS = ["react", "vue", "angular", "svelte"];
/** Notices du bilan qui, à elles seules, font tomber le banc. */
const BLOCKING_NOTICES = ["MODULE_FAILED", "FRONTEND_BUILD_FAILED"];
/** Le premier démarrage prébundle les fronts : large, mais borné. */
const BOOT_TIMEOUT_MS = 240_000;
const STOP_TIMEOUT_MS = 30_000;

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit === undefined ? fallback : hit.slice(name.length + 3);
};
/**
 * La valeur d'une option, prise DANS sa liste autorisée : ce qui vient de la
 * ligne de commande n'est jamais recopié tel quel dans le journal (injection
 * de lignes forgées, `js/log-injection`). Un `includes` contrôlerait la
 * valeur sans changer sa provenance.
 */
function choice(name, allowed, fallback) {
  const asked = option(name, fallback);
  const hit = allowed.find((value) => value === asked);
  if (hit === undefined) {
    console.error(`--${name} inconnu — attendus : ${allowed.join(", ")}`);
    process.exit(2);
  }
  return hit;
}
const pm = choice("package-manager", PACKAGE_MANAGERS, "pnpm");
const frontend = choice("frontend", FRONTENDS, "svelte");
const port = Number(option("port", "15161"));
const keep = args.includes("--keep");
if (!Number.isInteger(port) || port <= 0 || port >= 65_535) {
  console.error("--port invalide : un entier entre 1 et 65 534");
  process.exit(2);
}

const lines = packageManagerCommandLines(pm);
const dir = mkdtempSync(path.join(tmpdir(), `nf-scaffold-boot-${pm}-`));
const app = path.join(dir, "app");
const serverLog = path.join(dir, "server.log");
const env = {
  ...process.env,
  NF_PORT: String(port),
  NF_PORT_HTTPS: String(port + 1),
};

/** Une étape : son titre, puis ✓ ou ✗ avec la sortie qui l'explique. */
const failures = [];
function check(label, ok, detail = "") {
  if (ok) {
    console.log(`✓ ${label}`);
    return;
  }
  failures.push(label);
  console.error(`✗ ${label}${detail === "" ? "" : `\n${detail}`}`);
}

/**
 * Joue une ligne de commande du produit dans l'application. Le `shell` est
 * voulu : la ligne est une CHAÎNE rendue par le produit (`pnpm run build`),
 * et `pnpm.cmd` ne s'exécute pas sans lui sous Windows.
 */
function runLine(line) {
  return spawnSync(line, { cwd: app, env, encoding: "utf8", shell: true });
}

/**
 * `GET` sur le serveur de l'application ; rend le statut, ou l'erreur.
 *
 * Le message d'erreur vient du réseau, et finit dans un libellé journalisé :
 * ses fins de ligne sont aplaties ICI, au point d'entrée, pour qu'aucune
 * ligne forgée n'entre dans le journal (`js/log-injection`).
 */
function statusOf(pathname) {
  return new Promise((resolve) => {
    const request = http.get(
      { host: "127.0.0.1", port, path: pathname, timeout: 15_000 },
      (response) => {
        response.resume();
        resolve(String(response.statusCode));
      },
    );
    request.on("timeout", () => request.destroy(new Error("délai dépassé")));
    request.on("error", (error) =>
      resolve(error.message.replace(/[\r\n]+/g, " ")),
    );
  });
}

/** Le bilan du démarrage, ou `null` tant qu'il n'est pas écrit. */
function readLastBoot() {
  const file = path.join(app, "var", "last-boot.json");
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    // Écrit au même instant qu'on le lit : la prochaine lecture tranchera.
    return null;
  }
}

let server = null;
let serverExited = null;

async function main() {
  console.log(`décor : ${app} (${pm}, front ${frontend}, port ${port})`);
  const gen = spawnSync(
    process.execPath,
    [
      path.join(ROOT, "src", "nodefony", "bin", "nodefony"),
      "create",
      "app",
      "appboot",
      "--dir",
      app,
      "--yes",
      "--link",
      "--preset",
      "complete",
      "--frontend",
      frontend,
      "--package-manager",
      pm,
      // Explicite, bien que par défaut : le banc éprouve la démo, et doit en
      // dire autant sur un commit où elle ne l'était pas encore.
      "--demo",
    ],
    { cwd: ROOT, env, encoding: "utf8" },
  );
  check(
    `create app --package-manager ${pm} --frontend ${frontend} (installe par ${pm})`,
    gen.status === 0,
    tailOf(`${gen.stdout}${gen.stderr}`, 40, "rejouer avec --keep"),
  );
  if (gen.status !== 0) return;

  const lockfile = packageManagerToolchain(pm).lockfile;
  check(
    `${pm} a écrit son verrou (${lockfile})`,
    existsSync(path.join(app, lockfile)),
  );

  const build = runLine(lines.run("build"));
  check(
    lines.run("build"),
    build.status === 0,
    tailOf(`${build.stdout}${build.stderr}`, 60, "rejouer avec --keep"),
  );
  if (build.status !== 0) return;

  const out = openSync(serverLog, "w");
  server = spawn(`${lines.exec("nodefony")} development`, {
    cwd: app,
    env,
    shell: true,
    stdio: ["ignore", out, out],
    // Chef de son groupe : l'arbre (superviseur, noyau, Vite) se tue d'un
    // signal. Pas sous Windows, où `detached` ouvrirait une console et où
    // `taskkill /T` suit les parents.
    detached: process.platform !== "win32",
  });
  closeSync(out);
  serverExited = new Promise((resolve) => server.once("exit", resolve));
  const exited = () => server.exitCode !== null || server.signalCode !== null;

  const deadline = Date.now() + BOOT_TIMEOUT_MS;
  let boot = null;
  while (boot === null && !exited() && Date.now() < deadline) {
    await sleep(1000);
    boot = readLastBoot();
  }
  check(
    `${lines.exec("nodefony")} development — bilan de démarrage écrit`,
    boot !== null,
    exited()
      ? "le serveur s'est arrêté avant d'écrire son bilan"
      : `aucun bilan après ${BOOT_TIMEOUT_MS / 1000} s`,
  );
  if (boot === null) return;

  check(
    `démarrage allé au bout (status ${boot.status}, phase ${boot.phase ?? "?"})`,
    boot.status === "ok",
    JSON.stringify(boot.error ?? {}, null, 2),
  );
  const loaded = Array.isArray(boot.modulesLoaded) ? boot.modulesLoaded : [];
  check(
    `module « demo » chargé (${loaded.length} modules)`,
    loaded.includes("demo"),
    `modulesLoaded : ${loaded.join(", ")}`,
  );
  const notices = Array.isArray(boot.notices) ? boot.notices : [];
  const blocking = notices.filter((n) => BLOCKING_NOTICES.includes(n.code));
  check(
    `aucune notice ${BLOCKING_NOTICES.join(" / ")}`,
    blocking.length === 0,
    blocking.map((n) => `  ${n.code} — ${n.message}`).join("\n"),
  );
  check(
    `aucune ERROR au démarrage (${boot.errors ?? 0})`,
    (boot.errors ?? 0) === 0,
  );
  const status = await statusOf("/demo");
  check(`GET /demo → ${status}`, status === "200");
}

/** Arrête le serveur par la commande du produit, puis attend sa mort. */
async function stopServer() {
  if (server === null) return;
  runLine(`${lines.exec("nodefony")} stop`);
  const dead = await Promise.race([
    serverExited.then(() => true),
    sleep(STOP_TIMEOUT_MS).then(() => false),
  ]);
  if (!dead) {
    console.error(
      `⚠️ serveur toujours vivant ${STOP_TIMEOUT_MS / 1000} s après « nodefony stop » — arbre tué`,
    );
  }
  // Toujours : un Vite resté orphelin garderait le décor pour répertoire
  // courant, et Windows refuserait de le supprimer. Sans survivant, no-op.
  if (server.pid !== undefined) signalProcessGroup(server.pid, "SIGKILL");
  if (!dead) await serverExited;
}

try {
  await main();
} finally {
  await stopServer();
  if (failures.length > 0 && existsSync(serverLog)) {
    console.error("\n── journal du serveur ──");
    console.error(
      tailOf(
        readFileSync(serverLog, "utf8"),
        80,
        keep ? `entier dans ${serverLog}` : "rejouer avec --keep",
      ),
    );
  }
  if (keep) console.log(`décor conservé : ${app}`);
  else rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
}

if (failures.length > 0) {
  console.error(
    `\n${failures.length} contrôle(s) en échec. La correction va dans le ` +
      "GÉNÉRATEUR ou ses GABARITS (src/nodefony/), jamais dans l'application.",
  );
  process.exit(1);
}
console.log(`\napplication ${pm} + démo : démarre et sert /demo.`);
