#!/usr/bin/env node
/**
 * Lance une commande de la forge et REND LA MAIN quand elle se termine — même
 * si un descendant détaché garde sa sortie ouverte — en nommant ce descendant.
 *
 * Le défaut qu'il traite (vécu : sept jobs Windows figés en six jours) : la
 * commande finit — turbo affiche « 38 successful, 38 total » — puis plus rien
 * jusqu'au plafond du job, et le nettoyage du runner tue un `node` ORPHELIN.
 * Un process détaché a hérité du tuyau de sortie de l'étape ; tant qu'il vit, ce
 * tuyau reste ouvert, et le runner attend sa fermeture. Tout est fini, rien ne
 * le dit.
 *
 * Deux gestes :
 *
 * 1. La commande reçoit SON tuyau, pas celui du runner. Un orphelin en hérite
 *    donc de celui-ci, qui meurt avec ce lanceur. La fin se lit sur `exit` (le
 *    process est mort), jamais sur `close` (tous les tuyaux sont fermés) — c'est
 *    `close` qui attend l'orphelin.
 * 2. Il NOMME ce qui reste : à la sortie si un tuyau est encore tenu, et après
 *    `--idle` secondes sans sortie si la commande elle-même ne finit pas —
 *    l'inventaire des process (ligne de commande, parent, orphelins) départage
 *    alors les deux cas. Un orphelin nommé est un défaut à corriger à sa source ;
 *    ce lanceur n'est que ce qui empêche qu'il coûte un job.
 *
 * Usage : node scripts/ci/run-watched.mjs [--idle <s>] [--] <commande…>
 */
import { spawn, execFile } from "node:child_process";
import { pathToFileURL } from "node:url";

/** Délai laissé aux tuyaux pour se vider après la mort du process. */
const DRAIN_MS = 3000;

/** `[[jj-]hh:]mm:ss` (le `etime` de `ps`) → secondes. */
export function parseElapsed(etime) {
  const m = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/u.exec(etime.trim());
  if (!m) return Number.NaN;
  const [, d, h, min, sec] = m;
  return (
    ((Number(d ?? 0) * 24 + Number(h ?? 0)) * 60 + Number(min)) * 60 +
    Number(sec)
  );
}

