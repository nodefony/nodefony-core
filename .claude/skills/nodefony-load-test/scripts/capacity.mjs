/**
 * capacity.mjs — BANC DE CAPACITÉ + rapport de dimensionnement.
 *
 * Ne cherche PAS la rupture (→ `ws-connections.mjs`, `--rupture`). Il mesure les
 * CONSTANTES d'UN process Nodefony, celles dont se déduit une spécification de
 * déploiement (nb de pods, CPU/RAM par pod, limites) :
 *
 *   A. RAM par socket WS — en TLS (terminé par Node) ET en clair (TLS au LB).
 *   B. Débit + coût CPU par message WS (echo 1:1) et par livraison (fan-out).
 *   C. Débit + latences + coût CPU par requête HTTP — http/1.1, https/1.1, h2.
 *   D. Plafonds extrapolés d'un process, et le modèle de dimensionnement.
 *
 * ── COMMENT LE CPU EST MESURÉ (et pourquoi pas autrement) ───────────────────
 * Un process Node = UNE boucle d'événements : la métrique qui décide de la
 * capacité est l'**ELU** (event loop utilization, fraction de temps où la boucle
 * travaille). On échantillonne `/nodefony/studio/api/stats` PENDANT la charge
 * (chaque appel rend l'ELU sur une fenêtre de 150 ms), puis :
 *
 *     capacité_100% = débit_observé / ELU_moyen
 *
 * Ça corrige le biais du client : si le banc n'arrive pas à saturer le serveur,
 * l'ELU le dit (0,4 → le serveur pourrait encaisser 2,5× plus).
 *
 * ⚠️ NE PAS mesurer le CPU avec `ps -o time` : il additionne TOUS les threads du
 * process (GC parallèle de V8, pool libuv) → on obtient un « coût par message »
 * qui contredit le débit réellement observé (vécu : 227 µs/msg « donc 4 400 msg/s »
 * alors que 9 782 msg/s passaient). Le CPU total ≠ le temps de boucle.
 * ⚠️ NE PAS lire `/stats` avant/après un flood : sa fenêtre est glissante (150 ms),
 * pas cumulée depuis le boot — une soustraction y donne des valeurs aberrantes.
 *
 * Prérequis : serveur UP (`/start-server`), compte admin (le data plane `/stats`
 * est protégé). En dev, le profiler et le timing sont ACTIFS → les chiffres sont
 * une BORNE BASSE ; en production ils montent (cf le rapport).
 *
 * Usage :
 *   node .claude/skills/nodefony-load-test/scripts/capacity.mjs
 *   node ... capacity.mjs --out docs/audits/capacity-2026-07.md
 *   node ... capacity.mjs --sockets 500 --http-reqs 3000 --skip-ws
 */
import https from "node:https";
import http from "node:http";
import http2 from "node:http2";
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const WebSocket = require("ws");

const flag = (n) => process.argv.includes(`--${n}`);
const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i === -1 ? d : process.argv[i + 1];
};
const num = (n, d) => Number(arg(n, d));

const SOCKETS = num("sockets", 800);
const CLIENTS = num("clients", 8);
const FRAMES = num("frames", 4000);
const FANOUT = num("fanout", 100);
const HTTP_CONC = num("http-conc", 50);
const HTTP_REQS = num("http-reqs", 5000);
const PAYLOAD = num("payload", 5); // octets par frame WS — CHANGE TOUT (cf rapport)
const REPEAT = num("repeat", 3); // répétitions → médiane + dispersion
const OUT = arg("out", null);

const HOST = process.env.NF_HOST ?? "127.0.0.1";
const PTLS = Number(process.env.NF_PORT_HTTPS ?? 5152);
const PCLR = Number(process.env.NF_PORT ?? 5151);
const USER = process.env.NF_ADMIN_USER ?? "admin";
const PASS = process.env.NF_ADMIN_PASSWORD ?? "secret";

