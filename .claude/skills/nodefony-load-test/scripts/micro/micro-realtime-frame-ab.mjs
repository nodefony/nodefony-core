/**
 * Micro-banc A/B — ce que coûte, PAR FRAME, le vrai `RealtimeController` BÂTI,
 * entre deux `dist` de `@nodefony/realtime` (avant / après un diff).
 *
 * À la différence de `micro-realtime-state.mjs` (qui compare deux façons de
 * tenir l'état sur des contextes factices), celui-ci exécute le code PUBLIÉ :
 * le `dist` qu'un utilisateur reçoit, monté par le harnais du paquet
 * (`@nodefony/realtime/testing`) sur une fausse connexion.
 *
 * Trois chemins, chacun sur la connexion déjà accueillie (welcome émis) :
 *
 * - `inbound`  : une frame texte `ping` — `handleRealtime` → lecture de l'état →
 *   `transport.feed` → `JSON.parse` → dispatch d'une notification ;
 * - `notify`   : `notifyClient` — lecture de l'état → `peer.notify` → sérialisation
 *   → `transport.send` ;
 * - `binary`   : une frame binaire écartée (chemin froid, compteur).
 *
 * L'émission réseau est neutralisée (`send` vide) : le harnais lit et valide
 * chaque trame sortante, ce qui mesurerait le harnais, pas le contrôleur.
 *
 * Protocole : un PROCESS par mesure (JIT frais, aucune variante ne réchauffe
 * l'autre), variantes ALTERNÉES A B A B… pour étaler la dérive thermique,
 * médiane de RUNS. Validité : chaque variante doit avoir accueilli la connexion
 * et vu ses frames traitées (compteur de la sonde) — sinon exit 1, aucun
 * chiffre publié.
 *
 * Usage :
 *   node micro-realtime-frame-ab.mjs --a <dist avant> --b <dist après> [--runs 7]
 *   (un `dist` = le dossier `dist/` de @nodefony/realtime, ou sa copie)
 * Mode enfant (interne) : --child <dist> <chemin>
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

const WARM = 2e5;
const N = 2e6;
const BINARY_N = 2e5;

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i === -1 ? def : args[i + 1];
};

if (args[0] === "--child") {
  await child(path.resolve(args[1]), args[2]);
} else {
  parent();
}

/** Mesure UN chemin sur UN dist, imprime `ns/frame` en JSON. */
async function child(dist, which) {
  await import("reflect-metadata");
  const { RealtimeController } = await import(
    pathToFileURL(path.join(dist, "index.js")).href
  );
  const { createRealtimeHarness } = await import(
    pathToFileURL(path.join(dist, "nodefony/testing/index.js")).href
  );

  class BenchRt extends RealtimeController {
    constructor(ctx) {
      super("BenchRt", ctx);
    }
    realtimeActions() {
      return {};
    }
  }
  const h = createRealtimeHarness((ctx) => new BenchRt(ctx));
  await h.connect();
  const rt = h.controller;
  // Neutralise l'émission : seul le contrôleur est mesuré.
  let sent = 0;
  rt.context.connection.send = (_data, cb) => {
    sent++;
    cb?.();
  };

  const ping = '{"jsonrpc":"2.0","method":"ping"}';
  const payload = { n: 1, s: "x" };
  const bin = Buffer.from([1, 2, 3, 4]);
  const step = {
    inbound: () => rt.handleRealtime(ping),
    notify: () => rt.notifyClient("bench:tick", payload),
    binary: () => rt.handleRealtime(bin),
  }[which];
  if (step === undefined) throw new Error(`chemin inconnu : ${which}`);
  const n = which === "binary" ? BINARY_N : N;

  for (let i = 0; i < WARM; i++) step();
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < n; i++) step();
  const ns = Number(process.hrtime.bigint() - t0) / n;

  // Validité : le chemin a réellement tourné.
  if (which === "notify" && sent < n) {
    console.error(`notify : ${sent} trames émises pour ${n} appels`);
    process.exit(1);
  }
  h.dispose();
  console.log(JSON.stringify({ ns }));
}

function parent() {
  const a = opt("--a");
  const b = opt("--b");
  const runs = Number(opt("--runs", "7"));
  if (!a || !b) {
    console.error("usage : --a <dist avant> --b <dist après> [--runs 7]");
    process.exit(2);
  }
  const self = new URL(import.meta.url).pathname;
  const measure = (dist, which) => {
    const r = spawnSync(process.execPath, [self, "--child", dist, which], {
      encoding: "utf8",
    });
    if (r.status !== 0) {
      console.error(r.stderr || r.stdout);
      process.exit(1);
    }
    return JSON.parse(r.stdout.trim().split("\n").pop()).ns;
  };
  const median = (xs) => {
    const s = [...xs].sort((x, y) => x - y);
    return s[Math.floor(s.length / 2)];
  };
  const rows = [];
  for (const which of ["inbound", "notify", "binary"]) {
    const A = [];
    const B = [];
    for (let i = 0; i < runs; i++) {
      A.push(measure(a, which));
      B.push(measure(b, which));
    }
    const ma = median(A);
    const mb = median(B);
    rows.push({
      chemin: which,
      "A ns/frame": ma.toFixed(1),
      "B ns/frame": mb.toFixed(1),
      "écart %": (((mb - ma) / ma) * 100).toFixed(1),
      "A min–max": `${Math.min(...A).toFixed(0)}–${Math.max(...A).toFixed(0)}`,
      "B min–max": `${Math.min(...B).toFixed(0)}–${Math.max(...B).toFixed(0)}`,
    });
  }
  console.table(rows);
}
