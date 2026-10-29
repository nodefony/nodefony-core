/**
 * Micro-banc — ce que coûte, PAR TRAME ENTRANTE, le verrou de trame du pare-feu
 * (`buildFrameAuthorizer`, @nodefony/security), rapporté au coût total de la trame
 * dans le vrai `RealtimeController` BÂTI.
 *
 * Question tranchée : retenir le verdict du verrou par connexion et par canal
 * (ADR-0022 §6, décision 1 étendue) vaut-il la peine ? Seulement si le verrou pèse
 * une part significative de la trame.
 *
 * Chemins, chacun sur une connexion déjà accueillie (welcome émis), identité
 * AUTHENTIFIÉE `ROLE_USER` :
 *
 * - `free`  : trame entrante sur un canal plein-duplex SANS politique ;
 * - `roles` : trame entrante sur un canal plein-duplex à politique `{ roles: ["ROLE_USER"] }`.
 *
 * Pour chacun, trois mesures :
 * - `sans verrou`  : la trame complète, aucun verrou posé sur le hub ;
 * - `avec verrou`  : la trame complète, VRAI verrou (fabrique de test de security,
 *   la même `buildFrameAuthorizer` que le boot) ;
 * - `verrou seul`  : l'appel du verrou sur la frame déjà décodée, hors pipeline.
 *
 * L'émission réseau est neutralisée (`send` vide). Protocole : un PROCESS par
 * mesure (JIT frais), variantes ALTERNÉES, médiane de RUNS. Validité : le
 * gestionnaire a reçu chaque trame, et le verrou a été APPELÉ (compteur d'une
 * passe de contrôle) — sinon exit 1, aucun chiffre publié.
 *
 * Usage (racine du dépôt, `dist` à jour de @nodefony/realtime et @nodefony/security) :
 *   node .claude/skills/nodefony-load-test/scripts/micro/micro-frame-authorizer.mjs [--runs 7]
 * Mode enfant (interne) : --child <chemin> <mesure>
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

const WARM = 2e5;
const N = 2e6;
const ROOT = process.cwd();
const RT = path.join(ROOT, "src/packages/@nodefony/realtime/dist");
const SEC = path.join(ROOT, "src/packages/@nodefony/security/dist");

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i === -1 ? def : args[i + 1];
};

if (args[0] === "--child") {
  await child(args[1], args[2]);
} else {
  parent();
}

/** Mesure UN chemin, UNE variante, imprime `ns/trame` en JSON. */
async function child(which, variant) {
  await import("reflect-metadata");
  const load = (dir, rel) => import(pathToFileURL(path.join(dir, rel)).href);
  const { RealtimeController, RealtimeInbound, getRealtimeHub } = await load(
    RT,
    "index.js",
  );
  const { createRealtimeHarness } = await load(RT, "nodefony/testing/index.js");
  const { createTestFrameAuthorizer, createTestIdentity } = await load(
    SEC,
    "nodefony/testing/index.js",
  );

  const channel = which === "roles" ? "bench:in-roles" : "bench:in-free";
  let received = 0;
  class BenchRt extends RealtimeController {
    constructor(ctx) {
      super("BenchRt", ctx);
    }
    realtimeActions() {
      return {};
    }
    onIn() {
      received++;
    }
  }
  // Décorateur appliqué à la main : ce que `tsc` émet pour `@RealtimeInbound`.
  RealtimeInbound(
    channel,
    which === "roles" ? { roles: ["ROLE_USER"] } : undefined,
  )(BenchRt.prototype, "onIn");

  const hub = getRealtimeHub();
  const realLock = createTestFrameAuthorizer(hub);
  // `memo` : PROTOTYPE du verdict retenu par connexion et par canal — une Map par
  // connexion, clé = méthode. Ce n'est pas le code du produit : il chiffre ce que
  // la décision gagnerait, avant qu'on l'écrive.
  const verdicts = new Map();
  const lock =
    variant === "memo"
      ? (f, t) => {
          const m = f?.method;
          let v = verdicts.get(m);
          if (v === undefined) {
            v = realLock(f, t);
            verdicts.set(m, v);
          }
          return v;
        }
      : realLock;
  const identity = createTestIdentity({ roles: ["ROLE_USER"] });
  const h = createRealtimeHarness((ctx) => new BenchRt(ctx), {
    identity,
    ...(variant === "nolock" ? {} : { frameAuthorizer: lock }),
  });
  await h.connect();
  const rt = h.controller;
  rt.context.connection.send = (_data, cb) => cb?.();

  const text = `{"jsonrpc":"2.0","method":"${channel}","params":{"n":1}}`;
  const frame = { jsonrpc: "2.0", method: channel, params: { n: 1 } };

  // Passe de contrôle : le verrou est-il APPELÉ, et laisse-t-il passer ?
  if (variant === "lock" || variant === "memo") {
    let calls = 0;
    hub.setFrameAuthorizer((f, t) => {
      calls++;
      return lock(f, t);
    });
    rt.handleRealtime(text);
    hub.setFrameAuthorizer(lock);
    if (calls === 0) fail("le verrou n'a pas été appelé sur la trame entrante");
  }
  if (variant === "lockonly" && lock(frame, identity) !== true) {
    fail("le verrou refuse la trame : la mesure porterait sur un refus");
  }

  const step =
    variant === "lockonly"
      ? () => lock(frame, identity)
      : () => rt.handleRealtime(text);
  for (let i = 0; i < WARM; i++) step();
  const before = received;
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < N; i++) step();
  const ns = Number(process.hrtime.bigint() - t0) / N;
  if (variant !== "lockonly" && received - before !== N) {
    fail(`${received - before} trames reçues pour ${N} envoyées`);
  }
  h.dispose();
  console.log(JSON.stringify({ ns }));
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function parent() {
  const runs = Number(opt("--runs", "7"));
  const self = new URL(import.meta.url).pathname;
  const measure = (which, variant) => {
    const r = spawnSync(process.execPath, [self, "--child", which, variant], {
      encoding: "utf8",
      cwd: ROOT,
    });
    if (r.status !== 0) {
      console.error(r.stderr || r.stdout);
      process.exit(1);
    }
    return JSON.parse(r.stdout.trim().split("\n").pop()).ns;
  };
  const median = (xs) =>
    [...xs].sort((x, y) => x - y)[Math.floor(xs.length / 2)];
  const spread = (xs) =>
    `${Math.min(...xs).toFixed(0)}–${Math.max(...xs).toFixed(0)}`;
  const rows = [];
  for (const which of ["free", "roles"]) {
    const S = { nolock: [], lock: [], memo: [], lockonly: [] };
    for (let i = 0; i < runs; i++) {
      for (const v of Object.keys(S)) S[v].push(measure(which, v));
    }
    const a = median(S.nolock);
    const b = median(S.lock);
    const m = median(S.memo);
    rows.push({
      canal: which,
      "sans verrou ns": a.toFixed(0),
      "avec verrou ns": b.toFixed(0),
      "verdict retenu ns": m.toFixed(0),
      "verrou %": (((b - a) / a) * 100).toFixed(1),
      "retenu %": (((m - a) / a) * 100).toFixed(1),
      "verrou seul ns": median(S.lockonly).toFixed(0),
      "étendue avec": spread(S.lock),
      "étendue retenu": spread(S.memo),
    });
  }
  console.table(rows);
}