/**
 * CIBLES — paramétrables, parce que la PRODUCTION n'expose pas les mêmes routes.
 *
 * Le module `test` (echo WS, broadcast, sonde mémoire, route session-free) est
 * `policy: "dev"` : il N'EXISTE PAS en production, et c'est voulu. Un banc qui le
 * suppose présent ne peut donc mesurer QUE le développement — c'est-à-dire
 * l'environnement dont les chiffres ne valent rien pour dimensionner.
 *
 * `--target studio` bascule sur ce que la prod expose réellement :
 *   - mémoire : `kernel:gc` (RPC du hub, force le GC) + `/studio/api/stats`
 *   - HTTP    : `/nodefony/studio/api/health` (public, sans session)
 *   - sockets : le hub Studio ; le débit se mesure sur le PONT `api.request`
 *               (la vraie porte socket) au lieu d'un echo.
 */
const TARGET = arg("target", "test"); // "test" (dev) | "studio" (prod)
const STUDIO = TARGET === "studio";
const ROUTE = arg(
  "http-path",
  STUDIO ? "/nodefony/studio/api/health" : "/nodefony/test/als-test/state",
);
const HUB = `wss://${HOST}:${PTLS}/nodefony/studio/api/realtime`;
const ECHO_TLS = STUDIO ? HUB : `wss://${HOST}:${PTLS}/nodefony/test/ws/echo`;
const ECHO_CLR = STUDIO ? HUB : `ws://${HOST}:${PCLR}/nodefony/test/ws/echo`;
const BROADCAST = STUDIO
  ? HUB
  : `wss://${HOST}:${PTLS}/nodefony/test/ws/broadcast`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MB = (b) => b / 1048576;
const pct = (arr, p) =>
  arr[Math.min(arr.length - 1, Math.floor((arr.length - 1) * p))];

// ── I/O de base ────────────────────────────────────────────────────────────
function reqJson(
  path,
  { method = "GET", headers = {}, payload, tls = true } = {},
) {
  const mod = tls ? https : http;
  const data = payload ? Buffer.from(JSON.stringify(payload)) : null;
  return new Promise((resolve, reject) => {
    const r = mod.request(
      {
        hostname: HOST,
        port: tls ? PTLS : PCLR,
        path,
        method,
        rejectUnauthorized: false,
        headers: {
          ...headers,
          ...(data
            ? {
                "content-type": "application/json",
                "content-length": data.length,
              }
            : {}),
        },
      },
      (res) => {
        const c = [];
        res.on("data", (d) => c.push(d));
        res.on("end", () => {
          const raw = Buffer.concat(c).toString();
          let body = null;
          try {
            body = raw ? JSON.parse(raw) : null;
          } catch {
            body = raw;
          }
          resolve({ status: res.statusCode, headers: res.headers, body });
        });
      },
    );
    r.on("error", reject);
    if (data) r.write(data);
    r.end();
  });
}

/**
 * heapUsed RETENU (après GC forcé).
 *
 * En dev : la sonde du module test force `global.gc()`. En prod, ce module
 * n'existe pas → on passe par l'action RPC `kernel:gc` du hub Studio (qui force
 * le GC si le process a `--expose-gc`), puis on lit `/studio/api/stats`.
 * Sans GC forcé, on mesurerait le déchet transitoire, pas la mémoire RETENUE.
 */
let GC_PEER = null; // socket de service, ouverte une fois
const mem = async () => {
  if (!STUDIO) return (await reqJson("/nodefony/test/memory")).body;
  await rpc(await gcPeer(), "kernel:gc", {});
  const s = await stats();
  return s.memory;
};

let COOKIE = "";
const stats = async () =>
  (await reqJson("/nodefony/studio/api/stats", { headers: { cookie: COOKIE } }))
    .body;

/**
 * Échantillonne l'ELU du serveur pendant qu'une charge tourne.
 * Rend `{ stop() → { elu, cpuPercent, samples } }` (moyennes).
 */