/** `CreationDate` sérialisé par PowerShell : `/Date(ms)/` (5.x) ou ISO (7.x). */
function parseCimDate(value) {
  const legacy = /Date\((\d+)/u.exec(String(value ?? ""));
  return legacy ? Number(legacy[1]) : Date.parse(String(value ?? ""));
}

/**
 * Lit la table des process rendue par le système.
 *
 * @param {string} platform - `process.platform` (injecté pour l'éprouver partout).
 * @param {string} raw - JSON de `Get-CimInstance` sous Windows, sortie de `ps` ailleurs.
 * @param {number} now - l'instant de la lecture (ms), pour dater les process POSIX.
 * @returns {{pid:number, ppid:number, startedAt:number, command:string}[]}
 */
export function parseProcessTable(platform, raw, now) {
  if (platform === "win32") {
    const data = JSON.parse(raw || "[]");
    const rows = Array.isArray(data) ? data : [data];
    return rows.map((r) => ({
      pid: Number(r.ProcessId),
      ppid: Number(r.ParentProcessId),
      startedAt: parseCimDate(r.CreationDate),
      command: String(r.CommandLine || r.Name || ""),
    }));
  }
  return raw
    .split("\n")
    .map((line) => /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/u.exec(line))
    .filter((m) => m !== null)
    .map((m) => ({
      pid: Number(m[1]),
      ppid: Number(m[2]),
      startedAt: now - parseElapsed(m[3]) * 1000,
      command: m[4],
    }));
}

/** Le sous-arbre de `rootPid` dans la table (lui compris). */
function subtree(rows, rootPid) {
  const set = new Set([rootPid]);
  for (let grew = true; grew;) {
    grew = false;
    for (const r of rows) {
      if (!set.has(r.pid) && set.has(r.ppid)) {
        set.add(r.pid);
        grew = true;
      }
    }
  }
  return set;
}

/**
 * Les process qui comptent : les descendants VIVANTS de la commande, et TOUT
 * process né pendant l'étape qui n'en descend plus — détaché, il a été rattaché
 * ailleurs (à `init` sous POSIX, à un parent mort sous Windows), et c'est lui
 * qui tient le tuyau.
 *
 * Aucun filtre sur le NOM : le tuyau peut être tenu par un binaire natif
 * (`esbuild`, `tsgo`, un addon Rust) aussi bien que par `node` — un filtre
 * `node|turbo` a laissé un gel sans coupable nommé (turbo.exe figé, sans enfant).
 * Sont écartés : ce lanceur, ses ancêtres (le shell de l'étape naît dans la marge
 * d'horloge) et son propre sous-arbre (l'inventaire lui-même).
 *
 * @param {{pid:number, ppid:number, startedAt:number, command:string}[]} rows - la table lue.
 * @param {number} rootPid - le process lancé par ce lanceur.
 * @param {number} selfPid - ce lanceur (écarté).
 * @param {number} since - naissance de ce lanceur (ms) ; 1 s de marge d'horloge.
 * @returns {{pid:number, ppid:number, command:string, detached:boolean}[]}
 */
export function selectSuspects(rows, rootPid, selfPid, since) {
  const descendants = subtree(rows, rootPid);
  const own = subtree(rows, selfPid);
  const byPid = new Map(rows.map((r) => [r.pid, r]));
  for (
    let r = byPid.get(selfPid);
    r && !own.has(r.ppid);
    r = byPid.get(r.ppid)
  ) {
    own.add(r.ppid);
  }
  const suspects = [];
  for (const r of rows) {
    if (descendants.has(r.pid)) suspects.push({ ...r, detached: false });
    else if (!own.has(r.pid) && r.startedAt >= since - 1000)
      suspects.push({ ...r, detached: true });
  }
  return suspects;
}

/** Lit la table des process — la capacité se CONSTATE, jamais ne se déduit. */
function readProcessTable() {
  const [cmd, args] =
    process.platform === "win32"
      ? [
          "powershell",
          [
            "-NoProfile",
            "-Command",
            "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine,CreationDate | ConvertTo-Json -Compress",
          ],
        ]
      : ["ps", ["-eo", "pid=,ppid=,etime=,args="]];
  return new Promise((resolve) => {
    execFile(cmd, args, { maxBuffer: 32 * 1024 * 1024 }, (error, stdout) => {
      if (error) resolve({ error: error.message });
      else {
        try {
          resolve({
            rows: parseProcessTable(process.platform, stdout, Date.now()),
          });
        } catch (e) {
          resolve({ error: e.message });
        }
      }
    });
  });
}

/** Plafond de l'inventaire : sans filtre de nom, un runner peut en compter beaucoup. */
const MAX_LISTED = 40;

/** Naissance de ce lanceur : ce qui est né avant n'est pas de cette étape. */
const STARTED = Date.now();

/** Écrit l'inventaire sur la sortie d'erreur, précédé de sa raison. */
async function report(reason, rootPid) {
  const table = await readProcessTable();
  const lines = [`\n[run-watched] ${reason}`];
  if (table.error) {
    lines.push(`  inventaire des process impossible : ${table.error}`);
  } else {
    const suspects = selectSuspects(table.rows, rootPid, process.pid, STARTED);
    if (suspects.length === 0)
      lines.push("  aucun descendant ni process détaché né pendant l'étape");
    for (const s of suspects.slice(0, MAX_LISTED)) {
      lines.push(
        `  ${s.detached ? "DÉTACHÉ " : ""}pid ${s.pid} ← ${s.ppid} : ${s.command.slice(0, 300)}`,
      );
    }
    if (suspects.length > MAX_LISTED)
      lines.push(`  … et ${suspects.length - MAX_LISTED} autre(s)`);
  }
  process.stderr.write(`${lines.join("\n")}\n\n`);
}

/**
 * Lance la commande, relaie sa sortie, rend son code de sortie.
 *
 * @param {string[]} command - la commande et ses arguments.
 * @param {{idleSeconds:number}} options - silence au-delà duquel on inventorie.
 * @returns {Promise<number>} le code de sortie de la commande.
 */
export async function runWatched(command, { idleSeconds }) {
  // `shell` : `npm` est un `.cmd` sous Windows, que `spawn` seul ne lance pas.
  const child = spawn(command.join(" "), {
    shell: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let last = Date.now();
  let idleReported = false;
  child.stdout.on("data", (c) => {
    last = Date.now();
    process.stdout.write(c);
  });
  child.stderr.on("data", (c) => {
    last = Date.now();
    process.stderr.write(c);
  });
  const timer = setInterval(() => {
    if (!idleReported && Date.now() - last > idleSeconds * 1000) {
      idleReported = true;
      void report(
        `aucune sortie depuis ${idleSeconds} s — la commande ne rend pas la main :`,
        child.pid,
      );
    }
  }, 5000);
  timer.unref();

  const code = await new Promise((resolve) => {
    child.on("exit", (c, signal) => resolve(c ?? (signal ? 1 : 0)));
  });
  clearInterval(timer);
  const drained = await new Promise((resolve) => {
    if (child.stdout.closed && child.stderr.closed) return resolve(true);
    const t = setTimeout(() => resolve(false), DRAIN_MS);
    t.unref();
    child.on("close", () => {
      clearTimeout(t);
      resolve(true);
    });
  });
  if (!drained) {
    await report(
      `la commande est terminée (code ${code}) mais un descendant garde sa sortie ouverte — ` +
        "le lanceur rend la main quand même :",
      child.pid,
    );
    child.stdout.destroy();
    child.stderr.destroy();
  }
  return code;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  // Le `--` est FACULTATIF : PowerShell, shell par défaut d'une étape Windows,
  // peut l'avaler avant de passer la main à un exécutable.
  let argv = process.argv.slice(2);
  let idleSeconds = 180;
  if (argv[0] === "--idle") {
    idleSeconds = Number(argv[1]);
    argv = argv.slice(2);
  }
  const command = argv[0] === "--" ? argv.slice(1) : argv;
  if (command.length === 0 || !Number.isFinite(idleSeconds)) {
    process.stderr.write(
      "usage : run-watched.mjs [--idle <s>] [--] <commande…>\n",
    );
    process.exit(64);
  }
  const code = await runWatched(command, { idleSeconds });
  // Sortie EXPLICITE : un tuyau encore tenu par un orphelin garderait sinon ce
  // lanceur en vie, et reproduirait le défaut qu'il existe pour éviter.
  process.exit(code);
}
