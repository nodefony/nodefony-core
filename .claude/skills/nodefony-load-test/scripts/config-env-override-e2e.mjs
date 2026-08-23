// Banc e2e TERRAIN — override de config par variable d'environnement (ADR-0006) — sans navigateur.
//
// Prouve, sur un VRAI boot du serveur, le mécanisme générique `NF__<APP|MODULE>__<CHEMIN>` :
//   [1] NF__APP__SERVERS__HTTP__PORT=<p> + NF__APP__SERVERS__HTTPS__PORT=<q>
//          → le serveur HTTP écoute SUR LE PORT SURCHARGÉ (override appliqué au boot, 0 code)
//   [2] NF__APP__SERVERS__HTTP__PORT=abc
//          → boot REJETÉ (exit ≠ 0) : la valeur invalide est rattrapée par le Zod app (fail-closed)
//
// Contrairement aux autres bancs, celui-ci SPAWN lui-même le serveur (NF_DEV_CHILD=1 = process
// unique, pas de superviseur) → il ne dépend PAS d'un serveur déjà UP, et les ports surchargés (7771/
// 7772) évitent toute collision avec un éventuel dev déjà lancé (5151/5152).
//
// Prérequis : `npm run build` (dist à jour — le boot importe `dist/index.js`).
// Lancement (depuis n'importe où) :
//   node .claude/skills/nodefony-load-test/scripts/config-env-override-e2e.mjs
import { spawn } from "node:child_process";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
// racine repo = 4 niveaux au-dessus de .claude/skills/nodefony-load-test/scripts
const REPO_ROOT = resolve(SCRIPT_DIR, "../../../..");
const BIN = "node_modules/nodefony/bin/nodefony";

const HTTP_PORT = 7771;
const HTTPS_PORT = 7772;
const BOOT_TIMEOUT_MS = 45000; // boot dev + Vite frontend peut être long
const FAIL_TIMEOUT_MS = 30000; // l'erreur de config plante TÔT (avant les serveurs)

let ok = 0;
let ko = 0;
const check = (name, cond, got) => {
  console.log(`${cond ? "✓" : "✗"} ${name}${cond ? "" : ` — ${got ?? ""}`}`);
  cond ? ok++ : ko++;
};

/** Boote le serveur dev en PROCESS UNIQUE (bypass superviseur), dans son propre groupe. */
function bootServer(extraEnv) {
  const child = spawn(process.execPath, [BIN, "development"], {
    cwd: REPO_ROOT,
    env: { ...process.env, NF_DEV_CHILD: "1", ...extraEnv },
    detached: true, // leader de groupe → group-kill propre (enfants Vite inclus)
    stdio: ["ignore", "ignore", "pipe"],
  });
  // Drainer stderr (sinon le buffer de pipe se remplit et BLOQUE l'enfant) + garder
  // la queue pour diagnostiquer un échec.
  child._stderrTail = "";
  child.stderr.on("data", (d) => {
    child._stderrTail = (child._stderrTail + d.toString()).slice(-1200);
  });
  return child;
}

/** Tue le groupe de process (l'enfant + ses descendants Vite). */
function killGroup(child) {
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    /* déjà mort */
  }
}

/** Résout `true` dès que `port` accepte une connexion TCP, `false` au timeout. */
function waitPort(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((res) => {
    const tick = () => {
      const s = net.connect(port, "127.0.0.1");
      s.once("connect", () => {
        s.destroy();
        res(true);
      });
      s.once("error", () => {
        s.destroy();
        if (Date.now() > deadline) res(null);
        else setTimeout(tick, 250);
      });
    };
    tick();
  });
}

/** Résout le code de sortie de l'enfant, ou `null` s'il vit toujours après `timeoutMs`. */
function waitExit(child, timeoutMs) {
  return new Promise((res) => {
    const t = setTimeout(() => res(null), timeoutMs);
    child.once("exit", (code, signal) => {
      clearTimeout(t);
      res(code ?? `signal:${signal}`);
    });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── [1] Override appliqué : le serveur écoute sur le port HTTP surchargé ──────
console.log(
  `\n[1] NF__APP__SERVERS__HTTP__PORT=${HTTP_PORT} (+ https=${HTTPS_PORT}) → écoute sur ${HTTP_PORT}`,
);
const c1 = bootServer({
  NF__APP__SERVERS__HTTP__PORT: String(HTTP_PORT),
  NF__APP__SERVERS__HTTPS__PORT: String(HTTPS_PORT),
});
const listening = await waitPort(HTTP_PORT, BOOT_TIMEOUT_MS);
check(
  `serveur HTTP en écoute sur le port surchargé ${HTTP_PORT}`,
  listening === true,
  `port muet après ${BOOT_TIMEOUT_MS}ms\n${c1._stderrTail}`,
);
killGroup(c1);
await sleep(1500); // laisser les ports se libérer

// ── [2] Valeur invalide : boot REJETÉ (fail-closed du Zod app) ───────────────
console.log(
  `\n[2] NF__APP__SERVERS__HTTP__PORT=abc → boot doit ÉCHOUER (exit ≠ 0)`,
);
const c2 = bootServer({ NF__APP__SERVERS__HTTP__PORT: "abc" });
const exit = await waitExit(c2, FAIL_TIMEOUT_MS);
check(
  "boot rejeté (exit non-nul) sur valeur invalide — fail-closed",
  typeof exit === "number" && exit !== 0,
  exit === null
    ? `toujours vivant après ${FAIL_TIMEOUT_MS}ms (override NON validé !)\n${c2._stderrTail}`
    : `exit=${exit}`,
);
killGroup(c2);

console.log(`\n${ko === 0 ? "✅" : "❌"} ${ok}/${ok + ko} OK`);
process.exit(ko === 0 ? 0 : 1);