function eluSampler() {
  const seen = [];
  let running = true;
  const loop = (async () => {
    while (running) {
      try {
        const s = await stats();
        if (s?.elu) seen.push({ u: s.elu.utilization, cpu: s.cpuPercent });
      } catch {
        /* le serveur est occupé : on retentera */
      }
      await sleep(50);
    }
  })();
  return {
    async stop() {
      running = false;
      await loop;
      if (!seen.length) return { elu: null, cpuPercent: null, samples: 0 };
      const avg = (f) => seen.reduce((s, x) => s + f(x), 0) / seen.length;
      return {
        elu: avg((x) => x.u),
        cpuPercent: avg((x) => x.cpu),
        samples: seen.length,
      };
    },
  };
}

/** Appel RPC JSON-RPC sur une socket déjà ouverte (le hub Studio). */
function rpc(ws, method, params) {
  return new Promise((resolve, reject) => {
    const id = (ws.__id = (ws.__id ?? 0) + 1);
    const t = setTimeout(
      () => reject(new Error(`rpc timeout ${method}`)),
      15000,
    );
    const onMsg = (d) => {
      const f = JSON.parse(String(d));
      if (f.id !== id) return;
      clearTimeout(t);
      ws.off("message", onMsg);
      f.error ? reject(new Error(f.error.message)) : resolve(f.result);
    };
    ws.on("message", onMsg);
    ws.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
  });
}

/** Socket de service (GC + sondes) — ouverte une seule fois. */
async function gcPeer() {
  if (GC_PEER && GC_PEER.readyState === 1) return GC_PEER;
  GC_PEER = await openOne(HUB);
  return GC_PEER;
}

/** Ouvre UNE socket et attend sa 1ʳᵉ frame (handshake / welcome). */
function openOne(url) {
  return new Promise((res, rej) => {
    const ws = new WebSocket(url, {
      rejectUnauthorized: false,
      headers: { cookie: COOKIE },
    });
    ws.once("error", rej);
    ws.once("message", () => res(ws));
  });
}

/** Ouvre N sockets PAR BATCHES — un seul Promise.all → AggregateError (dual-stack). */
async function openFleet(url, n, batch = 50) {
  const socks = [];
  for (let i = 0; i < n; i += batch) {
    const wave = await Promise.all(
      Array.from(
        { length: Math.min(batch, n - i) },
        () =>
          new Promise((res, rej) => {
            const ws = new WebSocket(url, {
              rejectUnauthorized: false,
              headers: { cookie: COOKIE }, // le hub Studio est derrière le firewall
            });
            ws.once("error", rej);
            ws.once("message", () => res(ws)); // 1ʳᵉ frame = handshake / welcome
          }),
      ),
    );
    socks.push(...wave);
  }
  return socks;
}

// ── A. RAM par socket — PALIERS + RÉGRESSION ───────────────────────────────
/**
 * Moindres carrés → pente (octets par socket) et R² (qualité de l'ajustement).
 */
function linreg(points) {
  const n = points.length;
  const mx = points.reduce((s, p) => s + p.x, 0) / n;
  const my = points.reduce((s, p) => s + p.y, 0) / n;
  let num = 0;
  let den = 0;
  for (const p of points) {
    num += (p.x - mx) * (p.y - my);
    den += (p.x - mx) ** 2;
  }
  const slope = den === 0 ? 0 : num / den;
  const intercept = my - slope * mx;
  let ssTot = 0;
  let ssRes = 0;
  for (const p of points) {
    ssTot += (p.y - my) ** 2;
    ssRes += (p.y - (slope * p.x + intercept)) ** 2;
  }
  return { slope, intercept, r2: ssTot === 0 ? 1 : 1 - ssRes / ssTot };
}

/**
 * RAM par socket, mesurée par PALIERS croissants puis régressée.
 *
 * Un simple delta (0 → N sockets) est noyé dans le bruit : le GC rend de la
 * mémoire pendant la mesure, et un RSS « par socket » peut sortir NÉGATIF
 * (vécu : −24 KB/socket). La pente d'une droite sur 5 paliers élimine le terme
 * constant et rend un R² qui DIT si la mesure est exploitable (< 0,9 → poubelle).
 */
