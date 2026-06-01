#!/usr/bin/env node
/*
 * boot-profile.mjs — AUDIT fin du boot Nodefony. Capture la sortie horodatée d'un boot
 * (jusqu'à "Server Listen on http") et révèle où part le temps :
 *  - jalons de phase (onPreStart→onPostReady + Server Listen) avec leur t (ms depuis le 1er log)
 *  - top des plus gros écarts entre 2 logs consécutifs (= opérations lentes du boot)
 *
 * Usage : node scripts/boot-profile.mjs -- production --workers 1
 * Prérequis : dist à jour, ports libres.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..");
const BIN = path.join(REPO_ROOT, "src", "nodefony", "bin", "nodefony");
const READY_RE = /Server Listen on http/i;
const sep = process.argv.indexOf("--");
const cmdArgs =
  sep >= 0
    ? process.argv.slice(sep + 1)
    : ["production", "--workers", "1", "-d"];

// timestamp "HH:MM:SS.mmm" → ms absolus dans la journée
function parseTs(line) {
  const m = line.match(/\b(\d{2}):(\d{2}):(\d{2})\.(\d{3})\b/);
  if (!m) return null;
  return ((+m[1] * 60 + +m[2]) * 60 + +m[3]) * 1000 + +m[4];
}

const PHASES = [
  ["onPreStart", /onPreStart/i],
  ["onStart", /\bonStart\b/i],
  ["loadApp", /SERVICE ADD|loadApp/i],
  ["onPreRegister", /onPreRegister/i],
  ["MODULE ADD", /MODULE ADD/i],
  ["onRegister", /\bonRegister\b/i],
  ["onPreBoot", /onPreBoot/i],
  ["onBoot", /\bonBoot\b/i],
  ["CREATE TABLE", /CREATE TABLE|drizzle|sequelize/i],
  ["onReady", /\bonReady\b/i],
  ["initServers", /initServers|onServersReady/i],
  ["Server Listen", READY_RE],
];

const child = spawn(process.execPath, [BIN, ...cmdArgs], {
  cwd: REPO_ROOT,
  env: { ...process.env, FORCE_COLOR: "0" },
});
const lines = [];
let buf = "";
let t0 = null;
const seenPhase = new Map();
let done = false;

function record(chunk) {
  buf += chunk.toString();
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const raw = buf.slice(0, i);
    buf = buf.slice(i + 1);
    const clean = raw.replace(/\x1b\[[0-9;]*m/g, "");
    const ts = parseTs(clean);
    if (ts == null) continue;
    if (t0 == null) t0 = ts;
    let rel = ts - t0;
    if (rel < 0) rel += 86400000;
    lines.push({ rel, text: clean.trim() });
    for (const [name, re] of PHASES) {
      if (!seenPhase.has(name) && re.test(clean)) seenPhase.set(name, rel);
    }
    if (READY_RE.test(clean)) finish();
  }
}
function finish() {
  if (done) return;
  done = true;
  try {
    child.kill("SIGTERM");
  } catch {
    /* ignore */
  }
  setTimeout(() => {
    try {
      child.kill("SIGKILL");
    } catch {
      /* ignore */
    }
  }, 3000);
  report();
}
child.stdout.on("data", record);
child.stderr.on("data", record);
child.once("exit", () => finish());
setTimeout(() => finish(), 60000);

function report() {
  const total = lines.length ? lines[lines.length - 1].rel : 0;
  console.log(
    `\n=== BOOT PROFILE [${cmdArgs.join(" ")}] — total ${total} ms · ${lines.length} log lines ===\n`,
  );
  console.log("— Jalons de phase (t = ms depuis le 1er log) —");
  for (const [name] of PHASES) {
    if (seenPhase.has(name))
      console.log(`  ${String(seenPhase.get(name)).padStart(6)} ms  ${name}`);
  }
  // écarts entre logs consécutifs
  const gaps = [];
  for (let i = 1; i < lines.length; i++) {
    gaps.push({
      dt: lines[i].rel - lines[i - 1].rel,
      at: lines[i - 1].rel,
      after: lines[i - 1].text,
      before: lines[i].text,
    });
  }
  gaps.sort((a, b) => b.dt - a.dt);
  console.log(
    "\n— Top 15 écarts inter-logs (l'opération entre les 2 a coûté ce temps) —",
  );
  for (const g of gaps.slice(0, 15)) {
    if (g.dt <= 0) continue;
    console.log(
      `  +${String(g.dt).padStart(5)} ms @${String(g.at).padStart(6)}  après: ${g.after.slice(0, 95)}`,
    );
  }
}