async function ramPerSocket(url, nMax, label) {
  const steps = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(nMax * f));
  const socks = [];
  const heapPts = [];
  const rssPts = [];
  for (const target of steps) {
    while (socks.length < target) {
      const wave = await openFleet(url, Math.min(50, target - socks.length));
      socks.push(...wave);
    }
    await sleep(1200);
    const m = await mem(); // force GC → heap RETENU
    heapPts.push({ x: socks.length, y: m.heapUsed });
    rssPts.push({ x: socks.length, y: m.rss });
  }
  for (const s of socks) s.terminate();
  await sleep(1200);
  const heap = linreg(heapPts);
  const rss = linreg(rssPts);
  return {
    label,
    n: nMax,
    steps,
    heapKB: heap.slope / 1024,
    heapR2: heap.r2,
    rssKB: rss.slope / 1024,
    rssR2: rss.r2,
    heapPts: heapPts.map((p) => ({ x: p.x, y: p.y / 1048576 })),
    rssPts: rssPts.map((p) => ({ x: p.x, y: p.y / 1048576 })),
  };
}

// ── B. Débit WS ────────────────────────────────────────────────────────────
async function wsThroughput(url, label) {
  const socks = await openFleet(url, CLIENTS);
  await sleep(400);
  const frame = "x".repeat(PAYLOAD);
  const sampler = eluSampler();
  const t0 = performance.now();
  await Promise.all(
    socks.map(
      (ws) =>
        new Promise((resolve) => {
          let got = 0;
          if (STUDIO) {
            // Le hub ne renvoie pas l'écho d'une frame nue : on mesure LA PORTE
            // réelle de la production — le pont `api.request` (aller-retour RPC
            // complet : resolve + identité + action). Le coût par message y est
            // donc plus élevé qu'un echo : ce n'est pas la même unité de travail,
            // et le rapport le dit.
            let sent = 0;
            const fire = () => {
              if (sent >= FRAMES) return;
              sent++;
              ws.send(
                JSON.stringify({
                  jsonrpc: "2.0",
                  id: sent,
                  method: "api.request",
                  params: { path: "/nodefony/studio/api/health" },
                }),
              );
            };
            ws.on("message", () => {
              if (++got >= FRAMES) return resolve();
              fire();
            });
            for (let i = 0; i < Math.min(16, FRAMES); i++) fire(); // fenêtre glissante
            return;
          }
          ws.on("message", () => {
            if (++got >= FRAMES) resolve();
          });
          for (let i = 0; i < FRAMES; i++) ws.send(frame);
        }),
    ),
  );
  const secs = (performance.now() - t0) / 1000;
  const { elu, cpuPercent } = await sampler.stop();
  for (const s of socks) s.terminate();
  const observed = (CLIENTS * FRAMES) / secs;
  return {
    label,
    observed,
    elu,
    cpuPercent,
    ceiling: elu ? observed / elu : null,
  };
}

async function wsFanout() {
  const socks = await openFleet(BROADCAST, FANOUT, 25);
  await sleep(600);
  const FR = 200;
  const counters = socks.map(() => 0);
  const done = Promise.all(
    socks.map(
      (ws, i) =>
        new Promise((resolve) => {
          ws.on("message", () => {
            if (++counters[i] >= FR) resolve();
          });
        }),
    ),
  );
  const sampler = eluSampler();
  const t0 = performance.now();
  for (let f = 0; f < FR; f++) socks[0].send(`b-${f}`);
  await done;
  const secs = (performance.now() - t0) / 1000;
  const { elu } = await sampler.stop();
  for (const s of socks) s.terminate();
  const observed = (FANOUT * FR) / secs;
  return { n: FANOUT, observed, elu, ceiling: elu ? observed / elu : null };
}

// ── C. Débit HTTP (http/1.1 clair, https/1.1, h2) ──────────────────────────
function h1Once(agent, tls) {
  const mod = tls ? https : http;
  return new Promise((resolve, reject) => {
    const t = performance.now();
    const r = mod.request(
      {
        hostname: HOST,
        port: tls ? PTLS : PCLR,
        path: ROUTE,
        agent,
        rejectUnauthorized: false,
      },
      (res) => {
        res.resume();
        res.on("end", () => {
          // 🚨 Le statut n'est PAS un détail ici : ces mesures deviennent les
          // constantes de dimensionnement d'un pod. Une erreur répond plus vite
          // qu'une vraie route (ni resolver, ni controller, ni sérialisation) →
          // mesurer du 404 SURESTIME la capacité, et on sous-provisionne la prod.
          if (res.statusCode < 200 || res.statusCode >= 400) {
            reject(
              new Error(
                `${ROUTE} a répondu ${res.statusCode} — mesure de capacité impossible ` +
                  `(une erreur est plus rapide qu'une réponse : le chiffre serait faux).`,
              ),
            );
            return;
          }
          resolve(performance.now() - t);
        });
      },
    );
    r.on("error", reject);
    r.end();
  });
}

async function h1Bench(tls, label) {
  const Agent = tls ? https.Agent : http.Agent;
  const agent = new Agent({ keepAlive: true, maxSockets: HTTP_CONC });
  for (let i = 0; i < 200; i++) await h1Once(agent, tls); // warmup + TLS handshakes
  const lat = [];
  for (let i = 0; i < 500; i++) lat.push(await h1Once(agent, tls)); // séquentiel = latence
  lat.sort((a, b) => a - b);
  const sampler = eluSampler();
  const t0 = performance.now();
  let done = 0;
  await Promise.all(
    Array.from({ length: HTTP_CONC }, async () => {
      while (done < HTTP_REQS) {
        done++;
        await h1Once(agent, tls);
      }
    }),
  );
  const secs = (performance.now() - t0) / 1000;
  const { elu, cpuPercent } = await sampler.stop();
  agent.destroy();
  const observed = HTTP_REQS / secs;
  return {
    label,
    observed,
    p50: pct(lat, 0.5),
    p95: pct(lat, 0.95),
    p99: pct(lat, 0.99),
    elu,
    cpuPercent,
    ceiling: elu ? observed / elu : null,
  };
}

function h2Once(session) {
  return new Promise((resolve, reject) => {
    const t = performance.now();
    const s = session.request({ ":path": ROUTE });
    s.on("error", reject);
    // Même exigence qu'en HTTP/1.1 : un `:status` d'erreur invalide la mesure de
    // capacité (cf h1Once). Le pseudo-header arrive avec l'événement `response`.
    let status = 0;
    s.on("response", (h) => {
      status = Number(h[":status"]);
    });
    s.resume();
    s.on("end", () => {
      if (status < 200 || status >= 400) {
        reject(
          new Error(
            `${ROUTE} a répondu ${status} en HTTP/2 — mesure de capacité impossible.`,
          ),
        );
        return;
      }
      resolve(performance.now() - t);
    });
    s.end();
  });
}

async function h2Bench() {
  const session = http2.connect(`https://${HOST}:${PTLS}`, {
    rejectUnauthorized: false,
  });
  await new Promise((res, rej) => {
    session.once("connect", res);
    session.once("error", rej);
  });
  for (let i = 0; i < 200; i++) await h2Once(session);
  const lat = [];
  for (let i = 0; i < 500; i++) lat.push(await h2Once(session));
  lat.sort((a, b) => a - b);
  const sampler = eluSampler();
  const t0 = performance.now();
  let done = 0;
  await Promise.all(
    Array.from({ length: HTTP_CONC }, async () => {
      while (done < HTTP_REQS) {
        done++;
        await h2Once(session);
      }
    }),
  );
  const secs = (performance.now() - t0) / 1000;
  const { elu, cpuPercent } = await sampler.stop();
  session.close();
  const observed = HTTP_REQS / secs;
  return {
    label: "h2 (multiplexé, 1 connexion)",
    observed,
    p50: pct(lat, 0.5),
    p95: pct(lat, 0.95),
    p99: pct(lat, 0.99),
    elu,
    cpuPercent,
    ceiling: elu ? observed / elu : null,
  };
}

// ── run ────────────────────────────────────────────────────────────────────
const login = await reqJson("/nodefony/security/api/auth/login", {
  method: "POST",
  payload: { username: USER, password: PASS },
});
COOKIE = String(login.headers["set-cookie"]?.[0] ?? "").split(";")[0];
const s0 = await stats();
if (!s0?.pid)
  throw new Error("stats indisponible — login admin OK ? serveur UP ?");

const env = {
  pid: s0.pid,
  cores: s0.cpuCount,
  node: s0.proc.nodeVersion,
  platform: `${s0.proc.platform}/${s0.proc.arch}`,
  env: s0.app.env,
  version: s0.app.version,
  rssIdleMB: MB(s0.memory.rss),
  heapLimitMB: MB(s0.memory.heapLimit),
};

console.log(
  `\nServeur pid=${env.pid} · ${env.cores} cœurs · node ${env.node} · env=${env.env}` +
    `\nRSS au repos ${env.rssIdleMB.toFixed(0)} MB · limite heap V8 ${env.heapLimitMB.toFixed(0)} MB\n`,
);

const R = { env, ram: [], ws: [], fanout: null, http: [], repeat: REPEAT };

/**
 * Répète une mesure et rend la MÉDIANE + la dispersion.
 *
 * Non négociable : une mesure unique de débit ne vaut RIEN sur une machine de
 * dev (GC, watcher, Vite, thermique). Vécu en écrivant ce banc : un run isolé
 * donnait « ws clair 35 % plus lent que wss » — conclusion absurde, invalidée
 * dès la 2ᵉ série. La dispersion est publiée avec le chiffre : un lecteur doit
 * pouvoir voir que la mesure est instable, pas seulement sa médiane.
 */
async function repeated(fn, key) {
  const runs = [];
  for (let i = 0; i < REPEAT; i++) runs.push(await fn());
  const vals = runs.map((r) => r[key]).sort((a, b) => a - b);
  const median = vals[Math.floor(vals.length / 2)];
  const base = runs.find((r) => r[key] === median) ?? runs[0];
  const spread =
    vals.length > 1 ? (vals[vals.length - 1] - vals[0]) / median : 0;
  return {
    ...base,
    [key]: median,
    min: vals[0],
    max: vals[vals.length - 1],
    spread,
  };
}

if (!flag("skip-ws")) {
  console.log(`A. RAM par socket (×${REPEAT})…`);
  R.ram.push(
    await repeated(
      () => ramPerSocket(ECHO_TLS, SOCKETS, "wss — TLS terminé par Node"),
      "heapKB",
    ),
  );
  R.ram.push(
    await repeated(
      () => ramPerSocket(ECHO_CLR, SOCKETS, "ws — TLS terminé par le LB"),
      "heapKB",
    ),
  );
  console.log(`B. Débit WS (echo + fan-out, ×${REPEAT})…`);
  const wsLabel = STUDIO ? "pont api.request (aller-retour)" : "echo 1:1";
  R.ws.push(
    await repeated(
      () => wsThroughput(ECHO_TLS, `wss (${wsLabel})`),
      "observed",
    ),
  );
  if (!STUDIO)
    R.ws.push(
      await repeated(
        () => wsThroughput(ECHO_CLR, `ws (${wsLabel})`),
        "observed",
      ),
    );
  // Pas de route broadcast en production (module `test` absent) : on NE MESURE PAS
  // le fan-out plutôt que d'inventer un chiffre. Le rapport le dit.
  if (!STUDIO && FANOUT > 0)
    R.fanout = await repeated(() => wsFanout(), "observed");
}

if (!flag("skip-http")) {
  console.log(`C. Débit HTTP (h1 clair, h1 TLS, h2, ×${REPEAT})…`);
  R.http.push(
    await repeated(() => h1Bench(false, "http/1.1 (clair)"), "observed"),
  );
  R.http.push(
    await repeated(() => h1Bench(true, "https/1.1 (TLS)"), "observed"),
  );
  R.http.push(await repeated(() => h2Bench(), "observed"));
}

// ── rendu ──────────────────────────────────────────────────────────────────
const n0 = (x) =>
  x === null || x === undefined ? "—" : Math.round(x).toLocaleString("fr-FR");
const f2 = (x) => (x === null || x === undefined ? "—" : x.toFixed(2));
const us = (rate) => (rate ? `${(1e6 / rate).toFixed(0)} µs` : "—");
/** Dispersion des runs — un chiffre sans son incertitude est un piège. */
const spread = (r) =>
  r?.spread === undefined ? "—" : `±${Math.round(r.spread * 50)}%`;

const lines = [];
const say = (s = "") => {
  lines.push(s);
  console.log(s);
};

say(`\n══ CAPACITÉ — ${env.env} · ${env.cores} cœurs · node ${env.node} ══\n`);

if (R.ram.length) {
  say(
    "A. RAM par socket — pente d'une régression sur paliers (R² = qualité de l'ajustement)",
  );
  say(
    "   transport                      heap/socket        RSS/socket (à retenir)",
  );
  for (const r of R.ram)
    say(
      `   ${r.label.padEnd(30)} ${(r.heapKB.toFixed(1) + " KB (R²" + r.heapR2.toFixed(2) + ")").padEnd(18)} ${r.rssKB.toFixed(1)} KB (R²${r.rssR2.toFixed(2)})`,
    );
  say("");
}

if (R.ws.length) {
  say(
    `B. Débit WebSocket — payload ${PAYLOAD} o · médiane de ${REPEAT} runs (le CPU vient de l'ELU)`,
  );
  say(
    "   scénario                       médiane        écart    ELU    plafond 100%   à 70%",
  );
  for (const w of R.ws)
    say(
      `   ${w.label.padEnd(30)} ${(n0(w.observed) + " msg/s").padEnd(14)} ${(spread(w) + "").padEnd(8)} ${f2(w.elu).padEnd(6)} ${(n0(w.ceiling) + " msg/s").padEnd(14)} ${n0(w.ceiling * 0.7)}`,
    );
  if (R.fanout)
    say(
      `   ${`fan-out 1 → ${R.fanout.n} sockets`.padEnd(30)} ${(n0(R.fanout.observed) + " liv/s").padEnd(14)} ${(spread(R.fanout) + "").padEnd(8)} ${f2(R.fanout.elu).padEnd(6)} ${(n0(R.fanout.ceiling) + " liv/s").padEnd(14)} ${n0(R.fanout.ceiling * 0.7)}`,
    );
  say("");
}

if (R.http.length) {
  say(`C. Débit HTTP — route session-free, 0 ORM · médiane de ${REPEAT} runs`);
  say(
    "   transport                      médiane      écart   p50/p95/p99 (ms)     ELU    plafond",
  );
  for (const h of R.http)
    say(
      `   ${h.label.padEnd(30)} ${(n0(h.observed) + " rps").padEnd(12)} ${(spread(h) + "").padEnd(7)} ${`${f2(h.p50)}/${f2(h.p95)}/${f2(h.p99)}`.padEnd(20)} ${f2(h.elu).padEnd(6)} ${n0(h.ceiling)} rps`,
    );
  say("");
}

say("D. Coût unitaire (temps de boucle consommé)");
for (const w of R.ws)
  say(`   1 message ${w.label.padEnd(22)} ≈ ${us(w.ceiling)}`);
if (R.fanout)
  say(`   1 livraison fan-out              ≈ ${us(R.fanout.ceiling)}`);
for (const h of R.http)
  say(`   1 requête ${h.label.padEnd(22)} ≈ ${us(h.ceiling)}`);
say("");

// ── rapport HTML ───────────────────────────────────────────────────────────
// HTML et pas Markdown : ce rapport sert à DÉCIDER (combien de pods, quelle RAM,
// TLS terminé où). Le lecteur doit pouvoir manipuler ses propres hypothèses →
// le calculateur en bas de page est le vrai livrable ; les tableaux sont la preuve.
if (OUT) {
  const { renderHtml } = await import("./capacity-html.mjs");
  const html = renderHtml(R, {
    PAYLOAD,
    REPEAT,
    generatedAt:
      new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC",
    command:
      "node .claude/skills/nodefony-load-test/scripts/capacity.mjs " +
      process.argv.slice(2).join(" "),
  });
  writeFileSync(OUT, html); // `doc()` produit le document COMPLET (doctype inclus)
  console.log(`Rapport HTML : ${OUT}\n`);
}

process.exit(0);
